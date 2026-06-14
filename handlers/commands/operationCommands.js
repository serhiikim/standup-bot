
const StandupService = require('../../services/standupService');
const Channel = require('../../models/Channel');
const Standup = require('../../models/Standup');
const { MESSAGES } = require('../../utils/constants');
const { isDMChannel } = require('../../utils/channelHelpers');

function register(app) {
  const standupService = new StandupService(app);

  // /standup-start command
  app.command('/standup-start', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id } = command;

      if (isDMChannel(channel_id)) {
        return respond({
          text: `🚀 *Start Standups in Channels Only*\n\n` +
                `Standups are team activities that happen in channels, not direct messages.\n\n` +
                `📋 *To start a standup:*\n` +
                `1. Go to the channel with standup configured\n` +
                `2. Type \`/standup-start\` in that channel\n\n` +
                `💡 *Check your pending responses:* \`/standup-status\``,
          response_type: 'ephemeral'
        });
      }

      console.log(`🚀 Start command received for channel ${channel_id} by user ${user_id}`);

      // Validate channel configuration
      const channel = await Channel.findByChannelId(team_id, channel_id);
      
      if (!channel) {
        console.log(`❌ Channel ${channel_id} not configured`);
        return respond({
          text: `${MESSAGES.CHANNEL_NOT_CONFIGURED}\n\n💡 *Quick fix:* Run \`/standup-setup\` first to configure this channel.`,
          response_type: 'ephemeral'
        });
      }

      if (!channel.isActive) {
        console.log(`❌ Channel ${channel_id} is inactive (status: ${channel.status})`);
        return respond({
          text: `❌ Standups are disabled for this channel.\n\n💡 *Quick fix:* Run \`/standup-setup\` to re-enable standups.`,
          response_type: 'ephemeral'
        });
      }

      // Check for existing active standups
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      console.log(`🔄 Active standups in channel: ${activeStandups.length}`);
      
      if (activeStandups.length > 0) {
        const activeStandup = activeStandups[0];
        return respond({
          text: `⚠️ There is already an active standup in this channel.\n\n` +
                `📊 *Current standup:*\n` +
                `• Started: ${activeStandup.startedAt.toLocaleString()}\n` +
                `• Responses: ${activeStandup.stats.totalResponded}/${activeStandup.stats.totalExpected}\n` +
                `• Deadline: ${activeStandup.responseDeadline.toLocaleString()}`,
          response_type: 'ephemeral'
        });
      }

      // Start manual standup
      console.log(`🎯 Starting manual standup for channel ${channel_id}`);
      const standup = await standupService.startStandup(team_id, channel_id, user_id, true);
      
      console.log(`✅ Manual standup started successfully: ${standup._id}`);

    } catch (error) {
      console.error('Error in /standup-start command:', error);
      
      // Handle specific error types
      if (error.message === 'Channel not configured or inactive') {
        return respond({
          text: `❌ This channel is not properly configured for standups.\n\n💡 *Solution:* Run \`/standup-setup\` to configure this channel first.`,
          response_type: 'ephemeral'
        });
      }
      
      if (error.message === 'Bot removed from channel - standups auto-disabled') {
        return respond({
          text: '🤖 Bot was removed from this channel, so standups have been automatically disabled.\n\n💡 *Solution:* Re-invite the bot (`/invite @StandupBot`) and run `/standup-setup`.',
          response_type: 'ephemeral'
        });
      }

      return respond({
        text: `❌ Failed to start standup: ${error.message}\n\n💡 Try running \`/standup-status\` to check the current configuration.`,
        response_type: 'ephemeral'
      });
    }
  });

  // /standup-complete command
  app.command('/standup-complete', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      if (isDMChannel(channel_id)) {
        return respond({
          text: `✅ *Complete Standups in Channels Only*\n\n` +
                `Go to the channel with an active standup and use \`/standup-complete\` there.\n\n` +
                `💡 *Check pending responses:* \`/standup-status\``,
          response_type: 'ephemeral'
        });
      }

      console.log(`✅ Complete command received for channel ${channel_id}`);

      // Find active standup
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      if (activeStandups.length === 0) {
        return respond({
          text: '❌ No active standup found in this channel.',
          response_type: 'ephemeral'
        });
      }

      const standup = activeStandups[0];
      console.log(`🎯 Completing standup ${standup._id}`);
      
      const success = await standupService.completeStandup(standup._id, 'manual_admin');

      if (success) {
        console.log(`✅ Standup ${standup._id} completed successfully`);
        return respond({
          text: `✅ Standup completed successfully!\n\n📊 Final stats: ${standup.stats.totalResponded}/${standup.stats.totalExpected} responses`,
          response_type: 'ephemeral'
        });
      } else {
        return respond({
          text: '❌ Failed to complete standup.',
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      console.error('Error in /standup-complete command:', error);
      return respond({
        text: '❌ Failed to complete standup. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });

  // /standup-disable command
  app.command('/standup-disable', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id } = command;

      if (isDMChannel(channel_id)) {
        return respond({
          text: `🚫 *Disable Standups in Channels Only*\n\n` +
                `Go to the channel where you want to disable standups and use \`/standup-disable\` there.`,
          response_type: 'ephemeral'
        });
      }

      console.log(`🚫 Disable command received for channel ${channel_id} by user ${user_id}`);

      const channel = await Channel.findByChannelId(team_id, channel_id);

      if (!channel) {
        return respond({
          text: `❌ No standup configuration found for this channel.\n\n💡 Nothing to disable — standups were never set up here.`,
          response_type: 'ephemeral'
        });
      }

      if (!channel.isActive) {
        return respond({
          text: `ℹ️ Standups are already disabled for this channel.\n\n💡 To re-enable, run \`/standup-setup\`.`,
          response_type: 'ephemeral'
        });
      }

      // Cancel any active standup first
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      for (const standup of activeStandups) {
        const standupInstance = new Standup(standup);
        standupInstance.updateStatus('cancelled');
        standupInstance.clearReminders();
        await standupInstance.save();
        console.log(`⏹️ Cancelled active standup ${standup._id}`);
      }

      // Disable the channel config
      await Channel.updateByChannelId(team_id, channel_id, {
        isActive: false,
        status: 'disabled'
      });

      console.log(`✅ Standups disabled for channel ${channel_id}`);

      return respond({
        text: `🚫 *Standups Disabled*\n\n` +
              `Scheduled standups have been turned off for this channel.` +
              (activeStandups.length > 0 ? `\n⏹️ ${activeStandups.length} active standup(s) cancelled.` : '') +
              `\n\n💡 To re-enable, run \`/standup-setup\`. Your configuration will be preserved.`,
        response_type: 'ephemeral'
      });

    } catch (error) {
      console.error('Error in /standup-disable command:', error);
      return respond({
        text: '❌ Failed to disable standups. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });
}

module.exports = { register }; 