const { test, describe } = require('node:test');
const assert = require('node:assert');

const Standup = require('../models/Standup');

function standupWith(expected, participants) {
  const s = new Standup({
    teamId: 'T1',
    channelId: 'C1',
    questions: ['Q?'],
    expectedParticipants: expected,
    actualParticipants: participants
  });
  s.stats.totalExpected = expected.length;
  return s;
}

describe('Standup.updateStats', () => {
  test('derives from actualParticipants when called with no argument', () => {
    const s = standupWith(['U1', 'U2', 'U3', 'U4'], ['U1', 'U2']);
    s.updateStats();
    assert.strictEqual(s.stats.totalResponded, 2);
    assert.strictEqual(s.stats.responseRate, 50);
  });

  test('honours figures passed in by the caller', () => {
    // The completion service counts stored responses and passes them here. The
    // no-argument signature used to drop that object on the floor, so the
    // reported total always came from actualParticipants instead.
    const s = standupWith(['U1', 'U2', 'U3', 'U4'], ['U1', 'U2']);
    s.updateStats({ totalResponded: 4, responseRate: 100, avgResponseTime: 1234 });

    assert.strictEqual(s.stats.totalResponded, 4, 'the passed count must win');
    assert.strictEqual(s.stats.responseRate, 100);
    assert.strictEqual(s.stats.avgResponseTime, 1234, 'avgResponseTime must be stored');
  });

  test('a partial update leaves the other figures alone', () => {
    const s = standupWith(['U1', 'U2'], ['U1']);
    s.updateStats();
    s.updateStats({ avgResponseTime: 999 });

    assert.strictEqual(s.stats.avgResponseTime, 999);
    assert.strictEqual(s.stats.totalResponded, 1, 'untouched by a partial update');
    assert.strictEqual(s.stats.totalExpected, 2);
  });

  test('handles a standup nobody answered', () => {
    const s = standupWith(['U1', 'U2'], []);
    s.updateStats();
    assert.strictEqual(s.stats.totalResponded, 0);
    assert.strictEqual(s.stats.responseRate, 0);
  });

  test('does not divide by zero when nobody was expected', () => {
    const s = standupWith([], []);
    s.updateStats();
    assert.strictEqual(s.stats.responseRate, 0);
  });
});
