
const StandupService = require('../../services/standupService');
const Standup = require('../../models/Standup');
const { isDMChannel } = require('../../utils/channelHelpers');

function register(app) {  
  const standupService = new StandupService(app);

  // /standup-remind command
  app.command('/standup-remind', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      if (isDMChannel(channel_id)) {
        return respond({
          text: `📢 *Send Reminders in Channels Only*\n\n` +
                `Go to the channel with an active standup and use \`/standup-remind\` there.\n\n` +
                `💡 *Check your status:* \`/standup-status\``,
          response_type: 'ephemeral'
        });
      }

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
}

module.exports = { register };