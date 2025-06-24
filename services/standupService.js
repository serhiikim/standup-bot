const StandupLifecycleService = require('./standupLifecycleService');
const StandupCompletionService = require('./standupCompletionService');
const StandupReminderService = require('./standupReminderService');
const StandupMessageBuilderService = require('./standupMessageBuilderService');
const SlackService = require('./slackService');

class StandupService {
  constructor(app) {
    this.app = app;
    this.slackService = new SlackService(app);
    this.messageBuilder = new StandupMessageBuilderService(app);
    
    // Pass dependencies to child services
    this.lifecycle = new StandupLifecycleService(app, this.slackService, this.messageBuilder);
    this.completion = new StandupCompletionService(app, this.slackService, this.messageBuilder);
    this.reminders = new StandupReminderService(app, this.slackService);
  }

  async startStandup(teamId, channelId, createdBy, isManual) {
    return this.lifecycle.createStandup(teamId, channelId, createdBy, isManual);
  }

  async checkStandupCompletion(standupId, triggeredBy) {
    return this.completion.checkStandupCompletion(standupId, triggeredBy);
  }

  async sendReminders(standupId) {
    return this.reminders.sendReminders(standupId);
  }

  async completeStandup(standupId, reason) {
    return this.completion.completeStandup(standupId, reason);
  }

  async cancelStandup(standupId, cancelledBy, reason) {
    return this.lifecycle.cancelStandup(standupId, cancelledBy, reason);
  }

  async processExpiredStandups() {
    return this.completion.processExpiredStandups();
  }

  async processPendingReminders() {
    return this.reminders.processPendingReminders();
  }

  async getChannelStatus(teamId, channelId) {
    return this.lifecycle.getChannelStatus(teamId, channelId);
  }
}

module.exports = StandupService;