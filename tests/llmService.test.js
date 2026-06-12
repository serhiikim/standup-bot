const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

// Set dummy key to enable LLMService in tests
process.env.OPENAI_API_KEY = 'sk-test-key';
const LLMService = require('../services/llmService');

describe('LLMService Provider Agnostic Verification', () => {
  test('should initialize using OpenAI by default with sk-test-key', () => {
    const service = LLMService.getInstance();
    assert.strictEqual(service.isEnabled, true, 'LLMService should be enabled');
    assert.strictEqual(service.getProviderName(), 'openai', 'default provider should be openai');
    assert.strictEqual(service.model, 'gpt-4o-mini', 'default model should be gpt-4o-mini');
  });

  test('should detect Gemini when GEMINI_API_KEY is configured and no OpenAI key', () => {
    // Clear instance to re-trigger constructor
    LLMService.instance = null;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    delete process.env.AI_BASE_URL;

    const service = LLMService.getInstance();
    assert.strictEqual(service.isEnabled, true);
    assert.strictEqual(service.getProviderName(), 'gemini', 'provider should be gemini');
    assert.strictEqual(service.model, 'gemini-2.5-flash', 'Gemini model should default to gemini-2.5-flash');
    assert.strictEqual(service.openai.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai/', 'should use Gemini base URL');

    // Clean up
    LLMService.instance = null;
    delete process.env.GEMINI_API_KEY;
  });

  test('should support generic AI config override', () => {
    LLMService.instance = null;
    process.env.AI_API_KEY = 'custom-key';
    process.env.AI_BASE_URL = 'https://api.deepseek.com/v1/';
    process.env.AI_MODEL = 'deepseek-chat';

    const service = LLMService.getInstance();
    assert.strictEqual(service.isEnabled, true);
    assert.strictEqual(service.getProviderName(), 'openai', 'should identify as generic openai client provider name');
    assert.strictEqual(service.model, 'deepseek-chat');
    assert.strictEqual(service.openai.baseURL, 'https://api.deepseek.com/v1/');

    // Clean up
    LLMService.instance = null;
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
  });

  test('should generate prompt correctly', () => {
    const service = LLMService.getInstance();
    const prompt = service.createAnalysisPrompt(
      ['What did you do?', 'Any blockers?'],
      'User1:\nDone Y\nNo blockers'
    );
    assert.ok(prompt.includes('STANDUP QUESTIONS:'), 'prompt should contain headers');
    assert.ok(prompt.includes('1. What did you do?'), 'prompt should contain question 1');
    assert.ok(prompt.includes('User1:'), 'prompt should contain team responses');
  });

  test('should parse structured analysis text accurately', () => {
    const service = LLMService.getInstance();
    const rawAnalysis = `
**SUMMARY:**
The team worked on tasks and fixed database connections. Overall progress is steady.

**ACHIEVEMENTS:**
- Completed SQLite database migration
- Connected OpenAI compatible endpoints

**BLOCKERS:**
- Waiting on Slack webhook URL

**NEXT STEPS:**
- Create and run automated tests

**TEAM MOOD:**
Positive (good progress on databases)
    `;

    const parsed = service.parseStructuredAnalysis(rawAnalysis);
    
    assert.strictEqual(parsed.summary, 'The team worked on tasks and fixed database connections. Overall progress is steady.');
    assert.deepStrictEqual(parsed.achievements, [
      'Completed SQLite database migration',
      'Connected OpenAI compatible endpoints'
    ]);
    assert.deepStrictEqual(parsed.blockers, [
      'Waiting on Slack webhook URL'
    ]);
    assert.deepStrictEqual(parsed.nextSteps, [
      'Create and run automated tests'
    ]);
    assert.strictEqual(parsed.teamMood, 'positive');
  });

  test('should call mock completion method correctly', async () => {
    // Reset instance and configure mock key
    LLMService.instance = null;
    process.env.OPENAI_API_KEY = 'sk-test-key';
    const service = LLMService.getInstance();

    // Stub completions.create
    service.openai.chat.completions.create = async (options) => {
      assert.strictEqual(options.model, 'gpt-4o-mini');
      assert.strictEqual(options.messages[0].role, 'system');
      return {
        choices: [
          {
            message: {
              content: `**SUMMARY:**\nMock summary\n\n**ACHIEVEMENTS:**\n- Mock task\n\n**BLOCKERS:**\nNone\n\n**NEXT STEPS:**\n- Test code\n\n**TEAM MOOD:**\nNeutral`
            }
          }
        ]
      };
    };

    const mockStandup = { questions: ['Q1'] };
    const mockResponses = [
      { userId: 'U1', userDisplayName: 'Alice', responses: ['A1'] }
    ];

    const result = await service.analyzeStandupResponses(mockStandup, mockResponses, null);
    assert.strictEqual(result.summary, 'Mock summary');
    assert.deepStrictEqual(result.achievements, ['Mock task']);
    assert.strictEqual(result.teamMood, 'neutral');
    assert.strictEqual(result.generatedBy, 'openai');
  });
});
