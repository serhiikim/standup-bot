const { MESSAGES, BLOCK_IDS } = require('../utils/constants');

class SlackService {
  constructor(app) {
    this.app = app;
  }

  // Channel and user information
  async getChannelInfo(channelId) {
    try {
      const result = await this.app.client.conversations.info({
        channel: channelId
      });
      return result.channel;
    } catch (error) {
      console.error('Error getting channel info:', error);
      throw error;
    }
  }

  async getChannelMembers(channelId) {
    try {
      const result = await this.app.client.conversations.members({
        channel: channelId
      });
      return result.members;
    } catch (error) {
      console.error('Error getting channel members:', error);
      throw error;
    }
  }

  async getUserInfo(userId) {
    try {
      const result = await this.app.client.users.info({
        user: userId
      });
      return result.user;
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  async getUsersInfo(userIds) {
    try {
      const users = [];
      // Batch requests to avoid rate limits
      for (let i = 0; i < userIds.length; i += 50) {
        const batch = userIds.slice(i, i + 50);
        const promises = batch.map(userId => this.getUserInfo(userId));
        const batchResults = await Promise.allSettled(promises);
        
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            users.push(result.value);
          }
        });
      }
      return users;
    } catch (error) {
      console.error('Error getting users info:', error);
      throw error;
    }
  }

  // Message posting
  async postMessage(channelId, text, blocks = null, threadTs = null) {
    try {
      const messagePayload = {
        channel: channelId,
        text: text
      };

      if (blocks) {
        messagePayload.blocks = blocks;
      }

      if (threadTs) {
        messagePayload.thread_ts = threadTs;
      }

      const result = await this.app.client.chat.postMessage(messagePayload);
      return result;
    } catch (error) {
      console.error('Error posting message:', error);
      throw error;
    }
  }

  async updateMessage(channelId, messageTs, text, blocks = null) {
    try {
      const updatePayload = {
        channel: channelId,
        ts: messageTs,
        text: text
      };

      if (blocks) {
        updatePayload.blocks = blocks;
      }

      const result = await this.app.client.chat.update(updatePayload);
      return result;
    } catch (error) {
      console.error('Error updating message:', error);
      throw error;
    }
  }

  async getPermalink(channelId, messageTs) {
    try {
      const result = await this.app.client.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs
      });
      return result.permalink;
    } catch (error) {
      console.error('Error getting permalink:', error);
      return null;
    }
  }

  async sendDM(userId, text, blocks = null) {
    try {
      // Open DM conversation
      const conversation = await this.app.client.conversations.open({
        users: userId
      });

      return await this.postMessage(conversation.channel.id, text, blocks);
    } catch (error) {
      console.error('Error sending DM:', error);
      throw error;
    }
  }

  // Modal management
  async openModal(triggerId, view) {
    try {
      const result = await this.app.client.views.open({
        trigger_id: triggerId,
        view: view
      });
      return result;
    } catch (error) {
      console.error('Error opening modal:', error);
      throw error;
    }
  }

  async updateModal(viewId, view) {
    try {
      const result = await this.app.client.views.update({
        view_id: viewId,
        view: view
      });
      return result;
    } catch (error) {
      console.error('Error updating modal:', error);
      throw error;
    }
  }

  // Utility methods
  formatUserMention(userId) {
    return `<@${userId}>`;
  }

  formatChannelMention(channelId) {
    return `<#${channelId}>`;
  }

  formatTimestamp(timestamp, format = 'f') {
    // Slack timestamp formatting
    // f = full, d = date, t = time, etc.
    return `<!date^${Math.floor(timestamp / 1000)}^{date_pretty} at {time}|${new Date(timestamp).toLocaleString()}>`;
  }

  // Block Kit helpers
  createTextBlock(text, type = 'mrkdwn') {
    return {
      type: 'section',
      text: {
        type: type,
        text: text
      }
    };
  }

  createButtonBlock(text, actionId, value = null, style = null) {
    const button = {
      type: 'button',
      text: {
        type: 'plain_text',
        text: text
      },
      action_id: actionId
    };

    if (value) {
      button.value = value;
    }

    if (style) {
      button.style = style; // primary, danger
    }

    return {
      type: 'actions',
      elements: [button]
    };
  }

  createSelectBlock(placeholder, actionId, options) {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: placeholder
      },
      accessory: {
        type: 'static_select',
        placeholder: {
          type: 'plain_text',
          text: 'Select an option'
        },
        action_id: actionId,
        options: options.map(option => ({
          text: {
            type: 'plain_text',
            text: option.label
          },
          value: option.value.toString()
        }))
      }
    };
  }

  createMultiSelectBlock(placeholder, actionId, options, maxSelectedItems = null) {
    const block = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: placeholder
      },
      accessory: {
        type: 'multi_static_select',
        placeholder: {
          type: 'plain_text',
          text: 'Select options'
        },
        action_id: actionId,
        options: options.map(option => ({
          text: {
            type: 'plain_text',
            text: option.label
          },
          value: option.value.toString()
        }))
      }
    };

    if (maxSelectedItems) {
      block.accessory.max_selected_items = maxSelectedItems;
    }

    return block;
  }

  createInputBlock(label, actionId, placeholder = '', multiline = false, optional = false) {
    return {
      type: 'input',
      block_id: actionId,
      label: {
        type: 'plain_text',
        text: label
      },
      element: {
        type: multiline ? 'plain_text_input' : 'plain_text_input',
        action_id: actionId,
        placeholder: {
          type: 'plain_text',
          text: placeholder
        },
        multiline: multiline
      },
      optional: optional
    };
  }

  createDivider() {
    return {
      type: 'divider'
    };
  }

  // Response helpers
  respondToCommand(respond, text, responseType = 'ephemeral') {
    return respond({
      text: text,
      response_type: responseType
    });
  }

  ackCommand(ack, text = '') {
    return ack({
      text: text
    });
  }

  // Error handling
  handleSlackError(error, context = '') {
    console.error(`Slack API Error${context ? ` (${context})` : ''}:`, {
      error: error.message,
      code: error.code,
      data: error.data
    });

    // Return user-friendly error message
    if (error.code === 'channel_not_found') {
      return MESSAGES.CHANNEL_NOT_FOUND || 'Channel not found';
    } else if (error.code === 'not_in_channel') {
      return 'Bot is not a member of this channel';
    } else if (error.code === 'access_denied') {
      return MESSAGES.UNAUTHORIZED;
    } else {
      return 'An error occurred. Please try again.';
    }
  }

  // Formatting helpers
  escapeSlackText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  truncateText(text, maxLength = 3000) {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  // Team/workspace info
  async getTeamInfo() {
    try {
      const result = await this.app.client.team.info();
      return result.team;
    } catch (error) {
      console.error('Error getting team info:', error);
      throw error;
    }
  }

  async getBotInfo() {
    try {
      const result = await this.app.client.auth.test();
      return result;
    } catch (error) {
      console.error('Error getting bot info:', error);
      throw error;
    }
  }
}

module.exports = SlackService;