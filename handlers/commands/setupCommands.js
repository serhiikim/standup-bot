const SlackService = require('../../services/slackService');
const Channel = require('../../models/Channel');
const timezoneHelper = require('../../utils/timezoneHelper');
const { createSetupModal } = require('./modalBuilder');
const { MESSAGES } = require('../../utils/constants');

function register(app) {
  const slackService = new SlackService(app);

  // /standup-setup command
  app.command('/standup-setup', async ({ command, ack, respond, client }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id, trigger_id } = command;

      console.log(`📋 Setup command received for channel ${channel_id} by user ${user_id}`);

      // Get user timezone
      let userTimezone = 'UTC';
      try {
        const userInfo = await slackService.getUserInfo(user_id);
        userTimezone = userInfo.tz || 'UTC';
        console.log(`User ${user_id} timezone: ${userTimezone}`);
      } catch (error) {
        console.warn('Could not get user timezone, using UTC:', error.message);
      }

      // Validate channel access
      let channelInfo;
      try {
        channelInfo = await slackService.getChannelInfo(channel_id);
        if (!channelInfo) {
          return respond({
            text: '❌ Cannot access this channel. Please invite the bot to this channel first.\n\nType: `/invite @StandupBot`',
            response_type: 'ephemeral'
          });
        }
        console.log(`📍 Channel info retrieved: #${channelInfo.name}`);
      } catch (error) {
        console.error('Error getting channel info:', error);
        if (error.data?.error === 'channel_not_found') {
          return respond({
            text: '❌ Cannot access this channel. Please invite the bot to this channel first.\n\nType: `/invite @StandupBot`',
            response_type: 'ephemeral'
          });
        }
        throw error;
      }

      // Get existing configuration
      const existingChannel = await Channel.findByChannelId(team_id, channel_id);
      console.log(`⚙️ Existing configuration: ${existingChannel ? 'Found' : 'None'}`);
      
      // Create and open modal
      const modal = createSetupModal(channelInfo, existingChannel, userTimezone);
      modal.private_metadata = JSON.stringify({ 
        channelId: channel_id,
        userTimezone: userTimezone 
      });
      
      await slackService.openModal(trigger_id, modal);
      console.log(`✅ Setup modal opened successfully for channel ${channel_id}`);

    } catch (error) {
      console.error('Error in /standup-setup command:', error);
      return respond({
        text: MESSAGES.SETUP_ERROR,
        response_type: 'ephemeral'
      });
    }
  });
}

module.exports = { register }; 