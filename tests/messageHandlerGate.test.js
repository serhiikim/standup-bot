const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const events = require('../handlers/events');
const Standup = require('../models/Standup');

// Registering the handler only stores the app on a few service objects, so a
// stub app is enough to capture the real listener and fire events at it.
let messageHandler;
let lookups;
let originalFindByThreadTs;

function fireEvent(event) {
  return messageHandler({ event, client: { reactions: { add: async () => {} } } });
}

describe('message handler: which events reach the standup lookup', () => {
  before(() => {
    const handlers = {};
    const stubApp = { event: (name, fn) => { handlers[name] = fn; } };
    events.register(stubApp);
    messageHandler = handlers.message;
    assert.ok(messageHandler, 'the message listener must be registered');

    // The first thing past the early-return gates. Returning null stops the
    // handler right there, so nothing else is touched.
    originalFindByThreadTs = Standup.findByThreadTs;
    Standup.findByThreadTs = async (teamId, threadTs) => {
      lookups.push({ teamId, threadTs });
      return null;
    };
  });

  after(() => {
    Standup.findByThreadTs = originalFindByThreadTs;
  });

  beforeEach(() => {
    lookups = [];
  });

  const threadReply = {
    team: 'T1',
    channel: 'C1',
    user: 'U1',
    ts: '1700000001.0002',
    thread_ts: '1700000000.0001'
  };

  test('a plain thread reply gets through', async () => {
    await fireEvent({ ...threadReply, text: 'Yesterday: shipped X' });
    assert.strictEqual(lookups.length, 1, 'should reach the standup lookup');
  });

  test('a screenshot with a caption gets through', async () => {
    await fireEvent({
      ...threadReply,
      subtype: 'file_share',
      text: 'Here is the new dashboard',
      files: [{ title: 'dashboard.png' }]
    });
    assert.strictEqual(lookups.length, 1, 'file_share must no longer be dropped');
  });

  test('a screenshot with no caption still gets through', async () => {
    await fireEvent({
      ...threadReply,
      subtype: 'file_share',
      text: '',
      files: [{ title: 'dashboard.png' }]
    });
    assert.strictEqual(lookups.length, 1, 'a file-only reply is described, not discarded');
  });

  test('a reply broadcast to the channel gets through', async () => {
    await fireEvent({ ...threadReply, subtype: 'thread_broadcast', text: 'On track today' });
    assert.strictEqual(lookups.length, 1);
  });

  test('a huddle in the thread is stopped before the lookup', async () => {
    await fireEvent({ ...threadReply, subtype: 'huddle_thread', text: '' });
    assert.strictEqual(lookups.length, 0);
  });

  test('channel noise is stopped before the lookup', async () => {
    for (const subtype of ['channel_join', 'channel_leave', 'bot_message', 'message_deleted']) {
      await fireEvent({ ...threadReply, subtype, text: 'whatever' });
    }
    assert.strictEqual(lookups.length, 0);
  });

  test('a message outside a thread is ignored', async () => {
    const { thread_ts, ...noThread } = threadReply;
    await fireEvent({ ...noThread, text: 'just chatting in the channel' });
    assert.strictEqual(lookups.length, 0);
  });

  test('bot messages are ignored even in a standup thread', async () => {
    await fireEvent({ ...threadReply, bot_id: 'B123', text: 'automated post' });
    assert.strictEqual(lookups.length, 0);
  });

  test('an empty message with no attachments is ignored', async () => {
    await fireEvent({ ...threadReply, subtype: 'file_share', text: '   ', files: [] });
    assert.strictEqual(lookups.length, 0, 'nothing worth recording, so no lookup');
  });

  test('a native edit is read from the nested message payload', async () => {
    await fireEvent({
      subtype: 'message_changed',
      team: 'T1',
      channel: 'C1',
      message: { ...threadReply, text: 'Corrected: shipped Y' }
    });
    assert.strictEqual(lookups.length, 1, 'edits must still be processed');
    assert.strictEqual(lookups[0].threadTs, threadReply.thread_ts);
  });

  test('a native edit of a file post reads files from the nested message', async () => {
    await fireEvent({
      subtype: 'message_changed',
      team: 'T1',
      channel: 'C1',
      message: { ...threadReply, text: '', files: [{ title: 'v2.png' }] }
    });
    assert.strictEqual(lookups.length, 1);
  });
});
