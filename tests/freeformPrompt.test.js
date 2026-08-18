const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-key';

const Standup = require('../models/Standup');
const StandupMessageBuilderService = require('../services/standupMessageBuilderService');
const LLMService = require('../services/llmService');
const { validateSetupForm, extractFormData } = require('../handlers/views');
const { BLOCK_IDS, LIMITS } = require('../utils/constants');

// The real-world ask that motivated free-form prompts: one multi-line request
// with bullets, well over the 200-char per-question limit.
const SHOWCASE_PROMPT = `Working on something cool right now? Take a minute to grab a few screenshots or a quick video and drop it here with a bit of context so we can share it.

Wondering what we're looking for?

- An update on a new feature you're working on
- A groundbreaking design that's never been seen before
- An awesome way you or a client is using their website
- New data or AI we're testing and integrating

Pretty much, if you're working on something today that you're excited about, we want to see it!`;

const LEGACY_QUESTIONS = [
  'What did you accomplish yesterday?',
  'What are you working on today?',
  'Any blockers or challenges?',
  'Any notes?'
];

function buildStandup(overrides = {}) {
  return new Standup({
    teamId: 'T1',
    channelId: 'C1',
    questions: [...LEGACY_QUESTIONS],
    expectedParticipants: ['U1'],
    responseDeadline: new Date('2026-08-18T18:00:00Z'),
    ...overrides
  });
}

function formValues({ questionsText, freeform }) {
  const values = {
    [BLOCK_IDS.QUESTIONS_INPUT]: {
      [BLOCK_IDS.QUESTIONS_INPUT]: { value: questionsText }
    },
    [BLOCK_IDS.TIME_SELECT]: {
      [BLOCK_IDS.TIME_SELECT]: { selected_option: { value: '09:00' } }
    },
    [BLOCK_IDS.DEADLINE_TIME_SELECT]: {
      [BLOCK_IDS.DEADLINE_TIME_SELECT]: { selected_option: { value: '18:00' } }
    },
    [BLOCK_IDS.DAYS_SELECT]: {
      [BLOCK_IDS.DAYS_SELECT]: { selected_options: [{ value: '1' }, { value: '2' }] }
    },
    [BLOCK_IDS.TIMEZONE_SELECT]: {
      [BLOCK_IDS.TIMEZONE_SELECT]: { selected_option: { value: 'UTC' } }
    }
  };
  if (freeform) {
    values[BLOCK_IDS.FREEFORM_TOGGLE] = {
      [BLOCK_IDS.FREEFORM_TOGGLE]: { selected_options: [{ value: 'freeform' }] }
    };
  }
  return values;
}

describe('Standup model: freeformPrompt persistence', () => {
  test('defaults to false for a standup document written before the field existed', () => {
    const legacy = new Standup({
      teamId: 'T1',
      channelId: 'C1',
      questions: [...LEGACY_QUESTIONS]
    });
    assert.strictEqual(legacy.freeformPrompt, false);
  });

  test('survives a toJSON round-trip', () => {
    // toJSON is a whitelist: a field missing from it is silently dropped on
    // save and the standup reverts to the classic format after a restart.
    const standup = buildStandup({ questions: [SHOWCASE_PROMPT], freeformPrompt: true });
    const persisted = standup.toJSON();

    assert.strictEqual(persisted.freeformPrompt, true, 'freeformPrompt must be present in toJSON output');

    const reloaded = new Standup(persisted);
    assert.strictEqual(reloaded.freeformPrompt, true, 'flag must survive a save/load cycle');
    assert.deepStrictEqual(reloaded.questions, [SHOWCASE_PROMPT]);
  });
});

describe('StandupMessageBuilderService: legacy standups are unchanged', () => {
  const service = new StandupMessageBuilderService(null);
  const participants = [{ id: 'U1' }, { id: 'U2' }];

  test('a standup with no freeformPrompt field still renders numbered questions', () => {
    const legacy = buildStandup(); // no freeformPrompt at all
    const { text, blocks } = service.createStandupMessage(legacy, participants, {});

    const rendered = blocks.map(b => b.text?.text).filter(Boolean);
    assert.ok(
      rendered.some(t => t === '*Please answer these questions in a reply to this thread:*'),
      'legacy header must be preserved'
    );
    LEGACY_QUESTIONS.forEach((q, i) => {
      assert.ok(
        rendered.some(t => t === `*${i + 1}.* ${q}`),
        `question ${i + 1} must still be numbered`
      );
    });
    assert.ok(text.includes('questions below'), 'legacy fallback text must be preserved');
  });

  test('an explicitly non-freeform standup renders numbered questions', () => {
    const legacy = buildStandup({ freeformPrompt: false });
    const { blocks } = service.createStandupMessage(legacy, participants, {});
    const rendered = blocks.map(b => b.text?.text).filter(Boolean);
    assert.ok(rendered.some(t => t === `*1.* ${LEGACY_QUESTIONS[0]}`));
  });

  test('a single question without the flag keeps its number (no accidental mode switch)', () => {
    // Length alone must not trigger free-form rendering — only the explicit flag.
    const single = buildStandup({ questions: ['What are you working on today?'] });
    const { blocks } = service.createStandupMessage(single, participants, {});
    const rendered = blocks.map(b => b.text?.text).filter(Boolean);
    assert.ok(rendered.some(t => t === '*1.* What are you working on today?'));
  });
});

describe('StandupMessageBuilderService: free-form rendering', () => {
  const service = new StandupMessageBuilderService(null);
  const participants = [{ id: 'U1' }];

  test('renders the ask verbatim, with no numbering', () => {
    const standup = buildStandup({ questions: [SHOWCASE_PROMPT], freeformPrompt: true });
    const { text, blocks } = service.createStandupMessage(standup, participants, {});

    const rendered = blocks.map(b => b.text?.text).filter(Boolean);
    assert.ok(rendered.some(t => t === SHOWCASE_PROMPT), 'the ask must be rendered verbatim');
    assert.ok(!rendered.some(t => t.startsWith('*1.*')), 'no question numbering in free-form mode');
    assert.ok(rendered.some(t => t === '*Please reply to this thread:*'), 'header should not say "questions"');
    assert.ok(text.includes('prompt below'), 'fallback text should not say "questions"');
  });

  test('preserves the blank lines and bullets of the original ask', () => {
    const standup = buildStandup({ questions: [SHOWCASE_PROMPT], freeformPrompt: true });
    const { blocks } = service.createStandupMessage(standup, participants, {});
    const promptBlock = blocks.map(b => b.text?.text).find(t => t && t.includes('Wondering'));

    assert.ok(promptBlock.includes('\n\n'), 'blank-line paragraph breaks must survive');
    assert.ok(promptBlock.includes('- An update on a new feature'), 'bullets must survive intact');
  });
});

describe('LLMService: prompt selection', () => {
  const service = LLMService.getInstance();

  test('legacy call signature still produces the structured standup prompt', () => {
    const prompt = service.createAnalysisPrompt(LEGACY_QUESTIONS, 'U1:\nDid stuff');
    assert.ok(prompt.includes('STANDUP QUESTIONS:'));
    assert.ok(prompt.includes('1. What did you accomplish yesterday?'));
    assert.ok(prompt.includes('active blockers'), 'legacy prompt keeps its blockers framing');
  });

  test('freeform=false is identical to omitting the argument', () => {
    const implicit = service.createAnalysisPrompt(LEGACY_QUESTIONS, 'U1:\nDid stuff');
    const explicit = service.createAnalysisPrompt(LEGACY_QUESTIONS, 'U1:\nDid stuff', false);
    assert.strictEqual(implicit, explicit);
  });

  test('freeform=true drops the blockers framing and keeps links', () => {
    const prompt = service.createAnalysisPrompt([SHOWCASE_PROMPT], 'U1:\nCheck this out https://demo.example', true);

    assert.ok(prompt.includes('STANDUP PROMPT:'), 'free-form prompt uses a singular header');
    assert.ok(!prompt.includes('STANDUP QUESTIONS:'), 'must not reuse the questions header');
    assert.ok(prompt.includes(SHOWCASE_PROMPT), 'the ask must be passed through verbatim');
    assert.ok(!prompt.includes('1. Working on something cool'), 'the ask must not be numbered');
    assert.ok(
      /Keep links exactly as they appear/.test(prompt),
      'free-form summaries must keep links rather than strip them'
    );
    assert.ok(
      !/Do NOT include URLs/.test(prompt),
      'the legacy URL-stripping rule must not leak into free-form mode'
    );
  });
});

describe('LLMService.analyzeStandupResponses: end-to-end prompt wiring', () => {
  // Captures the prompt the service would actually send, without a network call.
  function stubbedService(reply = 'summary text') {
    const service = LLMService.getInstance();
    const captured = {};
    const original = service.openai.chat.completions.create;
    service.openai.chat.completions.create = async (payload) => {
      captured.userContent = payload.messages.find(m => m.role === 'user').content;
      return { choices: [{ message: { content: reply } }] };
    };
    return {
      service,
      captured,
      restore: () => { service.openai.chat.completions.create = original; }
    };
  }

  const responses = [{ userId: 'U1', rawMessage: 'Shipped the new dashboard https://demo.example' }];

  test('a legacy standup gets the structured questions prompt', async () => {
    const { service, captured, restore } = stubbedService();
    try {
      const standup = buildStandup(); // no freeformPrompt field
      const result = await service.analyzeStandupResponses(standup, responses);

      assert.ok(captured.userContent.includes('STANDUP QUESTIONS:'), 'legacy standups keep the questions prompt');
      assert.ok(!captured.userContent.includes('STANDUP PROMPT:'));
      assert.strictEqual(result.summary, 'summary text');
    } finally {
      restore();
    }
  });

  test('a free-form standup gets the free-form prompt', async () => {
    const { service, captured, restore } = stubbedService();
    try {
      const standup = buildStandup({ questions: [SHOWCASE_PROMPT], freeformPrompt: true });
      await service.analyzeStandupResponses(standup, responses);

      assert.ok(captured.userContent.includes('STANDUP PROMPT:'), 'free-form standups switch prompts');
      assert.ok(!captured.userContent.includes('STANDUP QUESTIONS:'));
      assert.ok(captured.userContent.includes(SHOWCASE_PROMPT));
    } finally {
      restore();
    }
  });

  test('a standup reloaded from a pre-freeform document falls back to the legacy prompt', async () => {
    const { service, captured, restore } = stubbedService();
    try {
      // Simulates a document stored before the field existed.
      const stored = buildStandup().toJSON();
      delete stored.freeformPrompt;
      const standup = new Standup(stored);

      await service.analyzeStandupResponses(standup, responses);
      assert.ok(captured.userContent.includes('STANDUP QUESTIONS:'));
    } finally {
      restore();
    }
  });
});

describe('Setup form: validation and extraction', () => {
  test('without the toggle the ask is silently mangled into 7 questions', () => {
    // Every line here is under the 200-char cap and there are fewer than 10 of
    // them, so validation passes and the damage is invisible until it renders
    // in the channel as a numbered list of sentence fragments. That silent
    // mangling — not a validation error — is what the toggle exists to prevent.
    const { isValid } = validateSetupForm(formValues({ questionsText: SHOWCASE_PROMPT, freeform: false }));
    assert.strictEqual(isValid, true, 'legacy validation does not catch this');

    const data = extractFormData(formValues({ questionsText: SHOWCASE_PROMPT, freeform: false }));
    assert.strictEqual(data.questions.length, 7, 'the ask is split into fragments');
    assert.strictEqual(data.questions[2], "- An update on a new feature you're working on");
  });

  test('accepts the same ask when free-form IS checked', () => {
    const { isValid, errors } = validateSetupForm(formValues({ questionsText: SHOWCASE_PROMPT, freeform: true }));
    assert.strictEqual(isValid, true, `expected valid, got ${JSON.stringify(errors)}`);
  });

  test('extracts the whole textarea as one question in free-form mode', () => {
    const data = extractFormData(formValues({ questionsText: SHOWCASE_PROMPT, freeform: true }));
    assert.strictEqual(data.freeformPrompt, true);
    assert.strictEqual(data.questions.length, 1, 'the ask must not be split on newlines');
    assert.strictEqual(data.questions[0], SHOWCASE_PROMPT);
  });

  test('still splits on newlines when free-form is not checked', () => {
    const data = extractFormData(formValues({ questionsText: LEGACY_QUESTIONS.join('\n'), freeform: false }));
    assert.strictEqual(data.freeformPrompt, false);
    assert.deepStrictEqual(data.questions, LEGACY_QUESTIONS);
  });

  test('treats an absent toggle block as legacy (unchecked)', () => {
    const values = formValues({ questionsText: LEGACY_QUESTIONS.join('\n'), freeform: false });
    delete values[BLOCK_IDS.FREEFORM_TOGGLE];
    const data = extractFormData(values);
    assert.strictEqual(data.freeformPrompt, false);
  });

  test('treats an empty selected_options array as unchecked', () => {
    const values = formValues({ questionsText: LEGACY_QUESTIONS.join('\n'), freeform: false });
    values[BLOCK_IDS.FREEFORM_TOGGLE] = {
      [BLOCK_IDS.FREEFORM_TOGGLE]: { selected_options: [] }
    };
    const data = extractFormData(values);
    assert.strictEqual(data.freeformPrompt, false);
  });

  test('rejects an empty prompt in free-form mode', () => {
    const { isValid } = validateSetupForm(formValues({ questionsText: '   ', freeform: true }));
    assert.strictEqual(isValid, false);
  });

  test('rejects a free-form prompt over the size limit', () => {
    const tooLong = 'x'.repeat(LIMITS.MAX_FREEFORM_PROMPT_LENGTH + 1);
    const { isValid, errors } = validateSetupForm(formValues({ questionsText: tooLong, freeform: true }));
    assert.strictEqual(isValid, false);
    assert.ok(/characters or less/.test(errors[BLOCK_IDS.QUESTIONS_INPUT]));
  });

  test('free-form mode ignores the 10-question cap', () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `- bullet ${i}`).join('\n');
    const { isValid } = validateSetupForm(formValues({ questionsText: manyLines, freeform: true }));
    assert.strictEqual(isValid, true);
  });

  test('legacy mode still enforces the 10-question cap', () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `Question ${i}?`).join('\n');
    const { isValid, errors } = validateSetupForm(formValues({ questionsText: manyLines, freeform: false }));
    assert.strictEqual(isValid, false);
    assert.ok(/Maximum/.test(errors[BLOCK_IDS.QUESTIONS_INPUT]));
  });
});
