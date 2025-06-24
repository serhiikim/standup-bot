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
    const Standup = require('../models/Standup');
    const Response = require('../models/Response');
    
    // Find active standups where user is expected to participate
    let activeStandups;
    try {
      activeStandups = await Standup.getCollection().find({
        teamId: teamId,
        status: { $in: ['active', 'collecting'] },
        expectedParticipants: userId
      }).toArray();
    } catch (error) {
      console.error('Database error fetching active standups:', error);
      throw new Error('Failed to fetch active standups');
    }
  
    const pendingStandups = [];
    for (const standup of activeStandups) {
      let existingResponse;
      try {
        existingResponse = await Response.findByStandupAndUser(standup._id, userId);
      } catch (error) {
        console.error('Database error fetching response:', error);
        throw new Error('Failed to fetch user response');
      }
      if (!existingResponse || !existingResponse.isComplete) {
        pendingStandups.push(standup); // Use plain data, no need to instantiate Standup
      }
    }
    return pendingStandups;
  }
  
  module.exports = {
    isDMChannel,
    getUserPendingStandups
  };