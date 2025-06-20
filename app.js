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

// Global error handling
app.error(async (error) => {
  console.error('❌ Slack app error:', error);
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
    scheduler.app = app;
    scheduler.start();
    
    // Start the Slack app
    await app.start();
    
    console.log('🚀 Slack Standup Bot is running!');
    console.log(`📱 Mode: ${process.env.SLACK_APP_TOKEN ? 'Socket Mode' : 'HTTP Mode'}`);
    console.log(`🌐 Port: ${process.env.PORT || 3000}`);
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
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