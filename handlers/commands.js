const setupCommands = require('./commands/setupCommands');
const operationCommands = require('./commands/operationCommands');
const statusCommands = require('./commands/statusCommands');
const adminCommands = require('./commands/adminCommands');

function register(app) {
  // Register all command groups
  setupCommands.register(app);
  operationCommands.register(app);
  statusCommands.register(app);
  adminCommands.register(app);

  console.log('✅ All command handlers registered');
}

module.exports = { register };