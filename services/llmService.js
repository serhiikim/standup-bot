const OpenAI = require('openai');

class LLMService {
  constructor() {
    this.openai = process.env.OPENAI_API_KEY ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    }) : null;
    
    this.isEnabled = !!this.openai;
    
    if (!this.isEnabled) {
      console.warn('⚠️ OpenAI API key not configured - LLM features disabled');
    }
  }

  /**
   * Analyze standup responses and generate summary
   */
  async analyzeStandupResponses(standup, responses) {
    if (!this.isEnabled) {
      return this.createFallbackSummary(standup, responses);
    }

    try {
      // Prepare responses text for analysis
      const responsesText = responses.map(response => {
        const answers = response.responses.join('\n');
        return `${response.userDisplayName || response.username}:\n${answers}`;
      }).join('\n\n---\n\n');

      const prompt = this.createAnalysisPrompt(standup.questions, responsesText);

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an AI assistant that analyzes team standup responses and creates concise, helpful summaries."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const analysis = completion.choices[0].message.content;
      
      return {
        summary: analysis,
        blockers: this.extractBlockers(analysis),
        achievements: this.extractAchievements(analysis),
        teamMood: this.assessTeamMood(analysis),
        generatedBy: 'openai',
        generatedAt: new Date()
      };

    } catch (error) {
      console.error('Error in LLM analysis:', error);
      return this.createFallbackSummary(standup, responses);
    }
  }

  /**
   * Create analysis prompt for LLM
   */
  createAnalysisPrompt(questions, responsesText) {
    return `
Please analyze the following standup responses and provide a concise summary:

STANDUP QUESTIONS:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TEAM RESPONSES:
${responsesText}

Please provide:
1. A brief overall summary (2-3 sentences)
2. Key achievements/progress mentioned
3. Any blockers or challenges identified
4. Overall team mood/sentiment
5. Any action items or follow-ups needed

Keep the summary professional, positive, and actionable.
`;
  }

  /**
   * Extract blockers from analysis text
   */
  extractBlockers(analysisText) {
    // Simple keyword-based extraction
    const blockerKeywords = ['blocker', 'blocked', 'issue', 'problem', 'challenge', 'stuck', 'difficulty'];
    const lines = analysisText.toLowerCase().split('\n');
    
    return lines.filter(line => 
      blockerKeywords.some(keyword => line.includes(keyword))
    ).slice(0, 5); // Limit to 5 blockers
  }

  /**
   * Extract achievements from analysis text
   */
  extractAchievements(analysisText) {
    // Simple keyword-based extraction
    const achievementKeywords = ['completed', 'finished', 'achieved', 'delivered', 'success', 'done'];
    const lines = analysisText.toLowerCase().split('\n');
    
    return lines.filter(line => 
      achievementKeywords.some(keyword => line.includes(keyword))
    ).slice(0, 5); // Limit to 5 achievements
  }

  /**
   * Assess team mood from analysis
   */
  assessTeamMood(analysisText) {
    const positiveWords = ['good', 'great', 'excellent', 'positive', 'happy', 'productive'];
    const negativeWords = ['difficult', 'challenging', 'frustrated', 'blocked', 'issues'];
    
    const text = analysisText.toLowerCase();
    const positiveCount = positiveWords.filter(word => text.includes(word)).length;
    const negativeCount = negativeWords.filter(word => text.includes(word)).length;
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Create fallback summary when LLM is not available
   */
  createFallbackSummary(standup, responses) {
    const responseCount = responses.length;
    const expectedCount = standup.stats.totalExpected;
    const responseRate = Math.round((responseCount / expectedCount) * 100);
    
    const participantNames = responses
      .map(r => r.userDisplayName || r.username)
      .join(', ');

    const summary = `📊 Standup Summary (${responseCount}/${expectedCount} responses, ${responseRate}%)\n\n` +
                   `👥 Participants: ${participantNames}\n\n` +
                   `🤖 AI analysis is currently unavailable. Manual review recommended for detailed insights.`;

    return {
      summary,
      blockers: [],
      achievements: [],
      teamMood: 'neutral',
      generatedBy: 'fallback',
      generatedAt: new Date()
    };
  }

  /**
   * Analyze individual response sentiment
   */
  async analyzeResponseSentiment(responseText) {
    if (!this.isEnabled) {
      return 'neutral';
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Analyze the sentiment of this standup response. Respond with only: positive, negative, or neutral."
          },
          {
            role: "user",
            content: responseText
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
      console.error('Error analyzing sentiment:', error);
      return 'neutral';
    }
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
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 5
      });

      return { success: true, model: "gpt-3.5-turbo" };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = LLMService;