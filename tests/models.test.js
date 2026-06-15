const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, 'test-models.db');
process.env.SQLITE_DB_PATH = testDbPath;
delete process.env.MONGODB_URI;

const database = require('../config/database');
const Team = require('../models/Team');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');

describe('Models Database CRUD Verification', () => {
  before(async () => {
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

  test('Team CRUD operations', async () => {
    // 1. Create
    const team = await Team.create({
      teamId: 'T_TEST_1',
      teamName: 'Team One',
      installedBy: 'U_TEST'
    });

    assert.ok(team._id, 'Team should have _id');
    assert.strictEqual(team.teamName, 'Team One');

    // 2. Read (Find by Team ID)
    const found = await Team.findByTeamId('T_TEST_1');
    assert.ok(found, 'Should find team by Team ID');
    assert.strictEqual(found.teamName, 'Team One');
    
    // 3. Update (Static)
    const updated = await Team.updateByTeamId('T_TEST_1', { teamName: 'Team One Updated' });
    assert.strictEqual(updated, true);
    
    const verified = await Team.findByTeamId('T_TEST_1');
    assert.strictEqual(verified.teamName, 'Team One Updated');

    // 4. Update (Instance save)
    verified.teamName = 'Team One Instance Updated';
    await verified.save();
    
    const verified2 = await Team.findByTeamId('T_TEST_1');
    assert.strictEqual(verified2.teamName, 'Team One Instance Updated');

    // 5. Delete
    const deleted = await Team.deleteByTeamId('T_TEST_1');
    assert.strictEqual(deleted, true);
    
    const checkDeleted = await Team.findByTeamId('T_TEST_1');
    assert.strictEqual(checkDeleted, null);
  });

  test('Model default response timeout constants verification', () => {
    const { DEFAULT_RESPONSE_TIMEOUT } = require('../utils/constants');
    
    const defaultTeam = new Team({ teamId: 'T_DEFAULT', teamName: 'Default Team' });
    assert.strictEqual(defaultTeam.settings.maxResponseTime, DEFAULT_RESPONSE_TIMEOUT, 'Team maxResponseTime should default to DEFAULT_RESPONSE_TIMEOUT');

    const defaultChannel = new Channel({ teamId: 'T_DEFAULT', channelId: 'C_DEFAULT', channelName: 'Default Channel' });
    assert.strictEqual(defaultChannel.config.responseTimeout, DEFAULT_RESPONSE_TIMEOUT, 'Channel responseTimeout should default to DEFAULT_RESPONSE_TIMEOUT');
  });

  test('Channel CRUD operations', async () => {
    // 1. Create
    const channel = await Channel.create({
      teamId: 'T_TEST',
      channelId: 'C_TEST',
      channelName: 'general',
      config: {
        questions: ['Q1', 'Q2'],
        time: '09:00',
        days: ['monday', 'wednesday'],
        timezone: 'America/New_York'
      }
    });

    assert.ok(channel._id);
    assert.strictEqual(channel.channelName, 'general');
    assert.deepStrictEqual(channel.config.days, ['monday', 'wednesday']);

    // 2. Read
    const found = await Channel.findByChannelId('T_TEST', 'C_TEST');
    assert.ok(found);
    assert.strictEqual(found.channelName, 'general');

    // 3. Update
    found.updateConfig({ time: '10:00', days: ['monday', 'friday'] });
    await found.save();

    const verified = await Channel.findByChannelId('T_TEST', 'C_TEST');
    assert.strictEqual(verified.config.time, '10:00');
    assert.deepStrictEqual(verified.config.days, ['monday', 'friday']);

    // 4. Clean up
    const deleted = await Channel.deleteByChannelId('T_TEST', 'C_TEST');
    assert.strictEqual(deleted, true);
  });

  test('Standup and Response logic', async () => {
    // 1. Create Standup
    const standup = await Standup.create({
      teamId: 'T_STANDUP',
      channelId: 'C_STANDUP',
      questions: ['Q1', 'Q2'],
      expectedParticipants: ['U1', 'U2'],
      responseDeadline: new Date(Date.now() + 1000 * 60)
    });

    assert.ok(standup._id);
    assert.strictEqual(standup.stats.totalExpected, 2);
    assert.strictEqual(standup.stats.totalResponded, 0);

    // 2. Create Response
    const response = await Response.create({
      standupId: standup._id,
      teamId: 'T_STANDUP',
      channelId: 'C_STANDUP',
      userId: 'U1',
      username: 'alice',
      responses: ['My update for Q1', 'My update for Q2'],
      isComplete: true
    });

    assert.ok(response._id);
    assert.strictEqual(response.responses[0], 'My update for Q1');

    // 3. Update Standup actualParticipants and stats
    standup.addParticipant('U1');
    await standup.save();

    const verifiedStandup = await Standup.findById(standup._id);
    assert.strictEqual(verifiedStandup.stats.totalResponded, 1);
    assert.strictEqual(verifiedStandup.stats.responseRate, 50);

    // 4. Find Response by Standup and User
    const foundResp = await Response.findByStandupAndUser(standup._id, 'U1');
    assert.ok(foundResp);
    assert.strictEqual(foundResp.username, 'alice');

    // 5. Clean up
    await standup.delete();
    await response.delete();

    const checkStandup = await Standup.findById(standup._id);
    const checkResp = await Response.findById(response._id);
    assert.strictEqual(checkStandup, null);
    assert.strictEqual(checkResp, null);
  });

  test('Response checkCompletion always marks complete', () => {
    // Any submission should be treated as complete
    const fullResponse = new Response({
      standupId: 'test',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      username: 'alice',
      responses: ['answer1', 'answer2']
    });
    fullResponse.checkCompletion();
    assert.strictEqual(fullResponse.isComplete, true, 'full response should be complete');

    // Even partial responses should be marked complete
    const partialResponse = new Response({
      standupId: 'test',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U2',
      username: 'bob',
      responses: ['answer1', ''] // second answer empty
    });
    partialResponse.checkCompletion();
    assert.strictEqual(partialResponse.isComplete, true, 'partial response should also be complete');
  });

  test('Response markAsEdited sets edit metadata', () => {
    const response = new Response({
      standupId: 'test',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      username: 'alice',
      responses: ['original answer']
    });

    assert.strictEqual(response.isEdited, false, 'should not be edited initially');
    
    response.markAsEdited();
    assert.strictEqual(response.isEdited, true, 'should be marked as edited');
    assert.ok(response.lastEditedAt instanceof Date, 'lastEditedAt should be a Date');
    assert.strictEqual(response.editCount, 1, 'editCount should be 1');

    response.markAsEdited();
    assert.strictEqual(response.editCount, 2, 'editCount should increment');
  });

  test('Team validation does not require accessToken', () => {
    const result = Team.validate({
      teamId: 'T1',
      teamName: 'Test Team'
    });
    assert.strictEqual(result.isValid, true, 'should be valid without accessToken');
    assert.strictEqual(result.errors.length, 0, 'should have no errors');
  });

  test('parseRawMessage stores raw message without splitting', () => {
    const questions = ['Yesterday?', 'Today?', 'Blockers?'];

    const response = new Response({
      standupId: 'test', teamId: 'T1', channelId: 'C1',
      userId: 'U1', username: 'alice'
    });

    const message = '1. Fixed auth bug\nAlso reviewed PRs\n2. Working on tests\n3. None';
    response.parseRawMessage(message, questions);

    // Raw message is preserved exactly
    assert.strictEqual(response.rawMessage, message);
    // responses array holds the full message as a single entry
    assert.strictEqual(response.responses.length, 1);
    assert.strictEqual(response.responses[0], message);
    // Any submission is complete
    assert.strictEqual(response.isComplete, true);
  });
});
