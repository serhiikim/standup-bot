const { test, describe } = require('node:test');
const assert = require('node:assert');

const Response = require('../models/Response');

function newResponse(extra = {}) {
  return new Response({
    standupId: 'S1', teamId: 'T1', channelId: 'C1', userId: 'U1',
    threadTs: '1787058003.062999',
    ...extra
  });
}

describe('Response.recordMessage', () => {
  test('keeps both messages when someone splits their update', () => {
    // The old behaviour replaced the whole reply on every message, so a long
    // first post followed by a short addition left only the short one.
    const r = newResponse();
    r.recordMessage('1787058859.0001', 'Yesterday I finished the onboarding rewrite and shipped it');
    r.recordMessage('1787059642.0001', 'Also: no blockers');

    assert.strictEqual(r.messages.length, 2);
    assert.strictEqual(
      r.rawMessage,
      'Yesterday I finished the onboarding rewrite and shipped it\n\nAlso: no blockers'
    );
    assert.deepStrictEqual(r.responses, [r.rawMessage]);
  });

  test('re-recording the same timestamp replaces that message, as an edit does', () => {
    const r = newResponse();
    r.recordMessage('1787058859.0001', 'Working on the exporter');
    r.recordMessage('1787058859.0001', 'Working on the exporter (now merged)');

    assert.strictEqual(r.messages.length, 1, 'an edit must not append');
    assert.strictEqual(r.rawMessage, 'Working on the exporter (now merged)');
    assert.ok(r.messages[0].editedAt instanceof Date);
  });

  test('an edit to the first message leaves the second in place', () => {
    const r = newResponse();
    r.recordMessage('1787058859.0001', 'first');
    r.recordMessage('1787059642.0001', 'second');
    r.recordMessage('1787058859.0001', 'first, corrected');

    assert.strictEqual(r.rawMessage, 'first, corrected\n\nsecond');
  });

  test('orders messages by timestamp regardless of arrival order', () => {
    const r = newResponse();
    r.recordMessage('1787059642.0001', 'later');
    r.recordMessage('1787058859.0001', 'earlier');

    assert.strictEqual(r.rawMessage, 'earlier\n\nlater');
  });

  test('adopts the text of a reply stored before messages were tracked', () => {
    // Backward compatibility: rows written by the old code have no messages
    // array, only rawMessage. The next message must extend it, not erase it.
    const legacy = newResponse({
      rawMessage: 'Adding context: replaces the old signup',
      messageTs: '1787059642.0001',
      responses: ['Adding context: replaces the old signup']
    });
    assert.deepStrictEqual(legacy.messages, [], 'precondition: nothing tracked');

    legacy.recordMessage('1787060000.0001', 'And here is the demo');

    assert.strictEqual(legacy.messages.length, 2);
    assert.strictEqual(
      legacy.rawMessage,
      'Adding context: replaces the old signup\n\nAnd here is the demo'
    );
  });

  test('a recovered earlier message lands before the legacy text', () => {
    // The daily-drops case: the long message with screenshots is recovered
    // after the short follow-up was already stored.
    const legacy = newResponse({
      rawMessage: 'Adding context: replaces the old signup',
      messageTs: '1787059642.0001'
    });

    legacy.recordMessage('1787058859.0001', 'Here is the new onboarding flow');

    assert.strictEqual(
      legacy.rawMessage,
      'Here is the new onboarding flow\n\nAdding context: replaces the old signup',
      'the recovered message must come first and nothing may be lost'
    );
  });

  test('replaying the same thread twice changes nothing', () => {
    const r = newResponse();
    const thread = [['1787058859.0001', 'one'], ['1787059642.0001', 'two']];
    for (const [ts, text] of thread) r.recordMessage(ts, text);
    const first = r.rawMessage;
    for (const [ts, text] of thread) r.recordMessage(ts, text);

    assert.strictEqual(r.messages.length, 2, 'no duplicates on replay');
    assert.strictEqual(r.rawMessage, first);
  });

  test('marks the reply complete', () => {
    const r = newResponse();
    r.recordMessage('1787058859.0001', 'anything');
    assert.strictEqual(r.isComplete, true);
  });

  test('messages survive a toJSON round-trip', () => {
    const r = newResponse();
    r.recordMessage('1787058859.0001', 'one');
    r.recordMessage('1787059642.0001', 'two');

    const persisted = r.toJSON();
    assert.strictEqual(persisted.messages.length, 2, 'toJSON is a whitelist; messages must be in it');

    const reloaded = new Response(persisted);
    assert.strictEqual(reloaded.rawMessage, 'one\n\ntwo');
    reloaded.recordMessage('1787060000.0001', 'three');
    assert.strictEqual(reloaded.rawMessage, 'one\n\ntwo\n\nthree');
  });
});
