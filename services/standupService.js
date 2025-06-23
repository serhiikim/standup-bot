const SlackService = require('./slackService');
const LLMService = require('./llmService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const { 
  STANDUP_STATUS, 
  MESSAGES, 
  BLOCK_IDS,
  DEFAULT_RESPONSE_TIMEOUT 
} = require('../utils/constants');

class StandupService {
  constructor(app) {
    this.app = app;
    this.slackService = new SlackService(app);
    this.llmService = LLMService.getInstance();
  }

  /**
   * Start a new standup (manual or scheduled)
   */
  async startStandup(teamId, channelId, createdBy = 'system', isManual = false) {
    try {
      console.log(`Starting standup for channel ${channelId}`);

      // Get channel configuration
      const channel = await Channel.findByChannelId(teamId, channelId);
      if (!channel || !channel.isActive) {
        throw new Error('Channel not configured or inactive');
      }

      // Check for existing active standups
      const activeStandups = await Standup.findActiveByChannel(teamId, channelId);
      if (activeStandups.length > 0) {
        throw new Error('Standup already active in this channel');
      }

      // Get channel participants
      const participants = await this.getStandupParticipants(channelId, channel);
      if (participants.length === 0) {
        throw new Error('No participants found for standup');
      }

      // Calculate response deadline
      const responseDeadline = new Date(Date.now() + (channel.config.responseTimeout || DEFAULT_RESPONSE_TIMEOUT));

      // Create standup record
      const standupData = {
        teamId,
        channelId,
        questions: [...channel.config.questions],
        expectedParticipants: participants.map(p => p.id),
        scheduledDate: new Date(),
        responseDeadline,
        createdBy,
        isManual,
        status: STANDUP_STATUS.ACTIVE
      };

      const standup = await Standup.create(standupData);
      
      // Convert to Standup instance to use instance methods
      const standupInstance = new Standup(standup);

      // Post standup message to channel
      const standupMessage = this.createStandupMessage(standupInstance, participants, channel);
      try {
      const messageResult = await this.slackService.postMessage(
        channelId,
        standupMessage.text,
        standupMessage.blocks
      );

      // Update standup with message timestamps
      standupInstance.messageTs = messageResult.ts;
      standupInstance.threadTs = messageResult.ts; // Thread starts from this message
      await standupInstance.save();

      // Update channel statistics
      channel.incrementStandupCount();
      await channel.save();
    } catch (postError) {
      if (this.isBotRemovedError(postError)) {
        console.log(`🤖 Bot removed from channel ${channelId}, auto-disabling standups`);
        
        await this.autoDisableChannel(teamId, channelId, 'bot_removed');
        
        // Delete the standup we just created since we can't use it
        await standupInstance.delete();
        
        throw new Error('Bot removed from channel - standups auto-disabled');
      }
      
      // Re-throw other errors
      throw postError;
    }

      // Schedule reminder if enabled
      if (channel.config.enableReminders) {
        const reminderTime = new Date(Date.now() + channel.config.reminderInterval);
        standupInstance.setNextReminder(reminderTime);
        await standupInstance.save();
      }

      console.log(`✅ Standup started successfully: ${standupInstance._id}`);
      return standupInstance;

    } catch (error) {
      console.error('Error starting standup:', error);
      throw error;
    }
  }


  /**
 * Check if error indicates bot was removed from channel
 */
isBotRemovedError(error) {
  return error.data?.error === 'channel_not_found' || 
         error.data?.error === 'not_in_channel' ||
         error.data?.error === 'channel_is_archived';
}

/**
 * Automatically disable standups when bot is removed
 */
async autoDisableChannel(teamId, channelId, reason = 'bot_removed') {
  try {
    const updateData = {
      status: 'disabled',
      isActive: false,
      disabledAt: new Date(),
      disabledReason: reason,
      autoDisabled: true
    };
    
    const success = await Channel.updateByChannelId(teamId, channelId, updateData);
    
    if (success) {
      console.log(`✅ Auto-disabled standups for channel ${channelId} (reason: ${reason})`);
    } else {
      console.warn(`⚠️ Failed to auto-disable channel ${channelId}`);
    }
    
    return success;
    
  } catch (error) {
    console.error(`❌ Error auto-disabling channel ${channelId}:`, error);
    return false;
  }
}

  /**
   * Get participants for standup
   */
  async getStandupParticipants(channelId, channelConfig) {
    try {
      let participantIds;

      if (channelConfig.hasSpecificParticipants()) {
        // Use configured participants
        participantIds = channelConfig.getParticipants();
      } else {
        // Get all channel members
        const members = await this.slackService.getChannelMembers(channelId);
        participantIds = members.filter(member => !member.startsWith('B')); // Filter out bots
      }

      // Get user info for all participants
      const participants = await this.slackService.getUsersInfo(participantIds);
      
      // Filter out deleted/deactivated users and bots
      return participants.filter(user => 
        user && 
        !user.deleted && 
        !user.is_bot && 
        user.id !== 'USLACKBOT'
      );

    } catch (error) {
      console.error('Error getting standup participants:', error);
      throw error;
    }
  }

  /**
   * Create standup message with questions
   */
  createStandupMessage(standup, participants, channel) {
    const participantMentions = participants.map(p => this.slackService.formatUserMention(p.id)).join(' ');
    
    const text = `🚀 **Daily Standup Started!**\n\nPlease respond to the questions below in this thread within ${Math.floor(channel.config.responseTimeout / (1000 * 60 * 60))} hours.`;

    const blocks = [
      // Header
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚀 *Daily Standup Started!*\n\n${participantMentions}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Started ${standup.isManual ? 'manually' : 'automatically'} • Deadline: <!date^${Math.floor(standup.responseDeadline.getTime() / 1000)}^{time}|${standup.responseDeadline.toLocaleTimeString()}>`
          }
        ]
      },
      {
        type: 'divider'
      },

      // Questions
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Please answer these questions in a reply to this thread:*'
        }
      }
    ];

    // Add each question as a separate block
    standup.questions.forEach((question, index) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}.* ${question}`
        }
      });
    });

    // Instructions
    blocks.push(
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 *Tip:* Reply to this message with your answers. You can edit your response anytime before the deadline.'
          }
        ]
      }
    );

    // Action buttons (optional)
    if (standup.isManual) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Complete Standup'
            },
            action_id: BLOCK_IDS.SUBMIT_RESPONSE,
            value: standup._id.toString(),
            style: 'primary'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏹️ Cancel Standup'
            },
            action_id: BLOCK_IDS.CANCEL_BUTTON,
            value: standup._id.toString(),
            style: 'danger'
          }
        ]
      });
    }

    return { text, blocks };
  }

  /**
   * Send reminder to users who haven't responded
   */
  async sendReminders(standupId) {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || !standup.isActive()) {
        return false;
      }

      if (standup.hasAllResponses()) {
        console.log(`✅ All responses already received for standup ${standupId}, clearing reminders`);
        
        // Clear future reminders
        standup.setNextReminder(null);
        await standup.save();
        
        return false; // No reminders needed
      }

      // Get users who haven't responded yet
      const missingParticipants = standup.getMissingParticipants();
      if (missingParticipants.length === 0) {
        console.log(`✅ No missing participants for standup ${standupId}`);
        
        standup.setNextReminder(null);
        await standup.save();
        
        return false;
      }

      // Get user info for mentions
      const missingUsers = await this.slackService.getUsersInfo(missingParticipants);
      const mentions = missingUsers.map(user => this.slackService.formatUserMention(user.id)).join(' ');

      // Create reminder message
      const timeLeft = standup.responseDeadline - new Date();
      const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
      const minutesLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));

      let reminderText = `⏰ *Standup Reminder*\n\n${mentions}\n\n`;
      
      if (hoursLeft > 0) {
        reminderText += `You have *${hoursLeft} hour(s) and ${minutesLeft} minute(s)* left to respond to today's standup.`;
      } else if (minutesLeft > 0) {
        reminderText += `You have *${minutesLeft} minute(s)* left to respond to today's standup.`;
      } else {
        reminderText += `⚠️ Standup deadline has passed, but you can still respond!`;
      }

      // Post reminder in the thread
      await this.slackService.postMessage(
        standup.channelId,
        reminderText,
        null,
        standup.threadTs
      );

      // Update reminder tracking
      standup.addReminder('general');
      
      // Schedule next reminder if still time left and reminders enabled
      const channel = await Channel.findByChannelId(standup.teamId, standup.channelId);
      if (channel.config.enableReminders && timeLeft > 0) {
        const nextReminderTime = new Date(Date.now() + channel.config.reminderInterval);
        if (nextReminderTime < standup.responseDeadline) {
          standup.setNextReminder(nextReminderTime);
        } else {
          standup.setNextReminder(null); // No more reminders needed
        }
      }

      await standup.save();

      console.log(`📢 Sent reminder for standup ${standupId} to ${missingParticipants.length} users`);
      return true;

    } catch (error) {
      console.error('Error sending reminders:', error);
      return false;
    }
  }

  /**
   * Complete standup and prepare for analysis
   */
  async completeStandup(standupId, reason = 'automatic') {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || standup.isCompleted()) {
        return false;
      }

      // Update standup status
      standup.updateStatus(STANDUP_STATUS.ANALYZING);
      await standup.save();

      // Get all responses
      const responses = await Response.findByStandupId(standupId);
      
      // Generate AI summary if we have responses
      let aiAnalysis = null;
      if (responses.length > 0) {
        try {
          aiAnalysis = await this.llmService.analyzeStandupResponses(standup, responses, this.slackService);
          standup.summary = aiAnalysis.summary;
          console.log('🤖 AI analysis completed');
        } catch (error) {
          console.error('Error generating AI summary:', error);
          // Continue without AI analysis
        }
      }
      
      // Calculate final statistics
      const responseStats = await Response.getStandupStatistics(standupId);
      standup.updateStats({
        totalResponded: responseStats.total,
        responseRate: (responseStats.total / standup.stats.totalExpected) * 100,
        avgResponseTime: responseStats.avgResponseTime
      });

      // Create completion message
      const completionMessage = this.createCompletionMessage(standup, responses, responseStats, aiAnalysis);
      
      // Post completion message in thread
      await this.slackService.postMessage(
        standup.channelId,
        completionMessage.text,
        completionMessage.blocks,
        standup.threadTs
      );

      // Mark as completed
      standup.updateStatus(STANDUP_STATUS.COMPLETED);
      await standup.save();

      // Update channel statistics
      const channel = await Channel.findByChannelId(standup.teamId, standup.channelId);
      channel.updateStats({
        avgResponseRate: ((channel.stats.avgResponseRate * (channel.stats.totalStandups - 1)) + standup.getResponseRate()) / channel.stats.totalStandups
      });
      await channel.save();

      console.log(`✅ Standup completed: ${standupId} (${reason})`);
      return true;

    } catch (error) {
      console.error('Error completing standup:', error);
      return false;
    }
  }

  /**
   * Create completion/summary message
   */
  createCompletionMessage(standup, responses, stats, aiAnalysis = null) {
    const responseRate = standup.getResponseRate();
    const duration = Math.floor(standup.getDuration() / (1000 * 60)); // minutes

    let text = `✅ *Standup Completed!*\n\n`;
    text += `📊 *Results:* ${stats.total}/${standup.stats.totalExpected} responses (${responseRate}%)\n`;
    text += `⏱️ *Duration:* ${duration} minutes\n`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Standup Completed!*`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Responses:*\n${stats.total}/${standup.stats.totalExpected} (${responseRate}%)`
          },
          {
            type: 'mrkdwn',
            text: `*Duration:*\n${duration} minutes`
          }
        ]
      }
    ];

    // Add response summary if we have responses
    if (responses.length > 0) {
      const responseList = responses
        .slice(0, 10) // Limit to prevent message overflow
        .map(r => `• ${r.userDisplayName || r.username} ${r.isComplete ? '✅' : '⚠️'}`)
        .join('\n');

      blocks.push(
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Participants:*\n${responseList}${responses.length > 10 ? `\n... and ${responses.length - 10} more` : ''}`
          }
        }
      );
    }

    // Add missing participants if any
    const missing = standup.getMissingParticipants();
    if (missing.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⚠️ Missing responses from ${missing.length} participant(s)`
          }
        ]
      });
    }

    // Add AI analysis if available
    if (aiAnalysis) {
      blocks.push({
        type: 'divider'
      });

      // Main summary
      if (aiAnalysis.summary) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🤖 *AI Summary:*\n${aiAnalysis.summary}`
          }
        });
      }

      // Create a fields block for structured info
      const fields = [];

      // Achievements
      if (aiAnalysis.achievements && aiAnalysis.achievements.length > 0) {
        const achievementsText = aiAnalysis.achievements
          .slice(0, 3)
          .map(a => `• ${a}`)
          .join('\n');
        fields.push({
          type: 'mrkdwn',
          text: `*🎉 Achievements:*\n${achievementsText}`
        });
      }

      // Blockers
      if (aiAnalysis.blockers && aiAnalysis.blockers.length > 0) {
        const blockersText = aiAnalysis.blockers
          .slice(0, 3)
          .map(b => `• ${b}`)
          .join('\n');
        fields.push({
          type: 'mrkdwn',
          text: `*🚫 Blockers:*\n${blockersText}`
        });
      }

      // Next Steps
      if (aiAnalysis.nextSteps && aiAnalysis.nextSteps.length > 0) {
        const nextStepsText = aiAnalysis.nextSteps
          .slice(0, 3)
          .map(n => `• ${n}`)
          .join('\n');
        fields.push({
          type: 'mrkdwn',
          text: `*📋 Next Steps:*\n${nextStepsText}`
        });
      }

      // Add fields block if we have any fields
      if (fields.length > 0) {
        // Split fields into pairs for better layout
        for (let i = 0; i < fields.length; i += 2) {
          blocks.push({
            type: 'section',
            fields: fields.slice(i, i + 2)
          });
        }
      }

      // Team mood
      if (aiAnalysis.teamMood) {
        const moodEmoji = {
          'positive': '😊',
          'neutral': '😐', 
          'negative': '😟'
        };
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Team mood: ${moodEmoji[aiAnalysis.teamMood] || '😐'} *${aiAnalysis.teamMood.charAt(0).toUpperCase() + aiAnalysis.teamMood.slice(1)}*`
            }
          ]
        });
      }
    } else if (responses.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🤖 AI analysis unavailable'
          }
        ]
      });
    }

    return { text, blocks };
  }

  /**
   * Cancel an active standup
   */
  async cancelStandup(standupId, cancelledBy, reason = 'Manual cancellation') {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || !standup.isActive()) {
        return false;
      }

      // Update status
      standup.updateStatus(STANDUP_STATUS.CANCELLED);
      standup.cancelledBy = cancelledBy;
      standup.cancelReason = reason;
      await standup.save();

      // Post cancellation message
      await this.slackService.postMessage(
        standup.channelId,
        `❌ *Standup Cancelled*\n\nThis standup has been cancelled by ${this.slackService.formatUserMention(cancelledBy)}.\nReason: ${reason}`,
        null,
        standup.threadTs
      );

      console.log(`❌ Standup cancelled: ${standupId} by ${cancelledBy}`);
      return true;

    } catch (error) {
      console.error('Error cancelling standup:', error);
      return false;
    }
  }

  /**
   * Process expired standups
   */
  async processExpiredStandups() {
    try {
      const expiredStandups = await Standup.findExpired();
      
      for (const standup of expiredStandups) {
        console.log(`Processing expired standup: ${standup._id}`);
        await this.completeStandup(standup._id, 'expired');
      }

      return expiredStandups.length;

    } catch (error) {
      console.error('Error processing expired standups:', error);
      return 0;
    }
  }

  /**
   * Process pending reminders
   */
  async processPendingReminders() {
    try {
      const standups = await Standup.findNeedingReminders();
      
      for (const standup of standups) {
        console.log(`Sending reminder for standup: ${standup._id}`);
        await this.sendReminders(standup._id);
      }

      return standups.length;

    } catch (error) {
      console.error('Error processing reminders:', error);
      return 0;
    }
  }

  /**
   * Get standup status for a channel
   */
  async getChannelStatus(teamId, channelId) {
    try {
      const channel = await Channel.findByChannelId(teamId, channelId);
      if (!channel) {
        return null;
      }

      const activeStandups = await Standup.findActiveByChannel(teamId, channelId);
      const recentStandups = await Standup.findByChannel(teamId, channelId, 5);

      return {
        channel,
        activeStandups,
        recentStandups,
        hasActiveStandup: activeStandups.length > 0
      };

    } catch (error) {
      console.error('Error getting channel status:', error);
      return null;
    }
  }
}

module.exports = StandupService;