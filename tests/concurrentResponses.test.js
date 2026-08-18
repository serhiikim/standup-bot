const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-concurrent.db');
process.env.SQLITE_DB_PATH = testDbPath;
delete process.env.MONGODB_URI;

const database = require('../config/database');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const SlackService = require('../services/slackService');
const StandupService = require('../services/standupService');
const events = require('../handlers/events');

let messageHandler;
const reactions = [];

function reply(user, ts, text) {
  return {
    team: 'T1',
    channel: 'C1',
    user,
    ts,
    thread_ts: '1700000000.0001',
    text
  };
}

function fire(event) {
  return messageHandler({
    event,
    client: {
      reactions: {
        add: async ({ name, timestamp }) => { reactions.push({ name, timestamp }); }
      }
    },
    context: { teamId: 'T1' }
  });
}

async function seedStandup(participants) {
  await database.sqliteDb.exec('DELETE FROM standups');
  await database.sqliteDb.exec('DELETE FROM responses');
  return Standup.create({
    teamId: 'T1',
    channelId: 'C1',
    questions: ['What are you working on?'],
    expectedParticipants: participants,
    threadTs: '1700000000.0001',
    messageTs: '1700000000.0001',
    status: 'active',
    responseDeadline: new Date(Date.now() + 3600000)
  });
}

describe('concurrent standup replies', () => {
  before(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await database.connect();

    // Keep the test off the network: neither user lookup nor the completion
    // pipeline is what is under test here.
    SlackService.prototype.getUserInfo = async (userId) => ({
      name: userId.toLowerCase(),
      profile: { display_name: userId },
      real_name: userId
    });
    StandupService.prototype.checkStandupCompletion = async () => ({ success: true });

    const handlers = {};
    events.register({ event: (name, fn) => { handlers[name] = fn; } });
    messageHandler = handlers.message;
  });

  after(async () => {
    await database.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  beforeEach(() => {
    reactions.length = 0;
  });

  test('two people replying at the same instant both land in actualParticipants', async () => {
    // The lost update: both handlers read the standup, each pushed itself onto
    // its own copy of actualParticipants, and save() rewrote the whole document
    // so the second write erased the first participant.
    const standup = await seedStandup(['U1', 'U2']);

    await Promise.all([
      fire(reply('U1', '1700000001.0001', 'U1: shipped the export job')),
      fire(reply('U2', '1700000002.0001', 'U2: reviewing the design'))
    ]);

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(
      [...reloaded.actualParticipants].sort(),
      ['U1', 'U2'],
      'neither participant may be erased by the other'
    );
    assert.strictEqual(reloaded.stats.totalResponded, 2);
    assert.strictEqual(reloaded.stats.responseRate, 100);
  });

  test('every concurrent reply is stored and acknowledged', async () => {
    const standup = await seedStandup(['U1', 'U2', 'U3', 'U4', 'U5']);

    await Promise.all(
      ['U1', 'U2', 'U3', 'U4', 'U5'].map((u, i) =>
        fire(reply(u, `170000000${i}.0009`, `${u} reporting in`))
      )
    );

    const reloaded = await Standup.findById(standup._id.toString());
    assert.strictEqual(reloaded.actualParticipants.length, 5);
    assert.strictEqual(reloaded.stats.totalResponded, 5);

    for (const u of ['U1', 'U2', 'U3', 'U4', 'U5']) {
      const stored = await Response.findByStandupAndUser(standup._id, u);
      assert.ok(stored, `${u} must have a stored response`);
      assert.strictEqual(stored.rawMessage, `${u} reporting in`);
    }

    const checkmarks = reactions.filter(r => r.name === 'white_check_mark');
    assert.strictEqual(checkmarks.length, 5, 'each first reply gets a checkmark');
  });

  test('a second message from the same person is queued, not discarded', async () => {
    // The old lock was keyed per user and returned early when held, so a
    // follow-up sent while the first was still processing vanished entirely.
    const standup = await seedStandup(['U1']);

    await Promise.all([
      fire(reply('U1', '1700000001.0001', 'first half of my update')),
      fire(reply('U1', '1700000001.0002', 'second half of my update'))
    ]);

    const stored = await Response.findByStandupAndUser(standup._id, 'U1');
    assert.ok(stored, 'the response must exist');
    assert.strictEqual(stored.rawMessage, 'second half of my update', 'the later message wins');
    assert.strictEqual(stored.isEdited, true, 'the follow-up was applied as an edit');

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(reloaded.actualParticipants, ['U1'], 'counted once, not twice');

    assert.strictEqual(reactions.filter(r => r.name === 'white_check_mark').length, 1);
    assert.strictEqual(reactions.filter(r => r.name === 'pencil2').length, 1);
  });

  test('replies to different standups are not serialised behind each other', async () => {
    // The lock is per standup, so unrelated channels must not block one another.
    await seedStandup(['U1']);
    const other = await Standup.create({
      teamId: 'T1',
      channelId: 'C2',
      questions: ['Q?'],
      expectedParticipants: ['U9'],
      threadTs: '1800000000.0001',
      status: 'active',
      responseDeadline: new Date(Date.now() + 3600000)
    });

    await Promise.all([
      fire(reply('U1', '1700000001.0001', 'channel one')),
      fire({ ...reply('U9', '1800000001.0001', 'channel two'), thread_ts: '1800000000.0001' })
    ]);

    const a = await Response.findByStandupAndUser(other._id, 'U9');
    assert.ok(a, 'the other standup got its response too');
  });

  test('a failing reaction does not abort the rest of the handler', async () => {
    // reactions.add used to run unguarded, so a missing reactions:write scope
    // threw past the response handling and skipped the completion check —
    // the standup would sit open with replies piling up.
    const standup = await seedStandup(['U1']);
    let completionRan = false;
    const originalCheck = StandupService.prototype.checkStandupCompletion;
    StandupService.prototype.checkStandupCompletion = async () => {
      completionRan = true;
      return { success: true };
    };

    try {
      await messageHandler({
        event: reply('U1', '1700000001.0007', 'my update'),
        client: {
          reactions: {
            add: async () => {
              const err = new Error('missing_scope');
              err.data = { error: 'missing_scope' };
              throw err;
            }
          }
        },
        context: { teamId: 'T1' }
      });
    } finally {
      StandupService.prototype.checkStandupCompletion = originalCheck;
    }

    const stored = await Response.findByStandupAndUser(standup._id, 'U1');
    assert.ok(stored, 'the response is still recorded');
    assert.strictEqual(completionRan, true, 'the completion check still runs');

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(reloaded.actualParticipants, ['U1']);
  });

  test('the production case: text plus screenshots, with no team on the payload', async () => {
    // Exactly what was posted to daily-drops and never recorded: a reply with a
    // caption and three attachments. Slack omits `team` on messages carrying
    // files, and the subtype is file_share — the two gates that dropped it.
    const standup = await seedStandup(['U0LV2NYSU']);

    await messageHandler({
      event: {
        channel: 'C1',
        user: 'U0LV2NYSU',
        ts: '1700000001.0003',
        thread_ts: '1700000000.0001',
        subtype: 'file_share',
        text: 'Shipped the new onboarding flow — before and after',
        files: [{ title: 'before.png' }, { title: 'after.png' }, { title: 'demo.mp4' }]
        // note: no `team` key at all
      },
      client: {
        reactions: {
          add: async ({ name, timestamp }) => { reactions.push({ name, timestamp }); }
        }
      },
      context: { teamId: 'T1' }
    });

    const stored = await Response.findByStandupAndUser(standup._id, 'U0LV2NYSU');
    assert.ok(stored, 'the reply must be recorded');
    assert.strictEqual(
      stored.rawMessage,
      'Shipped the new onboarding flow — before and after',
      'the caption is kept, not replaced by a file description'
    );

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(reloaded.actualParticipants, ['U0LV2NYSU']);
    assert.strictEqual(reloaded.stats.totalResponded, 1);

    assert.strictEqual(
      reactions.filter(r => r.name === 'white_check_mark').length, 1,
      'and the author finally gets a checkmark'
    );
  });

  test('the daily-drops sequence: photo reply, then a text reply 13 minutes later', async () => {
    // What actually happened: the same person posted twice. The first message
    // carried screenshots and arrived without `team`, so it was dropped; the
    // second was plain text, arrived with `team`, and was recorded. Only the
    // second one existed, and only it got a checkmark.
    const standup = await seedStandup(['U0LV2NYSU']);

    const client = {
      reactions: {
        add: async ({ name, timestamp }) => { reactions.push({ name, timestamp }); }
      }
    };

    // 13:14 — caption plus three attachments, no team on the payload.
    await messageHandler({
      event: {
        channel: 'C1',
        user: 'U0LV2NYSU',
        ts: '1787058859.000100',
        thread_ts: '1700000000.0001',
        subtype: 'file_share',
        text: 'Here is the new onboarding flow',
        files: [{ title: 'before.png' }, { title: 'after.png' }, { title: 'demo.mp4' }]
      },
      client,
      context: { teamId: 'T1' }
    });

    const afterFirst = await Response.findByStandupAndUser(standup._id, 'U0LV2NYSU');
    assert.ok(afterFirst, 'the photo reply is recorded on its own now');
    assert.strictEqual(afterFirst.rawMessage, 'Here is the new onboarding flow');
    assert.strictEqual(afterFirst.isEdited, false);
    assert.strictEqual(reactions.filter(r => r.name === 'white_check_mark').length, 1,
      'the photo reply is the one that gets the checkmark');

    // 13:27 — plain text, team present, as Slack sent it.
    await messageHandler({
      event: {
        team: 'T1',
        channel: 'C1',
        user: 'U0LV2NYSU',
        ts: '1787059642.000100',
        thread_ts: '1700000000.0001',
        text: 'Adding context: this replaces the old three-step signup'
      },
      client,
      context: { teamId: 'T1' }
    });

    const afterSecond = await Response.findByStandupAndUser(standup._id, 'U0LV2NYSU');
    assert.strictEqual(
      afterSecond.rawMessage,
      'Adding context: this replaces the old three-step signup',
      'the follow-up updates the same response, as it always did'
    );
    assert.strictEqual(afterSecond.isEdited, true, 'recorded as an edit, not a second response');
    assert.strictEqual(reactions.filter(r => r.name === 'pencil2').length, 1,
      'the follow-up gets a pencil, not a second checkmark');

    const reloaded = await Standup.findById(standup._id.toString());
    assert.deepStrictEqual(reloaded.actualParticipants, ['U0LV2NYSU'], 'counted once');
    assert.strictEqual(reloaded.stats.totalResponded, 1);
  });
});
