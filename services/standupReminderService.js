const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const SlackService = require('./slackService');

class StandupReminderService {
  constructor(app, slackService) {
    this.app = app;
    this.slackService = slackService || new SlackService(app);
  }

  generateReminderText(responseDeadline, includePrefix = true) {
    const timeLeft = responseDeadline - new Date();
    const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
    const minutesLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));
    
    let reminderText = includePrefix ? `⏰ *Standup Reminder*\n\n` : '';
    
    if (hoursLeft > 0) {
      reminderText += `You have *${hoursLeft} hour(s) and ${minutesLeft} minute(s)* left to respond to today's standup.`;
    } else if (minutesLeft > 0) {
      reminderText += `You have *${minutesLeft} minute(s)* left to respond to today's standup.`;
    } else {
      reminderText += `⚠️ Standup deadline has passed, but you can still respond!`;
    }
    
    return reminderText;
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

    //  await this.sendChannelReminders(standup, missingParticipants);
      await this.sendDMReminders(standup, missingParticipants);

      const channel = await Channel.findByChannelId(standup.teamId, standup.channelId);
      const timeLeft = standup.responseDeadline - new Date();
      if (channel.config.enableReminders && timeLeft > 0) {
        // Use 30-minute interval when less than 1 hour remains, otherwise use default
        const ONE_HOUR = 60 * 60 * 1000;
        const THIRTY_MINUTES = 30 * 60 * 1000;
        const interval = timeLeft <= ONE_HOUR ? THIRTY_MINUTES : channel.config.reminderInterval;
        const nextReminderTime = new Date(Date.now() + interval);
        if (nextReminderTime < standup.responseDeadline) {
          standup.setNextReminder(nextReminderTime);
        } else {
          standup.clearReminders();
        }
      } else {
        standup.clearReminders();
      }
      await standup.save();

      return true;
    } catch (error) {
      console.error('Error sending reminders:', error);
      return false;
    }
  }

  async sendChannelReminders(standup, missingParticipants) {
    const standupId = standup._id;
    const missingUsers = await this.slackService.getUsersInfo(missingParticipants);
    const mentions = missingUsers.map(user => this.slackService.formatUserMention(user.id)).join(' ');
    
    const reminderText = `⏰ *Standup Reminder*\n\n${mentions}\n\n` + 
                        this.generateReminderText(standup.responseDeadline, false);
    
    await this.slackService.postMessage(
      standup.channelId,
      reminderText,
      null,
      standup.threadTs
    );
    standup.addReminder('general');
    console.log(`📢 Sent reminder for standup ${standupId} to ${missingParticipants.length} users`);
    return true;
  }

  async sendDMReminders(standup, missingParticipants) {
    const standupId = standup._id;
    const standupUrl = await this.slackService.getPermalink(standup.channelId, standup.threadTs);

    let reminderText = this.generateReminderText(standup.responseDeadline);

    if (standupUrl) {
      reminderText += `\n\nPlease post your update in the <${standupUrl}|standup thread>.`;
    }

    // Send DMs sequentially with a small delay to avoid Slack rate limits
    const results = [];
    for (const userId of missingParticipants) {
      try {
        await this.slackService.sendDM(userId, reminderText);
        results.push({ userId, success: true });
      } catch (error) {
        console.error(`Failed to send DM reminder to user ${userId}:`, error);
        results.push({ userId, success: false, error: error.message });
      }
      // 300ms delay between DMs to stay under Slack rate limits
      if (missingParticipants.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    // Collect successful user IDs and add reminders sequentially to avoid race conditions
    const successfulUserIds = results
      .filter(r => r.success)
      .map(r => r.userId);

    // Add reminders sequentially to avoid race conditions on standup object
    for (const userId of successfulUserIds) {
      standup.addReminder(userId);
    }

    // Log any failures
    const failures = results.filter(r => !r.success);

    if (failures.length > 0) {
      console.warn(`Failed to send ${failures.length}/${missingParticipants.length} DM reminders for standup ${standupId}`);
      failures.forEach(f => {
        console.warn(`- User ${f.userId}: ${f.error}`);
      });
    }

    console.log(`📢 Sent DM reminders for standup ${standupId} to ${successfulUserIds.length}/${missingParticipants.length} users`);
    return successfulUserIds.length > 0;
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