const SlackService = require('./slackService');
const LLMService = require('./llmService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const { STANDUP_STATUS, DEFAULT_RESPONSE_TIMEOUT } = require('../utils/constants');

class StandupLifecycleService {
  constructor(app, slackService, messageBuilder) {
    this.app = app;
    this.slackService = slackService || new SlackService(app);
    this.messageBuilder = messageBuilder;
    this.llmService = LLMService.getInstance();
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
      const participants = await this.getStandupParticipants(channelId, channel);
      if (participants.length === 0) {
        throw new Error('No participants found for standup');
      }
      const responseDeadline = new Date(Date.now() + (channel.config.responseTimeout || DEFAULT_RESPONSE_TIMEOUT));
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
      const standupInstance = new Standup(standup);
      
      const standupMessage = this.messageBuilder.createStandupMessage(standupInstance, participants, channel);
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
}

module.exports = StandupLifecycleService; 