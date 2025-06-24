const timezoneHelper = require('../../utils/timezoneHelper');
const {
  BLOCK_IDS,
  TIME_OPTIONS,
  DAY_OPTIONS,
  TIMEZONES,
  DEFAULT_STANDUP_QUESTIONS
} = require('../../utils/constants');

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

  const timezoneHint = isUpdate 
    ? `Current timezone: *${timezoneHelper.getTimezoneLabel(defaultTimezone)}*`
    : `Auto-detected timezone: *${timezoneHelper.getTimezoneLabel(defaultTimezone)}*`;

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
            value: defaultTimezone
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
          text: 'Participants'
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

module.exports = { createSetupModal }; 