const OpenAI = require('openai');

class LLMService {
  static getInstance() {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  constructor() {
    if (LLMService.instance) {
      throw new Error('LLMService is a singleton. Use LLMService.getInstance() instead.');
    }

    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL;
    
    let defaultModel = 'gpt-4o-mini';
    if (baseURL && baseURL.includes('googleapis.com')) {
      defaultModel = 'gemini-2.5-flash';
    } else if (process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      defaultModel = 'gemini-2.5-flash';
    }
    
    this.model = process.env.AI_MODEL || process.env.OPENAI_MODEL || process.env.GEMINI_MODEL || defaultModel;

    let finalBaseURL = baseURL;
    if (!finalBaseURL && process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      finalBaseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    }

    this.openai = apiKey ? new OpenAI({
      apiKey: apiKey,
      baseURL: finalBaseURL || undefined,
      timeout: 30000,
      maxRetries: 2
    }) : null;
    
    this.isEnabled = !!this.openai;
    
    if (!this.isEnabled) {
      console.warn('⚠️ LLM features disabled (no API key configured)');
    } else {
      console.log(`🤖 LLM Service enabled (model: ${this.model}, endpoint: ${finalBaseURL || 'default-openai'})`);
    }

    LLMService.instance = this;
  }

  /**
   * Get the name of the LLM provider
   */
  getProviderName() {
    if (!this.isEnabled) return 'none';
    const baseURL = this.openai.baseURL || '';
    if (baseURL.includes('googleapis.com')) return 'gemini';
    return 'openai';
  }

  /**
   * Analyze standup responses and generate summary
   */
  async analyzeStandupResponses(standup, responses, slackService = null) {
    if (!this.isEnabled) {
      return this.createFallbackSummary(standup, responses, slackService);
    }

    try {
      // Prepare responses text for analysis with mentions
      const responsesText = responses.map(response => {
        const userMention = slackService ? 
          slackService.formatUserMention(response.userId) : 
          response.userDisplayName || response.username;
        return `${userMention}:\n${response.rawMessage}`;
      }).join('\n\n---\n\n');

      const prompt = this.createAnalysisPrompt(standup.questions, responsesText);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an AI assistant that analyzes team standup responses and creates a cohesive, well-formatted summary of their work. Preserve user mentions like <@U123> exactly as they are. Always output the final summary in English using Slack formatting (mrkdwn) such as bold text (*text*), bullet points, and clean spacing."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 4096,
        temperature: 0.3
      });

      const analysis = completion.choices[0].message.content.trim();
      
      return {
        summary: analysis,
        blockers: [],
        achievements: [],
        nextSteps: [],
        questionSummaries: [],
        rawAnalysis: analysis,
        generatedBy: this.getProviderName(),
        generatedAt: new Date()
      };

    } catch (error) {
      console.error('Error in LLM analysis:', error);
      return this.createFallbackSummary(standup, responses, slackService);
    }
  }

  /**
   * Create analysis prompt for LLM
   */
  createAnalysisPrompt(questions, responsesText) {
    return `
Please analyze the following team standup responses and generate a well-structured summary. 

The summary should follow the template/format of the standup questions naturally. Organize the summary by grouping the team's updates under appropriate headers or categories corresponding to the questions asked, and summarize the achievements, status, or blockers reported.

STANDUP QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TEAM RESPONSES:
${responsesText}

Instructions for output formatting:
1. Choose the formatting layout dynamically based on the standup's questions and responses.
2. Use Slack Markdown (mrkdwn) like *bold* headers, list items, and emojis for layout structure. Do NOT use standard Markdown headers like '#' or '##'.
3. Keep the summary concise, readable, and focused on key achievements, active work, and active blockers.
4. Preserve and use team member Slack mentions (like <@U123456>) in your summary when attributing work or blockers.
5. Return ONLY the final formatted summary text.
`;
  }

  /**
   * Parse structured analysis response from LLM (deprecated - returns raw summary)
   */
  parseStructuredAnalysis(analysisText) {
    return {
      summary: analysisText,
      achievements: [],
      blockers: [],
      nextSteps: [],
      questionSummaries: []
    };
  }

  /**
   * Create fallback summary when LLM is not available
   */
  createFallbackSummary(standup, responses, slackService = null) {
    const responseCount = responses.length;
    const expectedCount = standup.stats.totalExpected;
    const responseRate = Math.round((responseCount / expectedCount) * 100);
    
    const participantNames = responses
      .map(r => slackService ? 
        slackService.formatUserMention(r.userId) : 
        r.userDisplayName || r.username
      )
      .join(', ');

    const summary = `📊 Standup Summary (${responseCount}/${expectedCount} responses, ${responseRate}%)\n\n` +
                   `👥 Participants: ${participantNames}\n\n` +
                   `🤖 AI analysis is currently unavailable. Manual review recommended for detailed insights.`;

    return {
      summary,
      blockers: [],
      achievements: [],
      nextSteps: [],
      generatedBy: 'fallback',
      generatedAt: new Date()
    };
  }

  /**
   * Check if LLM service is available
   */
  isAvailable() {
    return this.isEnabled;
  }

  /**
   * Test LLM connection
   */
  async testConnection() {
    if (!this.isEnabled) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 5
      });

      return { success: true, model: this.model };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = LLMService;