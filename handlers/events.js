const SlackService = require('../services/slackService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');

let slackService;

function register(app) {
  slackService = new SlackService(app);

  // Handle messages in threads (for standup responses)
  app.event('message', async ({ event, client }) => {
    try {
      // Only process threaded messages
      if (!event.thread_ts || event.subtype) {
        return;
      }

      // Skip bot messages
      if (event.bot_id) {
        return;
      }

      const { team, channel, user, text, ts, thread_ts } = event;

      // Check if this is a response to an active standup
      const standup = await Standup.findByThreadTs(team, thread_ts);
      if (!standup) {
        return; // Not a standup thread
      }

      // Check if standup is still active
      if (!standup.isActive()) {
        return;
      }

      // Check if user is expected to participate
      if (!standup.expectedParticipants.includes(user)) {
        return;
      }

      // Get user info for better display
      const userInfo = await slackService.getUserInfo(user);
      
      // Check if user already responded
      const existingResponse = await Response.findByStandupAndUser(standup._id, user);
      
      if (existingResponse) {
        // Update existing response
        existingResponse.parseRawMessage(text, standup.questions);
        existingResponse.messageTs = ts;
        existingResponse.markAsEdited();
        await existingResponse.save();

        // React to show update received
        await client.reactions.add({
          channel: channel,
          timestamp: ts,
          name: 'pencil2' // Edit emoji
        });

      } else {
        // Create new response
        const responseData = {
          standupId: standup._id,
          teamId: team,
          channelId: channel,
          userId: user,
          username: userInfo.name,
          userDisplayName: userInfo.profile?.display_name || userInfo.real_name || userInfo.name,
          messageTs: ts,
          threadTs: thread_ts,
          submittedAt: new Date()
        };

        const response = await Response.create(responseData);
        response.parseRawMessage(text, standup.questions);
        response.calculateResponseTime(standup.startedAt);
        await response.save();

        // Update standup participant list
        standup.addParticipant(user);
        await standup.save();

        // React to show response received
        await client.reactions.add({
          channel: channel,
          timestamp: ts,
          name: 'white_check_mark'
        });
      }

      console.log(`Standup response ${existingResponse ? 'updated' : 'received'} from ${userInfo.name}`);

      const freshStandup = await Standup.findById(standup._id);
      if (freshStandup && freshStandup.hasAllResponses()) {
        console.log(`🎯 All responses received for standup ${standup._id}, clearing future reminders`);
        
        // Clear future reminders
        freshStandup.setNextReminder(null);
        await freshStandup.save();
        
        console.log(`✅ Future reminders cleared for standup ${standup._id}`);
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