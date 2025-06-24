const SlackService = require('../../services/slackService');
const StandupService = require('../../services/standupService');
const Channel = require('../../models/Channel');
const { MESSAGES, DAY_OPTIONS } = require('../../utils/constants');

let slackService;
let standupService;

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);

  // /standup-status command
  app.command('/standup-status', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`📊 Status command received for channel ${channel_id}`);

      // Get comprehensive status
      const status = await standupService.getChannelStatus(team_id, channel_id);
      
      if (!status) {
        console.log(`❌ No status found for channel ${channel_id}`);
        
        // Check if channel exists but is inactive
        const channel = await Channel.findByChannelId(team_id, channel_id);
        
        if (channel) {
          return respond({
            text: `📊 *Standup Status for #${channel.channelName}*\n\n` +
                  `❌ *Status:* ${channel.status} (${channel.isActive ? 'Active' : 'Inactive'})\n\n` +
                  `💡 *Quick fix:* Run \`/standup-setup\` to ${channel.isActive ? 'update' : 'reactivate'} configuration.`,
            response_type: 'ephemeral'
          });
        }
        
        return respond({
          text: `${MESSAGES.CHANNEL_NOT_CONFIGURED}\n\n💡 *Quick fix:* Run \`/standup-setup\` to configure this channel.`,
          response_type: 'ephemeral'
        });
      }

      const { channel, activeStandups, recentStandups } = status;
      
      // Build status message
      let statusText = `📊 *Standup Status for #${channel.channelName}*\n\n`;
      
      // Configuration info
      statusText += `⚙️ *Configuration:*\n`;
      statusText += `• Time: ${channel.config.time} (${channel.config.timezone})\n`;
      statusText += `• Days: ${channel.config.days.map(day => DAY_OPTIONS.find(d => d.value === day)?.label).join(', ')}\n`;
      statusText += `• Status: ${channel.status} ${channel.isActive ? '✅' : '❌'}\n`;
      statusText += `• Questions: ${channel.config.questions.length}\n`;
      statusText += `• Participants: ${channel.config.participants.length > 0 ? `${channel.config.participants.length} specific users` : 'All channel members'}\n\n`;

      // Active standup info
      if (activeStandups.length > 0) {
        const activeStandup = activeStandups[0];
        statusText += `🔄 *Active Standup:*\n`;
        statusText += `• Started: ${activeStandup.startedAt.toLocaleString()}\n`;
        statusText += `• Responses: ${activeStandup.stats.totalResponded}/${activeStandup.stats.totalExpected}\n`;
        statusText += `• Response Rate: ${activeStandup.getResponseRate()}%\n`;
        statusText += `• Deadline: ${activeStandup.responseDeadline.toLocaleString()}\n\n`;
      } else {
        statusText += `🔄 *Active Standup:* None\n\n`;
      }

      // Statistics
      statusText += `📈 *Statistics:*\n`;
      statusText += `• Total Standups: ${channel.stats.totalStandups}\n`;
      statusText += `• Last Standup: ${channel.stats.lastStandupDate ? new Date(channel.stats.lastStandupDate).toLocaleDateString() : 'Never'}\n`;
      statusText += `• Avg Response Rate: ${Math.round(channel.stats.avgResponseRate)}%\n\n`;

      // Recent standups
      if (recentStandups.length > 0) {
        statusText += `📋 *Recent Standups:*\n`;
        recentStandups.forEach(standup => {
          statusText += `• ${standup.startedAt.toLocaleDateString()} - ${standup.status} (${standup.getResponseRate()}% responded)\n`;
        });
      } else {
        statusText += `📋 *Recent Standups:* None\n`;
      }

      return respond({
        text: statusText,
        response_type: 'ephemeral'
      });

    } catch (error) {
      console.error('Error in /standup-status command:', error);
      return respond({
        text: '❌ Failed to get status. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });
}

module.exports = { register }; 