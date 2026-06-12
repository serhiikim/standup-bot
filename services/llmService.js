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
        const answers = response.responses.join('\n');
        return `${userMention}:\n${answers}`;
      }).join('\n\n---\n\n');

      const prompt = this.createAnalysisPrompt(standup.questions, responsesText);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an AI assistant that analyzes team standup responses and creates concise, helpful summaries. When you see user mentions like <@U123>, preserve them in your response. You can understand and analyze responses in any language - just provide your analysis in English using the requested format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: 0.3
      });

      const analysis = completion.choices[0].message.content;
      
      // Parse the structured response
      const parsedAnalysis = this.parseStructuredAnalysis(analysis);
      
      return {
        summary: parsedAnalysis.summary,
        blockers: parsedAnalysis.blockers,
        achievements: parsedAnalysis.achievements,
        nextSteps: parsedAnalysis.nextSteps,
        teamMood: parsedAnalysis.teamMood,
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
Please analyze the following standup responses and provide a structured summary. The responses may be in any language - please analyze them accurately and provide your response in English.

STANDUP QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TEAM RESPONSES:
${responsesText}

Please provide your analysis in the following format:

**SUMMARY:**
[2-3 sentences summarizing the key points from all responses]

**ACHIEVEMENTS:**
[List 2-3 specific accomplishments mentioned by team members]

**BLOCKERS:**
[List any specific blockers, challenges, or issues mentioned]

**NEXT STEPS:**
[Key tasks or priorities mentioned for today/upcoming work]

**TEAM MOOD:**
[One word: positive, neutral, or negative, with brief explanation]

Keep each section concise and focus on actionable insights. If no items are found for a category, you can leave it empty or write "None mentioned".
`;
  }

  /**
   * Parse structured analysis response from LLM
   */
  parseStructuredAnalysis(analysisText) {
    const sections = {
      summary: '',
      achievements: [],
      blockers: [],
      nextSteps: [],
      teamMood: 'neutral'
    };

    try {
      const lines = analysisText.split('\n');
      let currentSection = '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Check for section headers
        if (trimmedLine.includes('**SUMMARY:**')) {
          currentSection = 'summary';
          continue;
        } else if (trimmedLine.includes('**ACHIEVEMENTS:**')) {
          currentSection = 'achievements';
          continue;
        } else if (trimmedLine.includes('**BLOCKERS:**')) {
          currentSection = 'blockers';
          continue;
        } else if (trimmedLine.includes('**NEXT STEPS:**')) {
          currentSection = 'nextSteps';
          continue;
        } else if (trimmedLine.includes('**TEAM MOOD:**')) {
          currentSection = 'teamMood';
          continue;
        }
        
        // Process content for each section
        if (trimmedLine && !trimmedLine.startsWith('**')) {
          if (currentSection === 'summary') {
            sections.summary += (sections.summary ? ' ' : '') + trimmedLine;
          } else if (currentSection === 'teamMood') {
            // Extract mood from the line
            const moodMatch = trimmedLine.toLowerCase().match(/\b(positive|negative|neutral)\b/);
            if (moodMatch) {
              sections.teamMood = moodMatch[1];
            }
          } else if (currentSection && ['achievements', 'blockers', 'nextSteps'].includes(currentSection)) {
            // Clean up bullet points and add to array
            const cleanLine = trimmedLine
              .replace(/^[-•*]\s*/, '') // Remove bullet points
              .replace(/^\d+\.\s*/, '') // Remove numbered lists
              .trim();
            
            if (cleanLine && cleanLine.length > 3 && !cleanLine.toLowerCase().includes('none mentioned')) {
              sections[currentSection].push(cleanLine);
            }
          }
        }
      }
      
      return sections;
      
    } catch (error) {
      console.error('Error parsing structured analysis:', error);
      
      // If parsing fails completely, try to extract what we can
      return {
        summary: analysisText.length > 200 ? analysisText.substring(0, 200) + '...' : analysisText,
        achievements: [],
        blockers: [],
        nextSteps: [],
        teamMood: 'neutral'
      };
    }
  }

  /**
   * Analyze team sentiment across all responses
   */
  async analyzeTeamSentiment(responses) {
    if (!this.isEnabled || responses.length === 0) {
      return 'neutral';
    }

    try {
      const allResponsesText = responses.map(r => r.responses.join(' ')).join('\n');
      
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "Analyze the overall sentiment of these standup responses. Consider the tone, language, and content. Respond with only: positive, negative, or neutral."
          },
          {
            role: "user",
            content: allResponsesText
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const sentiment = completion.choices[0].message.content.toLowerCase().trim();
      
      if (['positive', 'negative', 'neutral'].includes(sentiment)) {
        return sentiment;
      }
      
      return 'neutral';

    } catch (error) {
      console.error('Error analyzing team sentiment:', error);
      return 'neutral';
    }
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
      teamMood: 'neutral',
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