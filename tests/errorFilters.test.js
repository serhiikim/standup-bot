const { test, describe } = require('node:test');
const assert = require('node:assert');

const { isSocketModeDisconnect } = require('../utils/errorFilters');

// The exact rejection observed in production, several times a day.
function socketModeReconnectError() {
  const err = new Error("Unhandled event 'server explicit disconnect' in state 'connecting'");
  err.stack = [
    "Error: Unhandled event 'server explicit disconnect' in state 'connecting'",
    '    at StateMachine.handleUnhandledEvent (/app/node_modules/finity/lib/core/StateMachine.js:76:13)',
    '    at SocketModeClient.onWebSocketMessage (/app/node_modules/@slack/socket-mode/dist/SocketModeClient.js:608:31)'
  ].join('\n');
  return err;
}

describe('isSocketModeDisconnect', () => {
  test('recognises the finity reconnect race seen in production', () => {
    assert.strictEqual(isSocketModeDisconnect(socketModeReconnectError()), true);
  });

  test('recognises other socket-mode disconnect wording', () => {
    assert.strictEqual(isSocketModeDisconnect(new Error('server explicit disconnect')), true);
    assert.strictEqual(isSocketModeDisconnect(new Error('socket-mode client failed')), true);
  });

  test('does not swallow an application error that merely mentions a disconnect', () => {
    // The previous inline check matched a bare "disconnect" anywhere, which
    // would have hidden a real database failure.
    assert.strictEqual(isSocketModeDisconnect(new Error('MongoDB disconnect: topology closed')), false);
  });

  test('does not swallow a finity-shaped message from application code', () => {
    const err = new Error("Unhandled event 'x' in state 'y'");
    err.stack = 'Error\n    at StandupService.checkStandupCompletion (/app/services/standupService.js:1:1)';
    assert.strictEqual(isSocketModeDisconnect(err), false, 'no Slack frames means it is our bug, so crash');
  });

  test('ordinary errors are fatal', () => {
    assert.strictEqual(isSocketModeDisconnect(new TypeError('x is not a function')), false);
    assert.strictEqual(isSocketModeDisconnect(new Error('ECONNREFUSED')), false);
  });

  test('handles non-Error rejection values without throwing', () => {
    assert.strictEqual(isSocketModeDisconnect(undefined), false);
    assert.strictEqual(isSocketModeDisconnect(null), false);
    assert.strictEqual(isSocketModeDisconnect(''), false);
    assert.strictEqual(isSocketModeDisconnect('server explicit disconnect'), true);
    assert.strictEqual(isSocketModeDisconnect({ message: 'socket-mode down' }), true);
    assert.strictEqual(isSocketModeDisconnect(42), false);
  });
});
