const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const SlackService = require('./slackService');

class StandupReminderService {
  constructor(app, slackService) {
    this.app = app;
    this.slackService = slackService || new SlackService(app);
  }

  async sendReminders(standupId) {
    try {
      const standup = await Standup.findById(standupId);
      if (!standup || !standup.isActive()) {
        return false;
      }
      if (standup.hasAllResponses()) {
        console.log(`✅ All responses already received for standup ${standupId}, clearing reminders`);
        standup.clearReminders();
        await standup.save();
        return false;
      }
      const missingParticipants = standup.getMissingParticipants();
      if (missingParticipants.length === 0) {
        console.log(`✅ No missing participants for standup ${standupId}`);
        standup.clearReminders();
        await standup.save();
        return false;
      }
      const missingUsers = await this.slackService.getUsersInfo(missingParticipants);
      const mentions = missingUsers.map(user => this.slackService.formatUserMention(user.id)).join(' ');
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
      await this.slackService.postMessage(
        standup.channelId,
        reminderText,
        null,
        standup.threadTs
      );
      standup.addReminder('general');
      const channel = await Channel.findByChannelId(standup.teamId, standup.channelId);
      if (channel.config.enableReminders && timeLeft > 0) {
        const nextReminderTime = new Date(Date.now() + channel.config.reminderInterval);
        if (nextReminderTime < standup.responseDeadline) {
          standup.setNextReminder(nextReminderTime);
        } else {
          standup.clearReminders();
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
}

module.exports = StandupReminderService; 