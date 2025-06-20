const SlackService = require('../services/slackService');
const StandupService = require('../services/standupService');
const { BLOCK_IDS } = require('../utils/constants');

let slackService;
let standupService;

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);

  // Handle interactive elements in setup modal
  // These are mostly for dynamic updates if needed

  // Time selection handler
  app.action(BLOCK_IDS.TIME_SELECT, async ({ ack, body, action }) => {
    await ack();
    // Could implement dynamic updates here if needed
    console.log('Time selected:', action.selected_option.value);
  });

  // Days selection handler
  app.action(BLOCK_IDS.DAYS_SELECT, async ({ ack, body, action }) => {
    await ack();
    // Could implement dynamic updates here if needed
    console.log('Days selected:', action.selected_options);
  });

  // Timezone selection handler
  app.action(BLOCK_IDS.TIMEZONE_SELECT, async ({ ack, body, action }) => {
    await ack();
    // Could implement dynamic updates here if needed
    console.log('Timezone selected:', action.selected_option.value);
  });

  // Participants selection handler
  app.action(BLOCK_IDS.PARTICIPANTS_SELECT, async ({ ack, body, action }) => {
    await ack();
    // Could implement dynamic updates here if needed
    console.log('Participants selected:', action.selected_users);
  });

  // Questions input handler (for any dynamic validation)
  app.action(BLOCK_IDS.QUESTIONS_INPUT, async ({ ack, body, action }) => {
    await ack();
    // Could implement real-time validation here if needed
  });

  // Generic button handlers for future use
  app.action(BLOCK_IDS.START_BUTTON, async ({ ack, body, action, respond }) => {
    await ack();
    
    try {
      // Handle manual standup start button
      // This will be implemented when we add the standup service
      await respond({
        text: '🚀 Starting standup... (Feature coming soon!)',
        response_type: 'ephemeral',
        replace_original: false
      });
    } catch (error) {
      console.error('Error handling start button:', error);
      await respond({
        text: '❌ Failed to start standup.',
        response_type: 'ephemeral'
      });
    }
  });

  app.action(BLOCK_IDS.CANCEL_BUTTON, async ({ ack, body, action, respond }) => {
    await ack();
    
    try {
      const standupId = action.value;
      const userId = body.user.id;
      
      // Cancel the standup using standupService
      const success = await standupService.cancelStandup(standupId, userId, 'Cancelled by user');
      
      if (success) {
        await respond({
          text: '✅ Standup cancelled successfully.',
          response_type: 'ephemeral',
          replace_original: false
        });
      } else {
        await respond({
          text: '❌ Failed to cancel standup or standup already completed.',
          response_type: 'ephemeral'
        });
      }
    } catch (error) {
      console.error('Error handling cancel button:', error);
      await respond({
        text: '❌ Failed to cancel standup.',
        response_type: 'ephemeral'
      });
    }
  });

  app.action(BLOCK_IDS.SUBMIT_RESPONSE, async ({ ack, body, action, respond }) => {
    await ack();
    
    try {
      const standupId = action.value;
      const userId = body.user.id;
      
      // Complete the standup using standupService
      const success = await standupService.completeStandup(standupId, 'manual_complete');
      
      if (success) {
        await respond({
          text: '✅ Standup completed successfully! Check the thread for summary.',
          response_type: 'ephemeral',
          replace_original: false
        });
      } else {
        await respond({
          text: '❌ Failed to complete standup or standup already completed.',
          response_type: 'ephemeral'
        });
      }
    } catch (error) {
      console.error('Error handling complete button:', error);
      await respond({
        text: '❌ Failed to complete standup.',
        response_type: 'ephemeral'
      });
    }
  });

  console.log('✅ Action handlers registered');
}

module.exports = { register };