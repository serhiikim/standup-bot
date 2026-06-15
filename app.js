require('dotenv').config();
const { App } = require('@slack/bolt');
const database = require('./config/database');
const scheduler = require('./jobs/scheduler');

// Import handlers
const commandHandlers = require('./handlers/commands');
const actionHandlers = require('./handlers/actions');
const viewHandlers = require('./handlers/views');
const eventHandlers = require('./handlers/events');

// Initialize Slack Bolt App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: process.env.SLACK_APP_TOKEN ? true : false,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Enhanced error handling for Socket Mode stability
app.error(async (error) => {
  console.error('❌ Slack app error:', error);
  
  // Don't crash on Socket Mode disconnects
  if (error.message?.includes('socket-mode') || 
      error.message?.includes('disconnect') ||
      error.message?.includes('server explicit disconnect')) {
    console.log('🔄 Socket Mode connection issue - will reconnect automatically');
    return;
  }
  
  // Log other errors but don't crash
  console.error('Full error:', error);
});

// Process-level error handling — exit and let Docker restart cleanly
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Initialize handlers
function initializeHandlers() {
  // Register command handlers
  commandHandlers.register(app);
  
  // Register action handlers  
  actionHandlers.register(app);
  
  // Register view handlers
  viewHandlers.register(app);
  
  // Register event handlers
  eventHandlers.register(app);
  
  console.log('✅ All Slack handlers registered');
}

/**
 * Automatically update any active standup reminders on startup to align with 
 * the new Deadline - 3 Hours schedule.
 */
async function updateActiveStandupReminders() {
  try {
    const Standup = require('./models/Standup');
    const { STANDUP_STATUS } = require('./utils/constants');
    
    const activeStandups = await Standup.getCollection().find({
      status: { $in: [STANDUP_STATUS.ACTIVE, STANDUP_STATUS.COLLECTING] }
    }).toArray();
      
    if (activeStandups.length === 0) {
      return;
    }
    
    console.log(`🔍 Startup: Found ${activeStandups.length} active standup(s) to align with new reminder schedule`);
    
    for (const data of activeStandups) {
      const standup = new Standup(data);
      if (standup.responseDeadline) {
        const threeHoursBeforeDeadline = new Date(standup.responseDeadline.getTime() - 3 * 60 * 60 * 1000);
        const twoHoursBeforeDeadline = new Date(standup.responseDeadline.getTime() - 2 * 60 * 60 * 1000);
        const oneHourBeforeDeadline = new Date(standup.responseDeadline.getTime() - 1 * 60 * 60 * 1000);
        
        if (threeHoursBeforeDeadline > new Date()) {
          // Case 1: 3 hours before deadline is still in the future
          standup.setNextReminder(threeHoursBeforeDeadline);
          await standup.save();
          console.log(`✅ Startup: Standup ${standup._id} next reminder set to 3h before deadline (${threeHoursBeforeDeadline.toISOString()})`);
        } else if (twoHoursBeforeDeadline > new Date()) {
          // Case 2: 3 hours passed, check 2 hours before deadline
          standup.setNextReminder(twoHoursBeforeDeadline);
          await standup.save();
          console.log(`✅ Startup: Standup ${standup._id} next reminder set to 2h before deadline (${twoHoursBeforeDeadline.toISOString()})`);
        } else if (oneHourBeforeDeadline > new Date()) {
          // Case 3: 2 hours passed, check 1 hour before deadline
          standup.setNextReminder(oneHourBeforeDeadline);
          await standup.save();
          console.log(`✅ Startup: Standup ${standup._id} next reminder set to 1h before deadline (${oneHourBeforeDeadline.toISOString()})`);
        } else {
          // Case 4: Already less than 1 hour before deadline, clear reminders
          standup.clearReminders();
          await standup.save();
          console.log(`🔕 Startup: Cleared reminders for standup ${standup._id} (deadline is very close/passed)`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Startup: Error aligning active standup reminders:', error);
  }
}

// Application startup
async function startApp() {
  try {
    // Connect to database
    await database.connect();
    
    // Automatically update any active standups to new reminder schedule
    await updateActiveStandupReminders();
    
    // Initialize all handlers
    initializeHandlers();
    
    // Initialize scheduler with app instance
    scheduler.setApp(app);
    scheduler.start();
    
    // Start the Slack app
    await app.start();
    
    console.log('🚀 Slack Standup Bot is running!');
    console.log(`📱 Mode: ${process.env.SLACK_APP_TOKEN ? 'Socket Mode' : 'HTTP Mode'}`);
    console.log(`🌐 Port: ${process.env.PORT || 3000} (internal only)`);
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  try {
    scheduler.stop();
    await app.stop();
    await database.close();
    console.log('✅ Application stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the application
startApp();