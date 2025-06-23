const SlackService = require('../services/slackService');
const StandupService = require('../services/standupService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const timezoneHelper = require('../utils/timezoneHelper');
const { 
  MESSAGES, 
  BLOCK_IDS, 
  TIME_OPTIONS, 
  DAY_OPTIONS, 
  TIMEZONES,
  DEFAULT_STANDUP_QUESTIONS 
} = require('../utils/constants');

let slackService;
let standupService;

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);

  // /standup-setup command
  app.command('/standup-setup', async ({ command, ack, respond, client }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id, trigger_id } = command;

      console.log(`📋 Setup command received for channel ${channel_id} by user ${user_id}`);

      // Get user info to determine timezone
      let userTimezone = 'UTC';
      try {
        const userInfo = await slackService.getUserInfo(user_id);
        userTimezone = userInfo.tz || 'UTC';
        console.log(`User ${user_id} timezone: ${userTimezone}`);
      } catch (error) {
        console.warn('Could not get user timezone, using UTC:', error.message);
      }

      // Check if bot is in the channel
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

      // Get current channel configuration if exists
      const existingChannel = await Channel.findByChannelId(team_id, channel_id);
      console.log(`⚙️ Existing configuration: ${existingChannel ? 'Found' : 'None'}`);
      
      // Create the setup modal
      const modal = createSetupModal(channelInfo, existingChannel, userTimezone);
      
      // Pass channel ID and user timezone in private metadata
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

  // /standup-start command
  app.command('/standup-start', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id } = command;

      console.log(`🚀 Start command received for channel ${channel_id} by user ${user_id}`);

      // Check if channel is configured with detailed logging
      const channel = await Channel.findByChannelId(team_id, channel_id);
      // console.log(`🔍 Channel lookup result:`, {
      //   found: !!channel,
      //   teamId: team_id,
      //   channelId: channel_id,
      //   isActive: channel?.isActive,
      //   status: channel?.status
      // });

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

      // Check for active standups
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

  // /standup-status command - enhanced with detailed diagnostics
  app.command('/standup-status', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`📊 Status command received for channel ${channel_id}`);

      // Get comprehensive status using standupService
      const status = await standupService.getChannelStatus(team_id, channel_id);
      
      if (!status) {
        console.log(`❌ No status found for channel ${channel_id}`);
        
        // Check if channel exists in database but is inactive
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
      
      // Build enhanced status message
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
        statusText += `• ID: ${activeStandup._id}\n`;
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

  // /standup-complete command
  app.command('/standup-complete', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`✅ Complete command received for channel ${channel_id}`);

      // Get active standup
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

  // /standup-remind command
  app.command('/standup-remind', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      console.log(`📢 Remind command received for channel ${channel_id}`);

      // Get active standup
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

  // /standup-debug command for troubleshooting
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

  console.log('✅ Enhanced command handlers registered with detailed logging');
}

function createSetupModal(channelInfo, existingChannel, userTimezone = 'UTC') {
  const isUpdate = !!existingChannel;
  const config = existingChannel?.config || {};

  let defaultTimezone;
  
  if (isUpdate) {
    defaultTimezone = timezoneHelper.findTimezoneOrFallback(
      config.timezone || userTimezone
    );
  } else {
    defaultTimezone = timezoneHelper.findTimezoneOrFallback(userTimezone);
  }
  

  // ✅ Correct message
  const timezoneHint = isUpdate 
  ? `Current timezone: *${timezoneHelper.getTimezoneLabel(defaultTimezone)}*`
  : `Auto-detected timezone: *${timezoneHelper.getTimezoneLabel(defaultTimezone)}*`;

  return  {
    type: 'modal',
    callback_id: BLOCK_IDS.SETUP_MODAL,
    title: {
      type: 'plain_text',
      text: isUpdate ? 'Update Standup Setup' : 'Standup Setup'
    },
    submit: {
      type: 'plain_text',
      text: isUpdate ? 'Update' : 'Create'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    blocks: [
      // Header with timezone information
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${isUpdate ? '✏️ *Update' : '🚀 *Setup'} standup configuration for #${channelInfo.name}*`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🌍 ${timezoneHint}`
          }
        ]
      },
      {
        type: 'divider'
      },

      // Questions input
      {
        type: 'input',
        block_id: BLOCK_IDS.QUESTIONS_INPUT,
        label: {
          type: 'plain_text',
          text: 'Standup Questions'
        },
        element: {
          type: 'plain_text_input',
          action_id: BLOCK_IDS.QUESTIONS_INPUT,
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Enter each question on a new line...'
          },
          initial_value: config.questions ? config.questions.join('\n') : DEFAULT_STANDUP_QUESTIONS.join('\n')
        },
        hint: {
          type: 'plain_text',
          text: 'Enter each question on a separate line. Maximum 10 questions.'
        }
      },

      // Time selection
      {
        type: 'input',
        block_id: BLOCK_IDS.TIME_SELECT,
        label: {
          type: 'plain_text',
          text: 'Standup Time'
        },
        element: {
          type: 'static_select',
          action_id: BLOCK_IDS.TIME_SELECT,
          placeholder: {
            type: 'plain_text',
            text: 'Select time'
          },
          initial_option: config.time ? {
            text: {
              type: 'plain_text',
              text: TIME_OPTIONS.find(t => t.value === config.time)?.label || '9:00 AM'
            },
            value: config.time
          } : {
            text: {
              type: 'plain_text',
              text: '9:00 AM'
            },
            value: '09:00'
          },
          options: TIME_OPTIONS.map(option => ({
            text: {
              type: 'plain_text',
              text: option.label
            },
            value: option.value
          }))
        }
      },

      // Days selection
      {
        type: 'input',
        block_id: BLOCK_IDS.DAYS_SELECT,
        label: {
          type: 'plain_text',
          text: 'Standup Days'
        },
        element: {
          type: 'checkboxes',
          action_id: BLOCK_IDS.DAYS_SELECT,
          initial_options: config.days ? 
            config.days.map(day => ({
              text: {
                type: 'plain_text',
                text: DAY_OPTIONS.find(d => d.value === day)?.label || 'Unknown'
              },
              value: day.toString()
            })) : 
            [1, 2, 3, 4, 5].map(day => ({
              text: {
                type: 'plain_text',
                text: DAY_OPTIONS.find(d => d.value === day)?.label || 'Unknown'
              },
              value: day.toString()
            })),
          options: DAY_OPTIONS.map(option => ({
            text: {
              type: 'plain_text',
              text: option.label
            },
            value: option.value.toString()
          }))
        }
      },

      // Timezone selection
      {
        type: 'input',
        block_id: BLOCK_IDS.TIMEZONE_SELECT,
        label: {
          type: 'plain_text',
          text: 'Timezone'
        },
        element: {
          type: 'static_select',
          action_id: BLOCK_IDS.TIMEZONE_SELECT,
          placeholder: {
            type: 'plain_text',
            text: 'Select timezone'
          },
          initial_option: {
            text: {
              type: 'plain_text',
              text: timezoneHelper.getTimezoneLabel(defaultTimezone)
            },
            value: defaultTimezone // ✅ Use correct timezone!
          },
          options: TIMEZONES.map(tz => ({
            text: {
              type: 'plain_text',
              text: tz.label
            },
            value: tz.value
          }))
        }
      },

      // Participants selection
      {
        type: 'input',
        block_id: BLOCK_IDS.PARTICIPANTS_SELECT,
        label: {
          type: 'plain_text',
          text: 'Participants (Optional)'
        },
        element: {
          type: 'multi_users_select',
          action_id: BLOCK_IDS.PARTICIPANTS_SELECT,
          placeholder: {
            type: 'plain_text',
            text: 'Select specific users or leave empty for all channel members'
          },
          initial_users: config.participants || []
        },
        optional: true,
        hint: {
          type: 'plain_text',
          text: 'Leave empty to include all channel members automatically.'
        }
      }
    ]
  };
}

module.exports = { register };