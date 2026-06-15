
const SlackService = require('./slackService');
const LLMService = require('./llmService');
const UserStatusService = require('./userStatusService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const { STANDUP_STATUS, DEFAULT_RESPONSE_TIMEOUT } = require('../utils/constants');

class StandupLifecycleService {
  constructor(app, slackService, messageBuilder) {
    this.app = app;
    this.slackService = slackService || new SlackService(app);
    this.messageBuilder = messageBuilder;
    this.llmService = LLMService.getInstance();
    this.userStatusService = new UserStatusService(app);
  }

  async createStandup(teamId, channelId, createdBy = 'system', isManual = false) {
    try {
      console.log(`Starting standup for channel ${channelId}`);
      const channel = await Channel.findByChannelId(teamId, channelId);
      if (!channel || !channel.isActive) {
        throw new Error('Channel not configured or inactive');
      }
      
      const activeStandups = await Standup.findActiveByChannel(teamId, channelId);
      if (activeStandups.length > 0) {
        throw new Error('Standup already active in this channel');
      }
      
      const allParticipants = await this.getStandupParticipants(channelId, channel);
      if (allParticipants.length === 0) {
        throw new Error('No participants found for standup');
      }

      const participantIds = allParticipants.map(p => p.id);
      const statusFilter = await this.userStatusService.filterAvailableParticipants(participantIds);
      
      console.log(`👥 Participant status: ${statusFilter.availableCount}/${statusFilter.originalCount} available, ${statusFilter.oooCount} OOO`);

      if (statusFilter.shouldSkipStandup) {
        console.log(`🏝️ Entire team is OOO (${statusFilter.oooCount}/${statusFilter.originalCount}), skipping standup`);
        
        await this.postOOONotification(channelId, statusFilter, channel);
        
        throw new Error('Standup skipped - entire team is out of office');
      }

      const availableParticipants = allParticipants.filter(p => 
        statusFilter.participants.includes(p.id)
      );

      if (availableParticipants.length === 0) {
        console.log(`👻 No available participants after OOO filtering`);
        await this.postOOONotification(channelId, statusFilter, channel);
        throw new Error('No available participants for standup');
      }

      const responseDeadline = this.calculateDeadlineDate(channel);
      console.log(`📅 Calculated deadline: ${responseDeadline.toISOString()} (deadlineTime: ${channel.config.deadlineTime || 'N/A'}, timezone: ${channel.config.timezone || 'UTC'})`);
      
      const standupData = {
        teamId,
        channelId,
        questions: [...channel.config.questions],
        expectedParticipants: statusFilter.participants,
        scheduledDate: new Date(),
        responseDeadline,
        createdBy,
        isManual,
        status: STANDUP_STATUS.ACTIVE,
        oooInfo: {
          totalOriginal: statusFilter.originalCount,
          oooCount: statusFilter.oooCount,
          oooUsers: statusFilter.oooUsers.map(u => ({
            userId: u.userId,
            reason: u.reason,
            displayName: u.user?.displayName
          }))
        }
      };
      
      const standup = await Standup.create(standupData);
      const standupInstance = new Standup(standup);
      
      const standupMessage = this.messageBuilder.createStandupMessage(
        standupInstance, 
        availableParticipants, 
        channel,
        statusFilter
      );
      
      try {
        const messageResult = await this.slackService.postMessage(
          channelId,
          standupMessage.text,
          standupMessage.blocks
        );
        
        standupInstance.messageTs = messageResult.ts;
        standupInstance.threadTs = messageResult.ts;
        await standupInstance.save();
        
        channel.incrementStandupCount();
        await channel.save();
        
      } catch (postError) {
        if (this.isBotRemovedError(postError)) {
          console.log(`🤖 Bot removed from channel ${channelId}, auto-disabling standups`);
          await this.autoDisableChannel(teamId, channelId, 'bot_removed');
          await standupInstance.delete();
          throw new Error('Bot removed from channel - standups auto-disabled');
        }
        throw postError;
      }
      
      if (channel.config.enableReminders) {
        // First reminder starts 3 hours before the response deadline
        const threeHoursBeforeDeadline = new Date(responseDeadline.getTime() - 3 * 60 * 60 * 1000);
        // If 3 hours before deadline is in the past, schedule it immediately
        const reminderTime = threeHoursBeforeDeadline > new Date() ? threeHoursBeforeDeadline : new Date();
        standupInstance.setNextReminder(reminderTime);
        await standupInstance.save();
      }
      
      console.log(`✅ Standup started successfully: ${standupInstance._id} (${availableParticipants.length} participants, ${statusFilter.oooCount} OOO)`);
      return standupInstance;
      
    } catch (error) {
      console.error('Error starting standup:', error);
      throw error;
    }
  }

  async postOOONotification(channelId, statusFilter, channel) {
    try {
      const message = this.messageBuilder.createOOONotificationMessage(statusFilter, channel);
      
      await this.slackService.postMessage(
        channelId,
        message.text,
        message.blocks
      );
      
      console.log(`📴 Posted OOO notification for channel ${channelId}`);
      
    } catch (error) {
      console.error('Error posting OOO notification:', error);
    }
  }

  async cancelStandup(standupId, cancelledBy, reason = 'Manual cancellation') {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || !standup.isActive()) {
        return false;
      }
      standup.updateStatus(STANDUP_STATUS.CANCELLED);
      standup.cancelledBy = cancelledBy;
      standup.cancelReason = reason;
      await standup.save();
      
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

  isBotRemovedError(error) {
    return error.data?.error === 'channel_not_found' || 
           error.data?.error === 'not_in_channel' ||
           error.data?.error === 'channel_is_archived';
  }

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

  async getStandupParticipants(channelId, channelConfig) {
    try {
      let participantIds;
      if (channelConfig.hasSpecificParticipants()) {
        participantIds = channelConfig.getParticipants();
      } else {
        const members = await this.slackService.getChannelMembers(channelId);
        participantIds = members.filter(member => !member.startsWith('B'));
      }
      const participants = await this.slackService.getUsersInfo(participantIds);
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
   * Calculate the response deadline as a real date/time based on the channel's
   * configured deadlineTime and timezone.
   * 
   * For example: deadlineTime = '18:00', timezone = 'America/Los_Angeles'
   * → returns "today at 6:00 PM LA time" as a UTC Date.
   * If the deadline has already passed for today, uses tomorrow.
   * Falls back to duration-based calculation for legacy configs without deadlineTime.
   */
  calculateDeadlineDate(channel) {
    const deadlineTime = channel.config.deadlineTime;
    const timezone = channel.config.timezone || 'UTC';

    // Legacy fallback: if no deadlineTime configured, use duration-based approach
    if (!deadlineTime) {
      return new Date(Date.now() + (channel.config.responseTimeout || DEFAULT_RESPONSE_TIMEOUT));
    }

    const [deadlineHour, deadlineMinute] = deadlineTime.split(':').map(Number);
    const now = new Date();

    // Get today's date in the channel's timezone
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);

    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;
    const currentHour = parseInt(dateParts.find(p => p.type === 'hour').value);
    const currentMinute = parseInt(dateParts.find(p => p.type === 'minute').value);

    // Check if deadline has already passed for today in the timezone
    const isPast = currentHour > deadlineHour ||
      (currentHour === deadlineHour && currentMinute >= deadlineMinute);

    let targetYear = year;
    let targetMonth = month;
    let targetDay = day;

    if (isPast) {
      // Use tomorrow's date in the timezone
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tmrwParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(tomorrow);

      targetYear = tmrwParts.find(p => p.type === 'year').value;
      targetMonth = tmrwParts.find(p => p.type === 'month').value;
      targetDay = tmrwParts.find(p => p.type === 'day').value;
    }

    // Build the local datetime string: "YYYY-MM-DDTHH:MM:00"
    const localDateStr = `${targetYear}-${targetMonth}-${targetDay}T${String(deadlineHour).padStart(2, '0')}:${String(deadlineMinute).padStart(2, '0')}:00`;

    // Convert local time in timezone to UTC using iterative offset refinement
    // Start by assuming local time = UTC, then refine
    let utcGuess = new Date(localDateStr + 'Z');

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    for (let i = 0; i < 2; i++) {
      const guessParts = formatter.formatToParts(utcGuess);
      const guessStr = `${guessParts.find(p => p.type === 'year').value}-${guessParts.find(p => p.type === 'month').value}-${guessParts.find(p => p.type === 'day').value}T${guessParts.find(p => p.type === 'hour').value}:${guessParts.find(p => p.type === 'minute').value}:${guessParts.find(p => p.type === 'second').value}`;

      const guessLocal = new Date(guessStr + 'Z');
      const wantLocal = new Date(localDateStr + 'Z');
      const diffMs = guessLocal.getTime() - wantLocal.getTime();

      if (diffMs === 0) break;
      utcGuess = new Date(utcGuess.getTime() - diffMs);
    }

    return utcGuess;
  }
}

module.exports = StandupLifecycleService;