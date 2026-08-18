const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-backfill.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'xoxb-test';
delete process.env.MONGODB_URI;

const database = require('../config/database');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const {
  parseArgs, parseSince, humanReplies, groupByUser, backfillStandup
} = require('../scripts/backfill-thread-responses');

const THREAD = '1787058003.062999';

function emptyReport() {
  return {
    standupsScanned: 0,
    recovered: [],
    alreadyStored: 0,
    skippedNotExpected: 0,
    skippedEmpty: 0,
    statsRepaired: []
  };
}

// A stand-in for the workspace: serves one thread and records reactions.
function fakeSlack(messages) {
  const reactions = [];
  return {
    reactions,
    getThreadReplies: async () => messages,
    getUserInfo: async (id) => ({ name: id.toLowerCase(), profile: { display_name: id } }),
    app: {
      client: {
        reactions: {
          add: async ({ name, timestamp }) => { reactions.push({ name, timestamp }); }
        }
      }
    }
  };
}

async function seedStandup(participants) {
  await database.sqliteDb.exec('DELETE FROM standups');
  await database.sqliteDb.exec('DELETE FROM responses');
  return Standup.create({
    teamId: 'T1',
    channelId: 'C1',
    questions: ['Share what you are working on'],
    freeformPrompt: true,
    expectedParticipants: participants,
    threadTs: THREAD,
    messageTs: THREAD,
    status: 'completed',
    startedAt: new Date(Number(THREAD) * 1000),
    responseDeadline: new Date(Number(THREAD) * 1000 + 6 * 3600 * 1000)
  });
}

describe('backfill: argument parsing', () => {
  test('defaults to a dry run over the last 7 days', () => {
    const args = parseArgs([]);
    assert.strictEqual(args.apply, false);
    assert.strictEqual(args.since, '7d');
  });

  test('--apply switches to writing', () => {
    assert.strictEqual(parseArgs(['--apply']).apply, true);
  });

  test('--dry-run wins when it comes last', () => {
    assert.strictEqual(parseArgs(['--apply', '--dry-run']).apply, false);
  });

  test('reads a standup or channel target', () => {
    assert.strictEqual(parseArgs(['--standup', 'abc']).standup, 'abc');
    assert.strictEqual(parseArgs(['--channel', 'C1']).channel, 'C1');
  });

  test('rejects an unknown flag rather than silently ignoring it', () => {
    assert.throws(() => parseArgs(['--aply']), /Unknown argument/);
  });

  test('parses day and hour windows', () => {
    const now = Date.now();
    assert.ok(Math.abs(now - parseSince('1d').getTime() - 86400000) < 1000);
    assert.ok(Math.abs(now - parseSince('12h').getTime() - 12 * 3600000) < 1000);
    assert.throws(() => parseSince('7 days'), /--since must look like/);
  });
});

describe('backfill: thread filtering', () => {
  const messages = [
    { ts: THREAD, user: 'UBOT', text: 'Standup started', bot_id: 'B1' },
    { ts: '1787058100.0001', user: 'U2', text: 'second' },
    { ts: '1787058050.0001', user: 'U1', text: 'first' },
    { ts: '1787058200.0001', bot_id: 'B1', text: 'reminder' },
    { ts: '1787058300.0001', subtype: 'tombstone', user: 'U3', text: '' }
  ];

  test('drops the parent message, bots and tombstones, and sorts oldest first', () => {
    const replies = humanReplies(messages, THREAD);
    assert.deepStrictEqual(replies.map(r => r.user), ['U1', 'U2']);
  });

  test('groups replies per author preserving order', () => {
    const grouped = groupByUser(humanReplies([
      { ts: '1787058050.0001', user: 'U1', text: 'part one' },
      { ts: '1787058060.0001', user: 'U1', text: 'part two' },
      { ts: '1787058070.0001', user: 'U2', text: 'mine' }
    ], THREAD));

    assert.deepStrictEqual(grouped.get('U1').map(m => m.text), ['part one', 'part two']);
    assert.strictEqual(grouped.get('U2').length, 1);
  });
});

describe('backfill: recovering lost replies', () => {
  before(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await database.connect();
  });

  after(async () => {
    await database.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('a dry run reports the lost replies without writing anything', async () => {
    const standup = await seedStandup(['U1', 'U2']);
    const slack = fakeSlack([
      { ts: THREAD, bot_id: 'B1', text: 'Standup started' },
      { ts: '1787058859.0001', user: 'U1', text: '', files: [{ title: 'dashboard.png' }] },
      { ts: '1787059642.0001', user: 'U2', text: 'On track, no blockers' }
    ]);
    const report = emptyReport();

    await backfillStandup(standup, slack, { apply: false }, report);

    assert.strictEqual(report.recovered.length, 2);
    assert.strictEqual(slack.reactions.length, 0, 'a dry run must not touch Slack');
    const stored = await Response.findByStandupId(standup._id);
    assert.strictEqual(stored.length, 0, 'a dry run must not write to the database');
  });

  test('--apply stores the replies, describes files, and adds checkmarks', async () => {
    const standup = await seedStandup(['U1', 'U2']);
    const slack = fakeSlack([
      { ts: THREAD, bot_id: 'B1', text: 'Standup started' },
      { ts: '1787058859.0001', user: 'U1', text: '', files: [{ title: 'dashboard.png' }] },
      { ts: '1787059642.0001', user: 'U2', text: 'On track, no blockers' }
    ]);
    const report = emptyReport();

    await backfillStandup(standup, slack, { apply: true }, report);

    const u1 = await Response.findByStandupAndUser(standup._id, 'U1');
    assert.strictEqual(u1.rawMessage, '[shared 1 file: dashboard.png]', 'a file-only reply is described');
    const u2 = await Response.findByStandupAndUser(standup._id, 'U2');
    assert.strictEqual(u2.rawMessage, 'On track, no blockers');

    assert.strictEqual(slack.reactions.filter(r => r.name === 'white_check_mark').length, 2);

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual([...reloaded.actualParticipants].sort(), ['U1', 'U2']);
    assert.strictEqual(reloaded.stats.totalResponded, 2);
  });

  test('running it twice changes nothing the second time', async () => {
    const standup = await seedStandup(['U1']);
    const messages = [
      { ts: THREAD, bot_id: 'B1', text: 'Standup started' },
      { ts: '1787058859.0001', user: 'U1', text: 'my update' }
    ];

    const first = emptyReport();
    await backfillStandup(standup, fakeSlack(messages), { apply: true }, first);
    assert.strictEqual(first.recovered.length, 1);

    const reloaded = await Standup.findById(standup._id.toString());
    const second = emptyReport();
    const slack = fakeSlack(messages);
    await backfillStandup(reloaded, slack, { apply: true }, second);

    assert.strictEqual(second.recovered.length, 0, 'nothing left to recover');
    assert.strictEqual(second.alreadyStored, 1);
    assert.strictEqual(slack.reactions.length, 0, 'no duplicate reactions');
    assert.strictEqual((await Response.findByStandupId(standup._id)).length, 1);
  });

  test('ignores replies from people who were not part of the standup', async () => {
    const standup = await seedStandup(['U1']);
    const slack = fakeSlack([
      { ts: THREAD, bot_id: 'B1', text: 'Standup started' },
      { ts: '1787058859.0001', user: 'U_VISITOR', text: 'nice work everyone' }
    ]);
    const report = emptyReport();

    await backfillStandup(standup, slack, { apply: true }, report);

    assert.strictEqual(report.recovered.length, 0);
    assert.strictEqual(report.skippedNotExpected, 1);
    assert.strictEqual((await Response.findByStandupId(standup._id)).length, 0);
  });

  test('keeps the newest message and marks a late reply as late', async () => {
    const standup = await seedStandup(['U1']);
    const late = Math.floor(Number(THREAD)) + 7 * 3600; // past the six-hour deadline
    const slack = fakeSlack([
      { ts: THREAD, bot_id: 'B1', text: 'Standup started' },
      { ts: `${late}.0001`, user: 'U1', text: 'first attempt' },
      { ts: `${late + 60}.0001`, user: 'U1', text: 'corrected update' }
    ]);

    await backfillStandup(standup, slack, { apply: true }, emptyReport());

    const stored = await Response.findByStandupAndUser(standup._id, 'U1');
    assert.strictEqual(stored.rawMessage, 'corrected update');
    assert.strictEqual(stored.isLate, true);
    assert.strictEqual(slack.reactions.filter(r => r.name === 'white_check_mark').length, 1);
    assert.strictEqual(slack.reactions.filter(r => r.name === 'pencil2').length, 1);
  });

  test('repairs a participant count that drifted even with no replies to recover', async () => {
    // The residue of the lost-update race: the response row exists but the
    // standup forgot the participant.
    const standup = await seedStandup(['U1', 'U2']);
    const response = await Response.create({
      standupId: standup._id,
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U2',
      username: 'u2',
      messageTs: '1787059642.0001',
      threadTs: THREAD,
      submittedAt: new Date()
    });
    response.parseRawMessage('already recorded', standup.questions);
    await response.save();

    standup.actualParticipants = [];
    standup.updateStats();
    await standup.save();

    const report = emptyReport();
    await backfillStandup(standup, fakeSlack([{ ts: THREAD, bot_id: 'B1' }]), { apply: true }, report);

    assert.strictEqual(report.statsRepaired.length, 1);
    assert.deepStrictEqual(report.statsRepaired[0].before, 0);
    assert.deepStrictEqual(report.statsRepaired[0].after, 1);

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(reloaded.actualParticipants, ['U2']);
    assert.strictEqual(reloaded.stats.totalResponded, 1);
  });
});
