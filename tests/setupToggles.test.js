const { test, describe } = require('node:test');
const assert = require('node:assert');

const { extractFormData } = require('../handlers/views');
const { createSetupModal } = require('../handlers/commands/modalBuilder');
const { BLOCK_IDS } = require('../utils/constants');
const Standup = require('../models/Standup');
const StandupMessageBuilderService = require('../services/standupMessageBuilderService');

function formValues({ muteReminders = false, freeform = false } = {}) {
  const values = {
    [BLOCK_IDS.QUESTIONS_INPUT]: { [BLOCK_IDS.QUESTIONS_INPUT]: { value: 'What are you working on?' } },
    [BLOCK_IDS.TIME_SELECT]: { [BLOCK_IDS.TIME_SELECT]: { selected_option: { value: '09:00' } } },
    [BLOCK_IDS.DEADLINE_TIME_SELECT]: { [BLOCK_IDS.DEADLINE_TIME_SELECT]: { selected_option: { value: '18:00' } } },
    [BLOCK_IDS.DAYS_SELECT]: { [BLOCK_IDS.DAYS_SELECT]: { selected_options: [{ value: '1' }] } },
    [BLOCK_IDS.TIMEZONE_SELECT]: { [BLOCK_IDS.TIMEZONE_SELECT]: { selected_option: { value: 'UTC' } } }
  };
  if (muteReminders) {
    values[BLOCK_IDS.REMINDERS_TOGGLE] = {
      [BLOCK_IDS.REMINDERS_TOGGLE]: { selected_options: [{ value: 'mute_reminders' }] }
    };
  }
  if (freeform) {
    values[BLOCK_IDS.FREEFORM_TOGGLE] = {
      [BLOCK_IDS.FREEFORM_TOGGLE]: { selected_options: [{ value: 'freeform' }] }
    };
  }
  return values;
}

describe('setup form: reminder toggle', () => {
  test('reminders stay on when the box is not ticked', () => {
    assert.strictEqual(extractFormData(formValues()).enableReminders, true);
  });

  test('ticking the box turns reminders off', () => {
    // The box asks whether to mute; the stored flag says whether to send, so
    // the two are deliberately inverse.
    assert.strictEqual(extractFormData(formValues({ muteReminders: true })).enableReminders, false);
  });

  test('an absent block reads as reminders on', () => {
    const values = formValues();
    delete values[BLOCK_IDS.REMINDERS_TOGGLE];
    assert.strictEqual(extractFormData(values).enableReminders, true);
  });

  test('an empty selection reads as reminders on', () => {
    const values = formValues();
    values[BLOCK_IDS.REMINDERS_TOGGLE] = { [BLOCK_IDS.REMINDERS_TOGGLE]: { selected_options: [] } };
    assert.strictEqual(extractFormData(values).enableReminders, true);
  });

  test('the two checkboxes are independent', () => {
    const both = extractFormData(formValues({ muteReminders: true, freeform: true }));
    assert.strictEqual(both.enableReminders, false);
    assert.strictEqual(both.freeformPrompt, true);

    const neither = extractFormData(formValues());
    assert.strictEqual(neither.enableReminders, true);
    assert.strictEqual(neither.freeformPrompt, false);
  });
});

describe('setup modal: reminder checkbox state', () => {
  function ticked(channel) {
    const modal = createSetupModal({ id: 'C1', name: 'eng' }, channel, 'UTC');
    const block = modal.blocks.find(b => b.block_id === BLOCK_IDS.REMINDERS_TOGGLE);
    return !!block.element.initial_options;
  }

  test('unticked for a brand new channel', () => {
    assert.strictEqual(ticked(null), false);
  });

  test('unticked for a channel configured before the toggle existed', () => {
    // Those configs carry enableReminders: true, so nothing changes for them.
    assert.strictEqual(ticked({ config: { questions: ['Q?'], enableReminders: true, time: '09:00', days: [1] } }), false);
  });

  test('unticked when the field is missing entirely', () => {
    assert.strictEqual(ticked({ config: { questions: ['Q?'], time: '09:00', days: [1] } }), false);
  });

  test('ticked only when reminders were explicitly turned off', () => {
    assert.strictEqual(ticked({ config: { questions: ['Q?'], enableReminders: false, time: '09:00', days: [1] } }), true);
  });
});

describe('standup message: who gets mentioned', () => {
  const builder = new StandupMessageBuilderService(null);
  const participants = [{ id: 'U1' }, { id: 'U2' }, { id: 'U3' }];

  function mentionLine(channel) {
    const standup = new Standup({
      teamId: 'T1', channelId: 'C1', questions: ['Q?'],
      expectedParticipants: ['U1', 'U2', 'U3'],
      responseDeadline: new Date('2026-08-19T18:00:00Z')
    });
    const { blocks } = builder.createStandupMessage(standup, participants, channel);
    return blocks[0].text.text;
  }

  test('a channel set to all members gets a single @channel', () => {
    const text = mentionLine({ config: { participants: [] } });
    assert.ok(text.includes('<!channel>'), 'should ping the channel');
    assert.ok(!text.includes('<@U1>'), 'and not list people individually');
  });

  test('a channel with a named list still mentions those people', () => {
    const text = mentionLine({ config: { participants: ['U1', 'U2', 'U3'] } });
    assert.ok(text.includes('<@U1> <@U2> <@U3>'));
    assert.ok(!text.includes('<!channel>'));
  });

  test('a missing or malformed channel config falls back to @channel', () => {
    // createStandupMessage is called with the channel record; guard against it
    // arriving without config rather than throwing mid-post.
    assert.ok(mentionLine({}).includes('<!channel>'));
    assert.ok(mentionLine(undefined).includes('<!channel>'));
    assert.ok(mentionLine({ config: {} }).includes('<!channel>'));
  });
});
