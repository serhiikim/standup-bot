const StandupService = require('../../services/standupService');
const Channel = require('../../models/Channel');
const { MESSAGES, DAY_OPTIONS } = require('../../utils/constants');
const { isDMChannel, getUserPendingStandups } = require('../../utils/channelHelpers');
const Response = require('../../models/Response');
const SlackService = require('../../services/slackService');

function register(app) {
  const standupService = new StandupService(app);
  const slackService = new SlackService(app);
  // /standup-status command
  app.command('/standup-status', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id } = command;

      if (isDMChannel(channel_id)) {
        console.log(`👤 Personal status command received from user ${user_id}`);
        
        const pendingStandups = await getUserPendingStandups(team_id, user_id);
        const recentResponses = await Response.findByUser(team_id, user_id, 5);
        
        let statusText = `👤 *Your Standup Status*\n\n`;
        
        // Pending responses section
        if (pendingStandups.length > 0) {
          statusText += `⏰ *Pending Responses (${pendingStandups.length}):*\n`;
          
          for (const standup of pendingStandups) {
            try {
              const channelInfo = await slackService.getChannelInfo(standup.channelId);
              const timeLeft = standup.responseDeadline - new Date();
              const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
              const minutesLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));
              
              statusText += `🔄 *#${channelInfo?.name || standup.channelId}*\n`;
              if (hoursLeft > 0) {
                statusText += `   ⏱️ ${hoursLeft}h ${minutesLeft}m left\n`;
              } else if (minutesLeft > 0) {
                statusText += `   ⏱️ ${minutesLeft}m left\n`;
              } else {
                statusText += `   ⚠️ Overdue\n`;
              }
              statusText += `   📝 ${standup.questions.length} questions\n\n`;
            } catch (error) {
              console.warn(`Could not fetch channel info for ${standup.channelId}:`, error.message);
              statusText += `🔄 *Unknown channel*\n`;
              statusText += `   ⏱️ Please check the channel\n\n`;
            }
          }
        } else {
          statusText += `✅ *No pending responses!*\n\n`;
        }

        // Recent activity section
        if (recentResponses.length > 0) {
          statusText += `📋 *Recent Activity (Last 5):*\n`;
          recentResponses.forEach(response => {
            const date = response.submittedAt.toLocaleDateString();
            const time = response.submittedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const status = response.isComplete ? '✅' : '⚠️';
            const edited = response.isEdited ? ' ✏️' : '';
            statusText += `• ${date} ${time} ${status}${edited}\n`;
          });
          statusText += `\n`;
        }

        // Helpful tips
        statusText += `💡 *Tips:*\n`;
        statusText += `• Use \`/standup-status\` in channels for team info\n`;
        statusText += `• Reply to standup threads to submit responses\n`;
        statusText += `• You can edit responses before the deadline`;

        return respond({
          text: statusText,
          response_type: 'ephemeral'
        });
      }

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