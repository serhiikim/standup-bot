const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-reminders.db');
process.env.SQLITE_DB_PATH = testDbPath;
delete process.env.MONGODB_URI;

const database = require('../config/database');
const Standup = require('../models/Standup');
const StandupReminderService = require('../services/standupReminderService');
const { REMINDER_LEAD_TIME } = require('../utils/constants');

const MINUTE = 60 * 1000;

function fakeSlack() {
  const dms = [];
  return {
    dms,
    sendDM: async (userId, text) => { dms.push({ userId, text }); },
    getPermalink: async () => null
  };
}

async function insertChannel(enableReminders) {
  await database.getDb().collection('channels').insertOne({
    teamId: 'T1',
    channelId: 'C1',
    config: { enableReminders, timezone: 'UTC' }
  });
}

async function insertStandup({ nextReminderAt, deadlineInMs = 20 * MINUTE }) {
  const result = await database.getDb().collection('standups').insertOne({
    teamId: 'T1',
    channelId: 'C1',
    questions: ['Q?'],
    expectedParticipants: ['U1', 'U2'],
    actualParticipants: ['U2'],
    startedAt: new Date(),
    responseDeadline: new Date(Date.now() + deadlineInMs),
    status: 'active',
    reminders: { sent: [], nextReminderAt },
    stats: { totalExpected: 2, totalResponded: 1, responseRate: 50, avgResponseTime: 0, remindersSent: 0 }
  });
  return result.insertedId;
}

describe('reminderTimeFor: one reminder before the deadline', () => {
  test('lands REMINDER_LEAD_TIME before the deadline', () => {
    const now = new Date('2026-09-24T09:00:00Z');
    const deadline = new Date('2026-09-24T12:00:00Z');
    const at = StandupReminderService.reminderTimeFor(deadline, now);
    assert.strictEqual(at.getTime(), deadline.getTime() - REMINDER_LEAD_TIME);
  });

  test('a window shorter than the lead time gets no reminder', () => {
    // It used to fall back to "now", so the reminder DM arrived together with
    // the standup post itself.
    const now = new Date('2026-09-24T09:00:00Z');
    const deadline = new Date('2026-09-24T09:20:00Z');
    assert.strictEqual(StandupReminderService.reminderTimeFor(deadline, now), null);
  });

  test('accepts a deadline stored as an ISO string', () => {
    const now = new Date('2026-09-24T09:00:00Z');
    const at = StandupReminderService.reminderTimeFor('2026-09-24T12:00:00.000Z', now);
    assert.strictEqual(at.toISOString(), '2026-09-24T11:30:00.000Z');
  });
});

describe('processPendingReminders', () => {
  before(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    await database.connect();
  });

  after(async () => {
    await database.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  beforeEach(async () => {
    await database.sqliteDb.exec('DELETE FROM standups');
    await database.sqliteDb.exec('DELETE FROM channels');
  });

  test('sends the due reminder once and schedules nothing after it', async () => {
    await insertChannel(true);
    const id = await insertStandup({ nextReminderAt: new Date(Date.now() - MINUTE) });
    const slack = fakeSlack();
    const service = new StandupReminderService(null, slack);

    assert.strictEqual(await service.processPendingReminders(), 1);
    assert.deepStrictEqual(slack.dms.map(d => d.userId), ['U1']);

    const standup = await Standup.findById(id);
    assert.strictEqual(standup.reminders.nextReminderAt, null);
    assert.strictEqual(standup.stats.remindersSent, 1);

    // A second tick finds nothing left to send.
    assert.strictEqual(await service.processPendingReminders(), 0);
    assert.strictEqual(slack.dms.length, 1);
  });

  test('turning reminders off stops one that was already scheduled', async () => {
    await insertChannel(false);
    const id = await insertStandup({ nextReminderAt: new Date(Date.now() - MINUTE) });
    const slack = fakeSlack();

    await new StandupReminderService(null, slack).processPendingReminders();

    assert.strictEqual(slack.dms.length, 0);
    const standup = await Standup.findById(id);
    assert.strictEqual(standup.reminders.nextReminderAt, null);
  });

  test('a manual reminder before the scheduled one keeps the schedule', async () => {
    await insertChannel(true);
    const scheduledAt = new Date(Date.now() + 10 * MINUTE);
    const id = await insertStandup({ nextReminderAt: scheduledAt });
    const slack = fakeSlack();

    assert.strictEqual(await new StandupReminderService(null, slack).sendReminders(id), true);

    assert.strictEqual(slack.dms.length, 1);
    const standup = await Standup.findById(id);
    assert.strictEqual(standup.reminders.nextReminderAt.getTime(), scheduledAt.getTime());
  });
});
