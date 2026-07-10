const SlackService = require('../services/slackService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const StandupService = require('../services/standupService');
const { STANDUP_STATUS } = require('../utils/constants');

let slackService;
let standupService;

// In-memory lock to prevent concurrent processing of messages from the same user
const processingLocks = new Set();

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);
  // Handle messages in threads (for standup responses)
  app.event('message', async ({ event, client }) => {
    try {
      // Allow message_changed subtype for native Slack edits
      const isNativeEdit = event.subtype === 'message_changed';

      if (event.subtype && !isNativeEdit) {
        return;
      }

      // For native edits, message data is nested under event.message
      const messageData = isNativeEdit ? event.message : event;

      // Only process threaded messages
      if (!messageData.thread_ts) {
        return;
      }

      // Skip bot messages
      if (messageData.bot_id) {
        return;
      }

      const { user, text, ts, thread_ts } = messageData;
      const team = event.team || messageData.team;
      const channel = event.channel;

      // Check if this is a response to an active (or just-completed) standup
      const standup = await Standup.findByThreadTs(team, thread_ts);
      const isCompletedStandup = standup?.status === STANDUP_STATUS.COMPLETED;
      if (!standup || (!standup.isActive() && !isCompletedStandup)) {
        return; // Not a standup thread we still accept responses for
      }

      // Check if user is expected to participate
      if (!standup.expectedParticipants.includes(user)) {
        return;
      }

      // Prevent concurrent processing for the same user+standup
      const lockKey = `${standup._id}:${user}`;
      if (processingLocks.has(lockKey)) {
        return;
      }
      processingLocks.add(lockKey);

      try {
      // Get user info for better display
      const userInfo = await slackService.getUserInfo(user);

      // A response is "late" if the standup already completed (summary sent) or
      // the deadline has passed but the completion job hasn't caught up yet.
      const isLate = isCompletedStandup ||
        (standup.responseDeadline && new Date() > standup.responseDeadline);

      // Handle response (create or update)
      const existingResponse = await Response.findByStandupAndUser(standup._id, user);
      let responseAction = '';

      if (existingResponse) {
        // Update existing response
        existingResponse.parseRawMessage(text, standup.questions);
        existingResponse.messageTs = ts;
        existingResponse.isLate = isLate;
        existingResponse.markAsEdited();
        await existingResponse.save();
        responseAction = 'updated';

        // React to show update received (skip for native edits — the original ✅ is already there)
        if (!isNativeEdit) {
          await client.reactions.add({
            channel: channel,
            timestamp: ts,
            name: 'pencil2' // Edit emoji
          });
        }

      } else if (!isNativeEdit) {
        // Create new response (only for new messages, not native edits)
        const responseData = {
          standupId: standup._id,
          teamId: team,
          channelId: channel,
          userId: user,
          username: userInfo.name,
          userDisplayName: userInfo.profile?.display_name || userInfo.real_name || userInfo.name,
          messageTs: ts,
          threadTs: thread_ts,
          submittedAt: new Date(),
          isLate
        };

        const response = await Response.create(responseData);
        response.parseRawMessage(text, standup.questions);
        response.calculateResponseTime(standup.startedAt);
        await response.save();

        // Don't touch participant/stats for a standup that already completed —
        // its summary and stats were already computed and posted.
        if (!isCompletedStandup) {
          standup.addParticipant(user);
          await standup.save();
        }
        responseAction = 'received';

        // React to show response received
        await client.reactions.add({
          channel: channel,
          timestamp: ts,
          name: 'white_check_mark'
        });
      } else {
        // Native edit on a message we don't have a response for — ignore
        return;
      }

      console.log(`Standup response ${responseAction} from ${userInfo.name}${isLate ? ' (late)' : ''}`);

      // Skip completion checks entirely for a standup that's already completed —
      // nothing left to auto-complete or re-summarize.
      if (!isCompletedStandup) {
        // 🎯 SINGLE RESPONSIBILITY: Delegate all business logic to StandupService
        const completionResult = await standupService.checkStandupCompletion(standup._id, 'response');

        if (completionResult.success) {
          console.log(`📊 Standup completion check result:`, completionResult);
        } else {
          console.error(`❌ Standup completion check failed:`, completionResult.error);
        }
      }

      } finally {
        processingLocks.delete(lockKey);
      }

    } catch (error) {
      console.error('Error handling message event:', error);
    }
  });

  // Handle app mentions (for bot interaction)
  app.event('app_mention', async ({ event, client, say }) => {
    try {
      const { channel, user, text } = event;

      // Simple bot interaction - could be expanded
      if (text.toLowerCase().includes('help')) {
        await say({
          channel: channel,
          text: `👋 Hi there! I'm your standup bot. Here's what I can do:

• \`/standup-setup\` - Configure standup for this channel
• \`/standup-start\` - Manually start a standup
• \`/standup-status\` - Check current standup configuration

For more help, visit our documentation!`
        });
      } else {
        await say({
          channel: channel,
          text: `👋 Hi ${slackService.formatUserMention(user)}! I'm here to help with standups. Type \`/standup-setup\` to get started or mention me with "help" for more information.`
        });
      }

    } catch (error) {
      console.error('Error handling app mention:', error);
    }
  });

  // Handle channel events (for maintaining channel info)
  app.event('channel_rename', async ({ event }) => {
    try {
      const { channel } = event;
      
      // Update channel name in our database
      const channelConfig = await Channel.findByChannelId(event.team, channel.id);
      if (channelConfig) {
        await Channel.updateByChannelId(event.team, channel.id, {
          channelName: channel.name
        });
        console.log(`Updated channel name: ${channel.name}`);
      }

    } catch (error) {
      console.error('Error handling channel rename:', error);
    }
  });

  // Handle member join/leave events (for participant management)
  app.event('member_joined_channel', async ({ event }) => {
    try {
      const { channel, user, team } = event;
      
      // Check if this channel has standup configured
      const channelConfig = await Channel.findByChannelId(team, channel);
      if (channelConfig && channelConfig.isActive) {
        
        // If no specific participants are set, new member is automatically included
        if (!channelConfig.hasSpecificParticipants()) {
          console.log(`New member ${user} joined standup-enabled channel ${channel}`);
          
          // Optionally send welcome message
          // await slackService.sendDM(user, 
          //   `👋 Welcome! This channel has daily standups configured. You'll be automatically included in future standups.`
          // );
        }
      }

    } catch (error) {
      console.error('Error handling member joined:', error);
    }
  });

  app.event('member_left_channel', async ({ event }) => {
    try {
      const { channel, user, team } = event;
      
      // Remove user from specific participants if they were added
      const channelConfig = await Channel.findByChannelId(team, channel);
      if (channelConfig && channelConfig.config.participants.includes(user)) {
        const updatedParticipants = channelConfig.config.participants.filter(p => p !== user);
        await Channel.updateByChannelId(team, channel, {
          'config.participants': updatedParticipants
        });
        console.log(`Removed ${user} from standup participants in ${channel}`);
      }

    } catch (error) {
      console.error('Error handling member left:', error);
    }
  });

  // Handle reaction events (for bot interaction feedback)
  app.event('reaction_added', async ({ event }) => {
    try {
      // Could implement reaction-based interactions here
      // For example, reacting with specific emoji to standup messages
      if (event.reaction === 'question' && event.item.type === 'message') {
        // User has a question about the standup
        console.log('User has question about standup:', event.user);
      }

    } catch (error) {
      console.error('Error handling reaction:', error);
    }
  });

  console.log('✅ Event handlers registered');
}

module.exports = { register };