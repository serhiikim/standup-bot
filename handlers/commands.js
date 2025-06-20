const SlackService = require('../services/slackService');
const StandupService = require('../services/standupService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
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
  
      // Get user info to determine timezone
      const userInfo = await slackService.getUserInfo(user_id);
      const userTimezone = userInfo.tz || 'UTC';
      
      console.log(`User ${user_id} timezone: ${userTimezone}`);
  
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
      } catch (error) {
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
      
      // Create the setup modal with channel context and user timezone
      const modal = createSetupModal(channelInfo, existingChannel, userTimezone);
      
      // Pass channel ID and user timezone in private metadata
      modal.private_metadata = JSON.stringify({ 
        channelId: channel_id,
        userTimezone: userTimezone 
      });
      
      await slackService.openModal(trigger_id, modal);
  
    } catch (error) {
      console.error('Error in /standup-setup command:', error);
      return respond({
        text: MESSAGES.SETUP_ERROR,
        response_type: 'ephemeral'
      });
    }
  });

  // /standup-start command (manual start for testing)
  app.command('/standup-start', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, user_id } = command;

      // Check if channel is configured
      const channel = await Channel.findByChannelId(team_id, channel_id);
      if (!channel) {
        return respond({
          text: MESSAGES.CHANNEL_NOT_CONFIGURED,
          response_type: 'ephemeral'
        });
      }

      // Check for active standups
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      if (activeStandups.length > 0) {
        return respond({
          text: '⚠️ There is already an active standup in this channel.',
          response_type: 'ephemeral'
        });
      }

      // Start manual standup using standupService
      const standup = await standupService.startStandup(team_id, channel_id, user_id, true);
      
      return respond({
        text: `🚀 Manual standup started successfully!\n\nParticipants have been notified and can respond in the thread.`,
        response_type: 'ephemeral'
      });

    } catch (error) {
      console.error('Error in /standup-start command:', error);
      return respond({
        text: '❌ Failed to start standup. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });

  // /standup-status command
  app.command('/standup-status', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      // Get comprehensive status using standupService
      const status = await standupService.getChannelStatus(team_id, channel_id);
      if (!status) {
        return respond({
          text: MESSAGES.CHANNEL_NOT_CONFIGURED,
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
      statusText += `• Status: ${channel.status}\n`;
      statusText += `• Questions: ${channel.config.questions.length}\n\n`;

      // Active standup info
      if (activeStandups.length > 0) {
        const activeStandup = activeStandups[0];
        statusText += `🔄 *Active Standup:*\n`;
        statusText += `• Started: ${activeStandup.startedAt.toLocaleString()}\n`;
        statusText += `• Responses: ${activeStandup.stats.totalResponded}/${activeStandup.stats.totalExpected}\n`;
        statusText += `• Deadline: ${activeStandup.responseDeadline.toLocaleString()}\n\n`;
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

  // Admin commands for testing
  app.command('/standup-complete', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id, text } = command;

      // Get active standup
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      if (activeStandups.length === 0) {
        return respond({
          text: '❌ No active standup found in this channel.',
          response_type: 'ephemeral'
        });
      }

      const standup = activeStandups[0];
      const success = await standupService.completeStandup(standup._id, 'manual_admin');

      if (success) {
        return respond({
          text: '✅ Standup completed successfully!',
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

  app.command('/standup-remind', async ({ command, ack, respond }) => {
    await ack();

    try {
      const { team_id, channel_id } = command;

      // Get active standup
      const activeStandups = await Standup.findActiveByChannel(team_id, channel_id);
      if (activeStandups.length === 0) {
        return respond({
          text: '❌ No active standup found in this channel.',
          response_type: 'ephemeral'
        });
      }

      const standup = activeStandups[0];
      const success = await standupService.sendReminders(standup._id);

      if (success) {
        return respond({
          text: '📢 Reminders sent successfully!',
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

  console.log('✅ Command handlers registered');
}

function createSetupModal(channelInfo, existingChannel, userTimezone = 'UTC') {
    const isUpdate = !!existingChannel;
    const config = existingChannel?.config || {};
  
    // Determine the timezone with the following priority:
    // 1. Saved in config
    // 2. User's timezone
    // 3. UTC as a fallback
    const defaultTimezone = config.timezone || userTimezone || 'UTC';
    
    // Check if this timezone is in our list of supported timezones
    const supportedTimezone = TIMEZONES.find(tz => tz.value === defaultTimezone);
    const selectedTimezone = supportedTimezone ? defaultTimezone : 'UTC';
  
    return {
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
              text: `🌍 Auto-detected timezone: *${selectedTimezone}* ${selectedTimezone !== userTimezone ? '(adjusted to supported timezone)' : ''}`
            }
          ]
        },
        {
          type: 'divider'
        },
  
        // Questions input (no changes)
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
  
        // Time selection (no changes)
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
  
        // Days selection (no changes)
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
  
        // Timezone is now auto-detected and not displayed in the form
  
        // Participants selection (no changes)
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