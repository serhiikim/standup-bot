/**
 * Check if a channel is a Direct Message
 * @param {string} channelId - Slack channel ID
 * @returns {boolean} - True if DM channel
 */
function isDMChannel(channelId) {
    return channelId.startsWith('D'); // DM channels start with 'D'
  }
  
  /**
   * Get user's pending standup responses across all channels
   * @param {string} teamId - Slack team ID
   * @param {string} userId - User ID
   * @returns {Array} - Array of active standups where user hasn't responded
   */
  async function getUserPendingStandups(teamId, userId) {
    try {
      const Standup = require('../models/Standup');
      const Response = require('../models/Response');
      
      // Find active standups where user is expected to participate
      const activeStandups = await Standup.getCollection().find({
        teamId: teamId,
        status: { $in: ['active', 'collecting'] },
        expectedParticipants: userId
      }).toArray();
  
      const pendingStandups = [];
      
      for (const standupData of activeStandups) {
        const standup = new (require('../models/Standup'))(standupData);
        
        // Check if user has already responded
        const existingResponse = await Response.findByStandupAndUser(standup._id, userId);
        
        if (!existingResponse || !existingResponse.isComplete) {
          pendingStandups.push(standup);
        }
      }
      
      return pendingStandups;
    } catch (error) {
      console.error('Error getting user pending standups:', error);
      return [];
    }
  }
  
  module.exports = {
    isDMChannel,
    getUserPendingStandups
  };