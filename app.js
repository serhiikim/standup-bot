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

// Process-level error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit, just log
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log
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

// Application startup
async function startApp() {
  try {
    // Connect to database
    await database.connect();
    
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
    
    // Log successful Socket Mode connection
    console.log('✅ Slack Socket Mode connection established');
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    // In production, don't exit - try to recover
    if (process.env.NODE_ENV === 'production') {
      console.log('🔄 Attempting to restart in 10 seconds...');
      setTimeout(() => {
        startApp();
      }, 10000);
    } else {
      process.exit(1);
    }
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    console.log('🛑 Shutting down gracefully...');
    scheduler.stop();
    await app.stop();
    await database.close();
    console.log('✅ Application stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, shutting down...');
  
  try {
    scheduler.stop();
    await app.stop();
    await database.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the application
startApp();