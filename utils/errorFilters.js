// @slack/socket-mode drives its websocket through a finity state machine that
// throws when a disconnect event arrives in a state it has no transition for
// ("Unhandled event 'server explicit disconnect' in state 'connecting'"). The
// client reconnects on its own, so these surface as noise rather than as a
// reason to bring the process down.
const FINITY_UNHANDLED_EVENT = /Unhandled event .+ in state /i;

function isSocketModeDisconnect(error) {
  if (!error) {
    return false;
  }

  const message = typeof error === 'string' ? error : (error.message || '');
  const stack = (typeof error === 'object' && error.stack) || '';

  // The finity throw only counts when it comes from the Slack client, so an
  // application error that happens to phrase itself the same way still crashes.
  if (FINITY_UNHANDLED_EVENT.test(message) && /socket-mode|finity/i.test(stack)) {
    return true;
  }

  return /socket-mode|server explicit disconnect/i.test(message);
}

module.exports = { isSocketModeDisconnect };
