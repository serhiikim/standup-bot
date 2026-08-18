const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  shouldProcessSubtype,
  describeAttachments,
  resolveResponseText,
  ALLOWED_SUBTYPES
} = require('../handlers/events');

describe('shouldProcessSubtype: what reaches the standup handler', () => {
  test('a plain thread reply has no subtype and is always processed', () => {
    assert.strictEqual(shouldProcessSubtype(undefined, false), true);
    assert.strictEqual(shouldProcessSubtype('', false), true);
  });

  test('native edits keep their dedicated path', () => {
    assert.strictEqual(shouldProcessSubtype('message_changed', true), true);
  });

  test('accepts file uploads, which carry the typed text in the same message', () => {
    assert.strictEqual(shouldProcessSubtype('file_share', false), true);
  });

  test('accepts thread replies broadcast to the channel', () => {
    // Previously dropped, silently losing a full text response from someone
    // who ticked "Also send to #channel".
    assert.strictEqual(shouldProcessSubtype('thread_broadcast', false), true);
  });

  test('rejects huddles started inside a standup thread', () => {
    // Would otherwise pass every downstream gate (real user, real thread) and
    // register a junk response.
    assert.strictEqual(shouldProcessSubtype('huddle_thread', false), false);
  });

  test('rejects channel noise and bot messages', () => {
    for (const subtype of [
      'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose',
      'channel_name', 'channel_archive', 'pinned_item', 'unpinned_item',
      'bot_message', 'bot_add', 'bot_remove', 'reminder_add',
      'message_deleted', 'tombstone', 'me_message', 'ekm_access_denied'
    ]) {
      assert.strictEqual(shouldProcessSubtype(subtype, false), false, `${subtype} must stay out`);
    }
  });

  test('fails closed on a subtype Slack has not invented yet', () => {
    assert.strictEqual(shouldProcessSubtype('some_future_subtype', false), false);
  });

  test('the whitelist is exactly the two intended subtypes', () => {
    assert.deepStrictEqual([...ALLOWED_SUBTYPES].sort(), ['file_share', 'thread_broadcast']);
  });
});

describe('describeAttachments', () => {
  test('returns an empty string when there is nothing attached', () => {
    assert.strictEqual(describeAttachments([]), '');
    assert.strictEqual(describeAttachments(undefined), '');
    assert.strictEqual(describeAttachments(null), '');
  });

  test('names a single file', () => {
    assert.strictEqual(
      describeAttachments([{ title: 'new-dashboard.png' }]),
      '[shared 1 file: new-dashboard.png]'
    );
  });

  test('lists several files and pluralises', () => {
    assert.strictEqual(
      describeAttachments([{ title: 'before.png' }, { title: 'after.png' }]),
      '[shared 2 files: before.png, after.png]'
    );
  });

  test('falls back to name when title is missing', () => {
    assert.strictEqual(describeAttachments([{ name: 'demo.mp4' }]), '[shared 1 file: demo.mp4]');
  });

  test('still reports the count when no file has a usable label', () => {
    assert.strictEqual(describeAttachments([{}, {}]), '[shared 2 files]');
  });
});

describe('resolveResponseText: what gets recorded', () => {
  const files = [{ title: 'screenshot.png' }];

  test('text plus an attachment records the text verbatim', () => {
    // The whole point of allowing file_share: this text used to be thrown away.
    const text = 'Here is the new onboarding flow, still rough around the edges';
    assert.strictEqual(resolveResponseText(text, files), text);
  });

  test('does not trim or otherwise alter existing text', () => {
    const text = '  leading and trailing space is preserved  ';
    assert.strictEqual(resolveResponseText(text, []), text);
  });

  test('multi-line text survives intact', () => {
    const text = 'Yesterday: shipped X\nToday: on Y\nBlockers: none';
    assert.strictEqual(resolveResponseText(text, undefined), text);
  });

  test('a file-only reply is described rather than recorded blank', () => {
    assert.strictEqual(resolveResponseText('', files), '[shared 1 file: screenshot.png]');
    assert.strictEqual(resolveResponseText(undefined, files), '[shared 1 file: screenshot.png]');
  });

  test('whitespace-only text counts as no text', () => {
    assert.strictEqual(resolveResponseText('   \n  ', files), '[shared 1 file: screenshot.png]');
  });

  test('nothing at all resolves to an empty string, so the handler skips it', () => {
    // The handler returns early on a falsy result, so no blank response is
    // stored and the user is not falsely marked as having answered.
    assert.strictEqual(resolveResponseText('', []), '');
    assert.strictEqual(resolveResponseText(undefined, undefined), '');
  });
});
