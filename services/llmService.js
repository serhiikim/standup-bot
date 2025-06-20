const OpenAI = require('openai');

class LLMService {
  constructor() {
    console.log('🔍 Checking OpenAI API key...');
    console.log('API Key exists:', !!process.env.OPENAI_API_KEY);
    console.log('API Key length:', process.env.OPENAI_API_KEY?.length || 0);
    console.log('API Key starts with sk-:', process.env.OPENAI_API_KEY?.startsWith('sk-') || false);
    
    this.openai = process.env.OPENAI_API_KEY ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    }) : null;
    
    this.isEnabled = !!this.openai;
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
    if (!this.isEnabled) {
      console.warn('⚠️ OpenAI API key not configured - LLM features disabled');
    } else {
      console.log('✅ OpenAI API key configured successfully');
      console.log('🤖 Using model:', this.model);
    }
  }

  /**
   * Extract blockers from analysis text (fallback method)
   */
  extractBlockers(analysisText) {
    const blockerKeywords = ['blocker', 'blocked', 'issue', 'problem', 'challenge', 'stuck', 'difficulty'];
    const lines = analysisText.toLowerCase().split('\n');
    
    return lines.filter(line => 
      blockerKeywords.some(keyword => line.includes(keyword))
    ).slice(0, 3);
  }

  /**
   * Extract achievements from analysis text (fallback method)
   */
  extractAchievements(analysisText) {
    const achievementKeywords = ['completed', 'finished', 'achieved', 'delivered', 'success', 'done'];
    const lines = analysisText.toLowerCase().split('\n');
    
    return lines.filter(line => 
      achievementKeywords.some(keyword => line.includes(keyword))
    ).slice(0, 3);
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
            content: "You are an AI assistant that analyzes team standup responses and creates concise, helpful summaries. When you see user mentions like <@U123>, preserve them in your response."
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
      
      // Parse the structured response
      const parsedAnalysis = this.parseStructuredAnalysis(analysis);
      
      return {
        summary: parsedAnalysis.summary,
        blockers: parsedAnalysis.blockers,
        achievements: parsedAnalysis.achievements,
        nextSteps: parsedAnalysis.nextSteps,
        teamMood: parsedAnalysis.teamMood,
        rawAnalysis: analysis,
        generatedBy: 'openai',
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
Please analyze the following standup responses and provide a structured summary:

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

Keep each section concise and focus on actionable insights.
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
        
        if (trimmedLine && !trimmedLine.startsWith('**')) {
          if (currentSection === 'summary') {
            sections.summary += (sections.summary ? ' ' : '') + trimmedLine;
          } else if (currentSection === 'teamMood') {
            const moodMatch = trimmedLine.toLowerCase().match(/(positive|negative|neutral)/);
            if (moodMatch) {
              sections.teamMood = moodMatch[1];
            }
          } else if (currentSection && ['achievements', 'blockers', 'nextSteps'].includes(currentSection)) {
            // Clean bullet points
            const cleanLine = trimmedLine.replace(/^[-•*]\s*/, '').trim();
            if (cleanLine && cleanLine.length > 5) {
              sections[currentSection].push(cleanLine);
            }
          }
        }
      }
      
      return sections;
      
    } catch (error) {
      console.error('Error parsing structured analysis:', error);
      // Fallback to original format
      return {
        summary: analysisText.substring(0, 200) + '...',
        achievements: this.extractAchievements(analysisText),
        blockers: this.extractBlockers(analysisText),
        nextSteps: [],
        teamMood: this.assessTeamMood(analysisText)
      };
    }
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
   * Analyze individual response sentiment
   */
  async analyzeResponseSentiment(responseText) {
    if (!this.isEnabled) {
      return 'neutral';
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
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