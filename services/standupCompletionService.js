const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const LLMService = require('./llmService');
const { STANDUP_STATUS } = require('../utils/constants');

class StandupCompletionService {
  constructor(app, slackService, messageBuilder) {
    this.app = app;
    this.slackService = slackService;
    this.messageBuilder = messageBuilder;
    this.llmService = LLMService.getInstance();
  }

  async checkStandupCompletion(standupId, triggeredBy = 'response') {
    try {
      console.log(`🔍 Checking standup completion: ${standupId} (triggered by: ${triggeredBy})`);
      const standup = await Standup.findById(standupId);
      if (!standup) {
        return { success: false, error: 'Standup not found' };
      }
      if (!standup.isActive()) {
        return {
          success: true,
          action: 'none',
          reason: `Standup already ${standup.status}`
        };
      }
      const hasAllResponses = standup.hasAllResponses();
      const isExpired = standup.isExpired();
      console.log(`📊 Standup ${standupId} status:`, {
        hasAllResponses,
        isExpired,
        responses: `${standup.stats.totalResponded}/${standup.stats.totalExpected}`,
        deadline: standup.responseDeadline.toISOString()
      });
      if (hasAllResponses) {
        console.log(`✅ All responses received for standup ${standupId}, auto-completing...`);
        standup.clearReminders();
        await standup.save();
        const completed = await this.completeStandup(standupId, 'auto_all_responses');
        return {
          success: true,
          action: 'completed',
          reason: 'All responses received - auto-completed',
          autoCompleted: completed
        };
      } else if (isExpired) {
        console.log(`⏰ Standup ${standupId} has expired, completing...`);
        const completed = await this.completeStandup(standupId, 'expired');
        return {
          success: true,
          action: 'completed',
          reason: 'Standup expired',
          autoCompleted: completed
        };
      } else {
        const timeUntilDeadline = standup.responseDeadline - new Date();
        const hoursLeft = timeUntilDeadline / (1000 * 60 * 60);
        if (hoursLeft <= 0) {
          console.log(`⏰ Standup ${standupId} deadline passed, marking as expired`);
          const completed = await this.completeStandup(standupId, 'expired');
          return {
            success: true,
            action: 'completed',
            reason: 'Deadline passed',
            autoCompleted: completed
          };
        }
        const channel = await Channel.findByChannelId(standup.teamId, standup.channelId);
        if (channel?.config?.enableReminders && !standup.reminders.nextReminderAt) {
          const nextReminderTime = new Date(Date.now() + channel.config.reminderInterval);
          if (nextReminderTime < standup.responseDeadline) {
            standup.setNextReminder(nextReminderTime);
            await standup.save();
            console.log(`📅 Scheduled next reminder for standup ${standupId} at ${nextReminderTime.toISOString()}`);
            return {
              success: true,
              action: 'reminder_scheduled',
              reason: 'Waiting for more responses',
              nextReminderAt: nextReminderTime
            };
          }
        }
        return {
          success: true,
          action: 'waiting',
          reason: 'Waiting for more responses',
          missingCount: standup.getMissingParticipants().length,
          timeLeft: Math.round(hoursLeft * 100) / 100
        };
      }
    } catch (error) {
      console.error(`❌ Error checking standup completion for ${standupId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async completeStandup(standupId, reason = 'automatic') {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || standup.isCompleted()) {
        return false;
      }
      standup.updateStatus(STANDUP_STATUS.ANALYZING);
      await standup.save();
      const responses = await Response.findByStandupId(standupId);
      let aiAnalysis = null;
      if (responses.length > 0) {
        try {
          aiAnalysis = await this.llmService.analyzeStandupResponses(standup, responses, this.slackService);
          standup.summary = aiAnalysis.summary;
          console.log('🤖 AI analysis completed');
        } catch (error) {
          console.error('Error generating AI summary:', error);
        }
      }
      const responseStats = await Response.getStandupStatistics(standupId);
      standup.updateStats({
        totalResponded: responseStats.total,
        responseRate: (responseStats.total / standup.stats.totalExpected) * 100,
        avgResponseTime: responseStats.avgResponseTime
      });
      
      const completionMessage = this.messageBuilder.createCompletionMessage(standup, responses, responseStats, aiAnalysis);
      await this.slackService.postMessage(
        standup.channelId,
        completionMessage.text,
        completionMessage.blocks,
        standup.threadTs
      );
      
      standup.updateStatus(STANDUP_STATUS.COMPLETED);
      await standup.save();
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
}

module.exports = StandupCompletionService; 