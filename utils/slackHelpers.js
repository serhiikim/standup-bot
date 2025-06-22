/**
 * Slack API helpers with proper Socket Mode error handling
 */

/**
 * Safely acknowledge a command with retry logic
 */
async function safeAck(ack, payload = undefined) {
    try {
      await ack(payload);
      return { success: true };
    } catch (error) {
      console.log('ACK failed:', error.code || error.message);
      
      // Socket Mode specific errors are expected
      if (error.code === 'slack_socket_mode_no_reply_received_error') {
        console.log('Socket Mode acknowledgment failed (expected) - continuing...');
      }
      
      return { success: false, error: error.code };
    }
  }
  
  /**
   * Safely respond to a command with fallback handling
   */
  async function safeRespond(respond, message) {
    try {
      return await respond(message);
    } catch (error) {
      console.error('Respond failed:', error.code || error.message);
      
      // For Socket Mode errors, we can't do much - the connection is broken
      if (error.code?.includes('socket_mode')) {
        console.log('Socket Mode response failed - user may not see response');
        return { success: false, socketModeError: true };
      }
      
      throw error; // Re-throw non-socket-mode errors
    }
  }
  
  /**
   * Execute a command with standardized error handling
   */
  async function executeCommand(commandName, { command, ack, respond }, handler) {
    // Always try to acknowledge first
    const ackResult = await safeAck(ack);
    
    try {
      // Execute the actual command logic
      const result = await handler(command, respond);
      
      if (!ackResult.success) {
        console.log(`Command ${commandName} executed successfully despite ACK failure`);
      }
      
      return result;
      
    } catch (error) {
      console.error(`Error in ${commandName} command:`, error);
      
      // Try to send error response
      try {
        return await safeRespond(respond, {
          text: `❌ Failed to execute ${commandName}. Please try again.`,
          response_type: 'ephemeral'
        });
      } catch (respondError) {
        console.error(`Failed to send error response for ${commandName}:`, respondError);
        // At this point, we've done all we can
      }
    }
  }
  
  /**
   * Wrapper for commands that need channel validation
   */
  async function executeChannelCommand(commandName, { command, ack, respond }, handler) {
    return executeCommand(commandName, { command, ack, respond }, async (cmd, resp) => {
      const { team_id, channel_id } = cmd;
      
      if (!team_id || !channel_id) {
        return await safeRespond(resp, {
          text: '❌ Invalid command context. Please try again.',
          response_type: 'ephemeral'
        });
      }
      
      return await handler(cmd, resp);
    });
  }
  
  /**
   * Check if error is a recoverable Socket Mode error
   */
  function isSocketModeError(error) {
    return error.code && (
      error.code.includes('socket_mode') ||
      error.code === 'slack_socket_mode_no_reply_received_error' ||
      error.code === 'not_ready'
    );
  }
  
  /**
   * Enhanced error logger for Slack operations
   */
  function logSlackError(operation, error, context = {}) {
    const errorInfo = {
      operation,
      error: error.message,
      code: error.code,
      isSocketMode: isSocketModeError(error),
      context
    };
    
    if (isSocketModeError(error)) {
      console.log(`Socket Mode issue in ${operation}:`, errorInfo);
    } else {
      console.error(`Slack error in ${operation}:`, errorInfo);
    }
  }
  
  module.exports = {
    safeAck,
    safeRespond,
    executeCommand,
    executeChannelCommand,
    isSocketModeError,
    logSlackError
  };