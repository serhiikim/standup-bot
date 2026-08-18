const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-scheduler.db');
process.env.SQLITE_DB_PATH = testDbPath;
delete process.env.MONGODB_URI;

const database = require('../config/database');
const scheduler = require('../jobs/scheduler');

const CHANNEL = {
  teamId: 'T1',
  channelId: 'C1',
  config: { timezone: 'UTC', time: '09:00' }
};

async function insertStandup(startedAt) {
  await database.getDb().collection('standups').insertOne({
    teamId: 'T1',
    channelId: 'C1',
    questions: ['Q?'],
    expectedParticipants: ['U1'],
    startedAt,
    status: 'active',
    stats: { totalExpected: 1, totalResponded: 0, responseRate: 0, avgResponseTime: 0, remindersSent: 0 }
  });
}

describe('Scheduler.hasStandupToday: duplicate guard', () => {
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
  });

  test('detects a standup stored with an ISO-string startedAt', async () => {
    // SQLite round-trips documents through JSON, so dates come back as strings.
    // Intl.DateTimeFormat.format() does not parse strings; it threw RangeError
    // on every row and the guard reported "no standup today" every time.
    await insertStandup(new Date().toISOString());

    const raw = await database.getDb().collection('standups').findOne({ teamId: 'T1' });
    assert.strictEqual(typeof raw.startedAt, 'string', 'precondition: SQLite returns a string');

    assert.strictEqual(await scheduler.hasStandupToday(CHANNEL), true);
  });

  test('detects a standup stored as a Date, as Mongo would return it', async () => {
    await insertStandup(new Date());
    assert.strictEqual(await scheduler.hasStandupToday(CHANNEL), true);
  });

  test('reports no standup when none ran today', async () => {
    // Inside the 24h query window but on the previous calendar day in UTC.
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(23, 30, 0, 0);
    await insertStandup(yesterday.toISOString());

    assert.strictEqual(await scheduler.hasStandupToday(CHANNEL), false);
  });

  test('reports no standup for an empty channel', async () => {
    assert.strictEqual(await scheduler.hasStandupToday(CHANNEL), false);
  });

  test('does not confuse another channel’s standup for this one', async () => {
    await database.getDb().collection('standups').insertOne({
      teamId: 'T1',
      channelId: 'C_OTHER',
      startedAt: new Date().toISOString(),
      status: 'active'
    });

    assert.strictEqual(await scheduler.hasStandupToday(CHANNEL), false);
  });

  test('fails safe when the lookup throws', async () => {
    // Skipping a standup is recoverable by hand; posting a duplicate to the
    // whole channel is not, so an unexpected failure must not green-light one.
    const broken = { teamId: 'T1', channelId: 'C1', config: { timezone: 'Not/AZone' } };
    assert.strictEqual(await scheduler.hasStandupToday(broken), true);
  });
});
