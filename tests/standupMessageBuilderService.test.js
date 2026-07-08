const { test, describe } = require('node:test');
const assert = require('node:assert');

const StandupMessageBuilderService = require('../services/standupMessageBuilderService');

describe('StandupMessageBuilderService.truncateSummary', () => {
  const service = new StandupMessageBuilderService(null);

  test('returns the original text unchanged when under the limit', () => {
    const summary = 'Short summary with no truncation needed.';
    assert.strictEqual(service.truncateSummary(summary), summary);
  });

  test('leaves text exactly at the limit unchanged', () => {
    const summary = 'x'.repeat(2800);
    assert.strictEqual(service.truncateSummary(summary), summary);
  });

  test('truncates at the last full line before the limit, not mid-token', () => {
    // Each line ends with a markdown link; a naive hard cut at 2800 chars
    // would land inside one of these `[text](url)` spans.
    const line = '* @User: Worked on [Some Task Name](https://app.asana.com/1/15079836269213/project/768069324069921/task/1213013389296984?focus=true).\n';
    const summary = line.repeat(40);

    const result = service.truncateSummary(summary);

    assert.ok(result.length < summary.length, 'result should be shorter than the input');
    assert.ok(result.endsWith('\n... (truncated)'), 'result should end with the truncation notice');
    // Whatever precedes the notice must be a sequence of whole lines, i.e.
    // it should not end with an unclosed markdown link like "[Some Task Na".
    const body = result.slice(0, -'\n... (truncated)'.length);
    assert.ok(body.length === 0 || body.endsWith('.'), 'cut should land at the end of a full line, not mid-link');
  });

  test('keeps the result under Slacks 3000-char block limit even with the AI Summary prefix', () => {
    const line = '* @User: Worked on [Some Task Name](https://app.asana.com/1/15079836269213/project/768069324069921/task/1213013389296984?focus=true).\n';
    const summary = line.repeat(60);

    const result = service.truncateSummary(summary);
    const blockText = `🤖 *AI Summary:*\n${result}`;

    assert.ok(blockText.length < 3000, `block text should stay under Slack's 3000-char limit, got ${blockText.length}`);
  });

  test('falls back to a hard cut when no newline exists near the limit', () => {
    const summary = 'a'.repeat(5000);

    const result = service.truncateSummary(summary);

    assert.ok(result.startsWith('a'.repeat(2800)), 'should hard-cut at maxLength when no safe line boundary is found');
    assert.ok(result.endsWith('\n... (truncated)'));
  });

  test('respects a custom maxLength', () => {
    const summary = 'line one\nline two\nline three\n' + 'x'.repeat(100);

    const result = service.truncateSummary(summary, 20);

    assert.ok(result.length < summary.length);
    assert.ok(result.endsWith('\n... (truncated)'));
  });
});
