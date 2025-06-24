const SlackService = require('../../services/slackService');
const StandupService = require('../../services/standupService');
const Channel = require('../../models/Channel');
const Standup = require('../../models/Standup');

let slackService;
let standupService;

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);

  // /standup-remind command
  app.command('/standup-remind', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`📢 Remind command received for channel ${channel_id}`);

      // Find active standup
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      if (activeStandups.length === 0) {
        return respond({
          text: '❌ No active standup found in this channel.',
          response_type: 'ephemeral'
        });
      }

      const standup = activeStandups[0];
      const missingCount = standup.getMissingParticipants().length;
      
      console.log(`📢 Sending reminders for standup ${standup._id} (${missingCount} missing participants)`);
      
      const success = await standupService.sendReminders(standup._id);

      if (success) {
        return respond({
          text: `📢 Reminders sent successfully!\n\n👥 Reminded ${missingCount} participant(s) who haven't responded yet.`,
          response_type: 'ephemeral'
        });
      } else {
        return respond({
          text: '❌ No reminders needed (everyone responded or no missing participants).',
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      console.error('Error in /standup-remind command:', error);
      return respond({
        text: '❌ Failed to send reminders. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });

  // /standup-debug command
  app.command('/standup-debug', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`🔍 Debug command received for channel ${channel_id}`);

      // Get raw database info
      const channel = await Channel.findByChannelId(team_id, channel_id);
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      
      let debugText = `🔍 *Debug Info for Channel ${channel_id}*\n\n`;
      
      // Channel info
      debugText += `**Channel Configuration:**\n`;
      if (channel) {
        debugText += `• Found: ✅\n`;
        debugText += `• ID: ${channel._id}\n`;
        debugText += `• Name: ${channel.channelName}\n`;
        debugText += `• Active: ${channel.isActive}\n`;
        debugText += `• Status: ${channel.status}\n`;
        debugText += `• Created: ${channel.createdAt}\n`;
        debugText += `• Updated: ${channel.updatedAt}\n`;
        debugText += `• Questions count: ${channel.config.questions.length}\n`;
        debugText += `• Participants: ${channel.config.participants.length}\n`;
      } else {
        debugText += `• Found: ❌\n`;
      }
      
      debugText += `\n**Active Standups:**\n`;
      if (activeStandups.length > 0) {
        activeStandups.forEach((standup, index) => {
          debugText += `• Standup ${index + 1}: ${standup._id}\n`;
          debugText += `  - Status: ${standup.status}\n`;
          debugText += `  - Started: ${standup.startedAt}\n`;
          debugText += `  - Expected: ${standup.stats.totalExpected}\n`;
          debugText += `  - Responded: ${standup.stats.totalResponded}\n`;
        });
      } else {
        debugText += `• No active standups found\n`;
      }

      return respond({
        text: debugText,
        response_type: 'ephemeral'
      });

    } catch (error) {
      console.error('Error in /standup-debug command:', error);
      return respond({
        text: `❌ Debug failed: ${error.message}`,
        response_type: 'ephemeral'
      });
    }
  });
}

module.exports = { register }; 