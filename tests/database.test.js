const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Set SQLite path for testing
const testDbPath = path.join(__dirname, 'test.db');
process.env.SQLITE_DB_PATH = testDbPath;
// Ensure MONGODB_URI is undefined so we default to SQLite
delete process.env.MONGODB_URI;

const database = require('../config/database');

describe('Database Adapter (SQLite Mock Mongo)', () => {
  before(async () => {
    // Delete test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    await database.connect();
  });

  after(async () => {
    await database.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('should connect to SQLite by default and create tables', () => {
    const db = database.getDb();
    assert.ok(db, 'Database should be defined');
    assert.ok(database.sqliteDb, 'sqliteDb connection should be present');
  });

  test('MockObjectId should behave like Mongo ObjectId', () => {
    const { ObjectId } = database;
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    
    assert.strictEqual(id1.toString().length, 24, 'ID length should be 24');
    assert.notStrictEqual(id1.toString(), id2.toString(), 'IDs should be unique');
    
    const id3 = new ObjectId(id1.toString());
    assert.strictEqual(id3.toString(), id1.toString(), 'Reconstructed ID should match');
    assert.ok(id1.equals(id3), 'equals method should return true for same ID');
  });

  test('collection operations: insertOne, findOne, updateOne, deleteOne', async () => {
    const col = database.getDb().collection('teams');
    const teamData = {
      teamId: 'T12345',
      teamName: 'Test Team',
      settings: {
        defaultTimezone: 'UTC',
        allowUserTimezones: true
      },
      createdAt: new Date()
    };

    // Test insertOne
    const insertResult = await col.insertOne(teamData);
    assert.ok(insertResult.insertedId, 'insertOne should return insertedId');
    assert.strictEqual(teamData._id, insertResult.insertedId, 'document _id should be set');

    // Test findOne (equality match)
    const found1 = await col.findOne({ teamId: 'T12345' });
    assert.ok(found1, 'should find team by teamId');
    assert.strictEqual(found1.teamName, 'Test Team');

    // Test findOne (nested property match)
    const foundNested = await col.findOne({ 'settings.defaultTimezone': 'UTC' });
    assert.ok(foundNested, 'should find team by nested property');

    // Test updateOne ($set)
    const updateResult = await col.updateOne(
      { teamId: 'T12345' },
      { $set: { teamName: 'Updated Team Name', 'settings.allowUserTimezones': false } }
    );
    assert.strictEqual(updateResult.modifiedCount, 1, 'should update 1 document');

    // Verify update
    const verifiedUpdate = await col.findOne({ teamId: 'T12345' });
    assert.strictEqual(verifiedUpdate.teamName, 'Updated Team Name');
    assert.strictEqual(verifiedUpdate.settings.allowUserTimezones, false);

    // Test find (cursor + toArray + sort + limit)
    await col.insertOne({ teamId: 'T2', teamName: 'B Team', sequence: 2 });
    await col.insertOne({ teamId: 'T3', teamName: 'A Team', sequence: 1 });

    const sortedList = await col.find({})
      .sort({ sequence: 1 })
      .toArray();
    
    // Test matches
    assert.ok(sortedList.length >= 3, 'should find all documents');
    
    const t3 = sortedList.find(t => t.teamId === 'T3');
    const t2 = sortedList.find(t => t.teamId === 'T2');
    if (t3 && t2) {
      const idxT3 = sortedList.indexOf(t3);
      const idxT2 = sortedList.indexOf(t2);
      assert.ok(idxT3 < idxT2, 'T3 should come before T2 when sorting by sequence ASC');
    }

    // Test deleteOne
    const deleteResult = await col.deleteOne({ teamId: 'T12345' });
    assert.strictEqual(deleteResult.deletedCount, 1, 'should delete 1 document');

    const checkDeleted = await col.findOne({ teamId: 'T12345' });
    assert.strictEqual(checkDeleted, null, 'deleted team should not exist');
  });

  test('collection operations: deleteMany, find with $in, $lt, $lte operators', async () => {
    const col = database.getDb().collection('standups');
    const dateNow = new Date();
    const datePast = new Date(dateNow.getTime() - 10000);
    const dateFuture = new Date(dateNow.getTime() + 10000);

    await col.deleteMany({}); // clear first

    await col.insertOne({ status: 'active', responseDeadline: datePast, label: 'expired' });
    await col.insertOne({ status: 'collecting', responseDeadline: dateFuture, label: 'pending' });
    await col.insertOne({ status: 'completed', responseDeadline: datePast, label: 'done' });

    // Test $in operator
    const activeStandups = await col.find({
      status: { $in: ['active', 'collecting'] }
    }).toArray();
    assert.strictEqual(activeStandups.length, 2, 'should find 2 active/collecting standups');

    // Test $lt operator
    const expiredStandups = await col.find({
      status: { $in: ['active', 'collecting'] },
      responseDeadline: { $lt: dateNow }
    }).toArray();
    assert.strictEqual(expiredStandups.length, 1, 'should find 1 expired active standup');
    assert.strictEqual(expiredStandups[0].label, 'expired');

    // Test deleteMany
    const deleted = await col.deleteMany({ status: { $in: ['active', 'collecting', 'completed'] } });
    assert.strictEqual(deleted.deletedCount, 3, 'should delete all 3 standups');
  });

  test('date comparison operators should reject null/undefined values', async () => {
    const col = database.getDb().collection('standups');
    await col.deleteMany({});

    // Simulate a standup with nextReminderAt = null (cleared reminder)
    await col.insertOne({ status: 'active', nextReminderAt: null, label: 'cleared' });
    // Simulate a standup with a valid past reminder
    const pastDate = new Date(Date.now() - 60000);
    await col.insertOne({ status: 'active', nextReminderAt: pastDate, label: 'due' });
    // Simulate a standup with a future reminder
    const futureDate = new Date(Date.now() + 60000);
    await col.insertOne({ status: 'active', nextReminderAt: futureDate, label: 'not_yet' });

    const now = new Date();

    // $lte should NOT match null
    const lteResults = await col.find({ nextReminderAt: { $lte: now } }).toArray();
    assert.strictEqual(lteResults.length, 1, '$lte should not match null values');
    assert.strictEqual(lteResults[0].label, 'due');

    // $lt should NOT match null
    const ltResults = await col.find({ nextReminderAt: { $lt: now } }).toArray();
    assert.strictEqual(ltResults.length, 1, '$lt should not match null values');

    // $gt should NOT match null
    const gtResults = await col.find({ nextReminderAt: { $gt: now } }).toArray();
    assert.strictEqual(gtResults.length, 1, '$gt should not match null values');
    assert.strictEqual(gtResults[0].label, 'not_yet');

    // $gte should NOT match null
    const gteResults = await col.find({ nextReminderAt: { $gte: now } }).toArray();
    assert.strictEqual(gteResults.length, 1, '$gte should not match null values');

    // $ne null should exclude the null document
    const neNullResults = await col.find({ nextReminderAt: { $ne: null } }).toArray();
    assert.strictEqual(neNullResults.length, 2, '$ne null should exclude null documents');

    // Combined $ne + $lte (the actual findNeedingReminders query pattern)
    const reminderQuery = await col.find({
      status: { $in: ['active', 'collecting'] },
      nextReminderAt: { $ne: null, $lte: now }
    }).toArray();
    assert.strictEqual(reminderQuery.length, 1, 'combined $ne null + $lte should only match due reminders');
    assert.strictEqual(reminderQuery[0].label, 'due');

    await col.deleteMany({});
  });

  test('$in operator should work with array document values', async () => {
    const col = database.getDb().collection('responses');
    await col.deleteMany({});

    // Simulate standups with expectedParticipants arrays
    await col.insertOne({
      status: 'active',
      expectedParticipants: ['U1', 'U2', 'U3'],
      label: 'standup1'
    });
    await col.insertOne({
      status: 'active',
      expectedParticipants: ['U4', 'U5'],
      label: 'standup2'
    });
    await col.insertOne({
      status: 'completed',
      expectedParticipants: ['U1'],
      label: 'standup3'
    });

    // $in on the status field (scalar) should still work
    const activeStandups = await col.find({
      status: { $in: ['active', 'collecting'] }
    }).toArray();
    assert.strictEqual(activeStandups.length, 2, 'should find 2 active standups');

    // Direct equality on array field — should match if array contains value
    const u1Standups = await col.find({
      expectedParticipants: 'U1'
    }).toArray();
    assert.strictEqual(u1Standups.length, 2, 'should find 2 standups containing U1');

    // $in where document field is an array — should match if any element is in opVal
    const inArrayResults = await col.find({
      expectedParticipants: { $in: ['U1', 'U4'] }
    }).toArray();
    assert.strictEqual(inArrayResults.length, 3, '$in should match documents where any array element is in the query values');

    await col.deleteMany({});
  });
});
