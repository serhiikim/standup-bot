const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Isolated SQLite file so this suite never touches a real database.
const testDbPath = path.join(__dirname, 'test-freeform.db');
process.env.SQLITE_DB_PATH = testDbPath;
delete process.env.MONGODB_URI;

const database = require('../config/database');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');

// A channel document exactly as the pre-freeform code wrote it: config has no
// freeformPrompt key at all.
const LEGACY_CHANNEL_DOC = {
  teamId: 'T_LEGACY',
  channelId: 'C_LEGACY',
  channelName: 'engineering',
  configuredBy: 'U_ADMIN',
  config: {
    questions: [
      'What did you accomplish yesterday?',
      'What are you working on today?',
      'Any blockers or challenges?',
      'Any notes?'
    ],
    time: '09:00',
    deadlineTime: '18:00',
    days: [1, 2, 3, 4, 5],
    timezone: 'UTC',
    participants: [],
    responseTimeout: 10800000,
    enableReminders: true,
    reminderInterval: 3600000,
    requireAllResponses: false,
    autoSummary: true
  },
  status: 'active',
  isActive: true
};

describe('Free-form prompt: SQLite backward compatibility', () => {
  before(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await database.connect();
  });

  after(async () => {
    await database.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('the schema is a JSON blob, so no migration is involved', async () => {
    // Every collection is `(id TEXT PRIMARY KEY, data TEXT)`. Adding a field
    // adds a JSON key, never a column, so existing rows are never rewritten.
    const cols = await database.sqliteDb.all('PRAGMA table_info(standups)');
    assert.deepStrictEqual(cols.map(c => c.name), ['id', 'data']);
    const channelCols = await database.sqliteDb.all('PRAGMA table_info(channels)');
    assert.deepStrictEqual(channelCols.map(c => c.name), ['id', 'data']);
  });

  test('a legacy channel row written by the old code still loads', async () => {
    // Inserted as a plain object, bypassing the model, to mimic a row already
    // sitting in production.
    await database.getDb().collection('channels').insertOne({ ...LEGACY_CHANNEL_DOC });

    const channel = await Channel.findByChannelId('T_LEGACY', 'C_LEGACY');
    assert.ok(channel, 'legacy channel must be readable');
    assert.strictEqual(channel.config.questions.length, 4, 'questions must be untouched');
    assert.strictEqual(channel.config.freeformPrompt, undefined, 'the new key is simply absent');
    assert.strictEqual(!!channel.config.freeformPrompt, false, 'absent must read as legacy mode');
  });

  test('the lifecycle snapshot turns an absent flag into an explicit false', async () => {
    const channel = await Channel.findByChannelId('T_LEGACY', 'C_LEGACY');
    // Mirrors standupLifecycleService: freeformPrompt: !!channel.config.freeformPrompt
    const standup = await Standup.create({
      teamId: channel.teamId,
      channelId: channel.channelId,
      questions: [...channel.config.questions],
      freeformPrompt: !!channel.config.freeformPrompt,
      expectedParticipants: ['U1', 'U2'],
      threadTs: '1111.0001'
    });

    const reloaded = await Standup.findById(standup._id.toString());
    assert.strictEqual(reloaded.freeformPrompt, false);
    assert.strictEqual(reloaded.questions.length, 4);
  });

  test('a legacy standup row mid-flight keeps working and is not corrupted by a save', async () => {
    // An in-flight standup started before the deploy: no freeformPrompt key.
    await database.getDb().collection('standups').insertOne({
      _id: 'legacy-standup-id',
      teamId: 'T_LEGACY',
      channelId: 'C_LEGACY',
      questions: [...LEGACY_CHANNEL_DOC.config.questions],
      expectedParticipants: ['U1'],
      actualParticipants: [],
      threadTs: '2222.0002',
      status: 'active',
      stats: { totalExpected: 1, totalResponded: 0, responseRate: 0, avgResponseTime: 0, remindersSent: 0 }
    });

    const loaded = await Standup.findByThreadTs('T_LEGACY', '2222.0002');
    assert.ok(loaded, 'in-flight legacy standup must still be found');
    assert.strictEqual(loaded.freeformPrompt, false, 'absent flag reads as classic format');

    // The completion job saves the standup after the deploy — questions must survive.
    loaded.actualParticipants = ['U1'];
    await loaded.save();

    const after = await Standup.findByThreadTs('T_LEGACY', '2222.0002');
    assert.strictEqual(after.freeformPrompt, false);
    assert.deepStrictEqual(after.questions, LEGACY_CHANNEL_DOC.config.questions);
    assert.deepStrictEqual(after.actualParticipants, ['U1']);
  });

  test('a free-form channel round-trips through the database', async () => {
    const prompt = 'Working on something cool?\n\n- share a screenshot\n- or a quick video';
    await Channel.create({
      teamId: 'T_NEW',
      channelId: 'C_NEW',
      channelName: 'showcase',
      configuredBy: 'U_ADMIN',
      config: { ...LEGACY_CHANNEL_DOC.config, questions: [prompt], freeformPrompt: true }
    });

    const channel = await Channel.findByChannelId('T_NEW', 'C_NEW');
    assert.strictEqual(channel.config.freeformPrompt, true);
    assert.strictEqual(channel.config.questions[0], prompt, 'multi-line ask survives storage');
  });

  test('the flag reaches the standup row through JSON.stringify/toJSON', async () => {
    // SQLite persists via JSON.stringify(doc), which calls the model's toJSON().
    // A field missing from that whitelist would vanish here.
    const prompt = 'Drop a screenshot of what you are building.';
    const standup = await Standup.create({
      teamId: 'T_NEW',
      channelId: 'C_NEW',
      questions: [prompt],
      freeformPrompt: true,
      expectedParticipants: ['U1'],
      threadTs: '3333.0003'
    });

    const raw = await database.sqliteDb.get('SELECT data FROM standups WHERE id = ?', standup._id.toString());
    const parsed = JSON.parse(raw.data);
    assert.strictEqual(parsed.freeformPrompt, true, 'flag must be present in the stored JSON');

    const reloaded = await Standup.findByThreadTs('T_NEW', '3333.0003');
    assert.strictEqual(reloaded.freeformPrompt, true);

    // And it must still be true after an ordinary save cycle.
    reloaded.status = 'completed';
    await reloaded.save();
    const after = await Standup.findByThreadTs('T_NEW', '3333.0003');
    assert.strictEqual(after.freeformPrompt, true, 'flag must survive save()');
    assert.strictEqual(after.questions[0], prompt);
  });

  test('deploy day: a reply lands in a standup that started before the deploy', async () => {
    // The standup row as the old code left it this morning: no freeformPrompt,
    // no knowledge of the new fields.
    await database.getDb().collection('standups').insertOne({
      _id: 'inflight-standup',
      teamId: 'T_LEGACY',
      channelId: 'C_LEGACY',
      questions: [...LEGACY_CHANNEL_DOC.config.questions],
      expectedParticipants: ['U1', 'U2'],
      actualParticipants: ['U1'],
      threadTs: '4444.0004',
      messageTs: '4444.0004',
      status: 'active',
      startedAt: new Date(Date.now() - 3600000),
      responseDeadline: new Date(Date.now() + 3600000),
      stats: { totalExpected: 2, totalResponded: 1, responseRate: 50, avgResponseTime: 0, remindersSent: 0 }
    });

    // New code boots. U2 replies in the same thread.
    const standup = await Standup.findByThreadTs('T_LEGACY', '4444.0004');
    assert.ok(standup, 'the running standup must still be found after the deploy');
    assert.strictEqual(standup.freeformPrompt, false);
    assert.strictEqual(standup.status, 'active', 'still collecting');

    const response = await Response.create({
      standupId: standup._id,
      teamId: 'T_LEGACY',
      channelId: 'C_LEGACY',
      userId: 'U2',
      username: 'u2',
      messageTs: '4444.0005',
      threadTs: '4444.0004',
      submittedAt: new Date()
    });
    response.parseRawMessage('Today: finishing the export job', standup.questions);
    await response.save();

    standup.actualParticipants = ['U1', 'U2'];
    await standup.save();

    // Everything the completion job will read must be intact.
    const reloadedStandup = await Standup.findByThreadTs('T_LEGACY', '4444.0004');
    assert.deepStrictEqual(reloadedStandup.questions, LEGACY_CHANNEL_DOC.config.questions);
    assert.strictEqual(reloadedStandup.freeformPrompt, false, 'still the classic format');
    assert.deepStrictEqual(reloadedStandup.actualParticipants, ['U1', 'U2']);

    const reloadedResponse = await Response.findByStandupAndUser(standup._id, 'U2');
    assert.ok(reloadedResponse, 'the reply must be stored');
    assert.strictEqual(reloadedResponse.rawMessage, 'Today: finishing the export job');
    assert.strictEqual(reloadedResponse.isComplete, true);
  });

  test('legacy and free-form channels coexist in the same database', async () => {
    const legacy = await Channel.findByChannelId('T_LEGACY', 'C_LEGACY');
    const modern = await Channel.findByChannelId('T_NEW', 'C_NEW');
    assert.strictEqual(!!legacy.config.freeformPrompt, false);
    assert.strictEqual(!!modern.config.freeformPrompt, true);
  });
});
