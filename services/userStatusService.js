const SlackService = require('./slackService');

class UserStatusService {
  constructor(app) {
    this.app = app;
    this.slackService = new SlackService(app);
  }

  /**
   * Check if user is currently out of office
   * @param {string} userId - Slack user ID
   * @returns {Promise<{isOOO: boolean, status: object}>}
   */
  async checkUserStatus(userId) {
    try {
      const userInfo = await this.slackService.getUserInfo(userId);
      
      if (!userInfo || !userInfo.profile) {
        return { isOOO: false, status: null };
      }

      const profile = userInfo.profile;
      const status = {
        text: profile.status_text || '',
        emoji: profile.status_emoji || '',
        expiration: profile.status_expiration || 0
      };

      // Check if status indicates out of office
      const isOOO = this.isOutOfOfficeStatus(status, userInfo);

      return {
        isOOO,
        status,
        user: {
          id: userId,
          name: userInfo.name,
          displayName: userInfo.profile.display_name || userInfo.real_name || userInfo.name
        }
      };

    } catch (error) {
      console.error(`Error checking status for user ${userId}:`, error);
      return { isOOO: false, status: null };
    }
  }

  /**
   * Check multiple users' statuses
   * @param {string[]} userIds - Array of user IDs
   * @returns {Promise<{available: string[], ooo: object[]}>}
   */
  async checkMultipleUserStatuses(userIds) {
    const results = {
      available: [],
      ooo: [],
      total: userIds.length
    };

    console.log(`🔍 Checking status for ${userIds.length} users...`);

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const batchPromises = batch.map(userId => this.checkUserStatus(userId));
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          const userId = batch[index];
          
          if (result.status === 'fulfilled') {
            const { isOOO, status, user } = result.value;
            
            if (isOOO) {
              results.ooo.push({
                userId,
                user,
                status,
                reason: this.getOOOReasonText(status)
              });
              console.log(`📴 User ${user?.displayName || userId} is OOO: ${status.text}`);
            } else {
              results.available.push(userId);
            }
          } else {
            // If we can't determine status, assume available
            results.available.push(userId);
            console.warn(`⚠️ Could not check status for user ${userId}, assuming available`);
          }
        });
      } catch (error) {
        console.error('Error in batch status check:', error);
        // Add failed batch to available (safer default)
        results.available.push(...batch);
      }
    }

    console.log(`✅ Status check complete: ${results.available.length} available, ${results.ooo.length} OOO`);
    
    return results;
  }

  /**
   * Determine if a status indicates out of office
   * @param {object} status - User status object
   * @param {object} userInfo - Full user info
   * @returns {boolean}
   */
  isOutOfOfficeStatus(status, userInfo) {
    // Check if user is deleted/deactivated
    if (userInfo.deleted || !userInfo.profile) {
      return true;
    }

    // Check status expiration (0 means no expiration, > 0 means expires at timestamp)
    if (status.expiration > 0 && status.expiration < Date.now() / 1000) {
      return false; // Status expired, user is back
    }

    const statusText = (status.text || '').toLowerCase();
    const statusEmoji = status.emoji || '';

    // ✅ SIMPLIFIED: Only REAL absence, not temporary busy states
    const oooKeywords = [
      'vacation', 'holiday', 'out of office', 'ooo', 'pto', 'sick', 'sick leave',
      'leave', 'travelling', 'travel', 'pvt', 'personal', 'family emergency',
    ];

    // ✅ SIMPLIFIED: Only clear absence emojis
    const oooEmojis = [
      ':palm_tree:', ':airplane:', ':beach_with_umbrella:', ':island:',
      ':face_with_thermometer:', ':pill:', ':hospital:',
      ':zzz:', ':sleeping:'
    ];

    // Check text for OOO keywords
    const hasOOOKeyword = oooKeywords.some(keyword => 
      statusText.includes(keyword)
    );

    // Check emoji for OOO indicators
    const hasOOOEmoji = oooEmojis.some(emoji => 
      statusEmoji.includes(emoji)
    );

    return hasOOOKeyword || hasOOOEmoji;
  }

  /**
   * Get human-readable reason for OOO status
   * @param {object} status - Status object
   * @returns {string}
   */
  getOOOReasonText(status) {
    if (status.text) {
      return status.text;
    }
    
    if (status.emoji) {
      // ✅ SIMPLIFIED: Map only clear absence emojis
      const emojiMap = {
        ':palm_tree:': 'On vacation',
        ':airplane:': 'Traveling', 
        ':beach_with_umbrella:': 'On vacation',
        ':face_with_thermometer:': 'Sick leave',
        ':pill:': 'Sick leave',
        ':hospital:': 'Sick leave',
        ':sleeping:': 'Away',
        ':zzz:': 'Away'
      };
      
      return emojiMap[status.emoji] || 'Away';
    }
    
    return 'Out of office';
  }

  /**
   * Create OOO summary for standup notifications
   * @param {object[]} oooUsers - Array of OOO user objects
   * @returns {string}
   */
  createOOOSummary(oooUsers) {
    if (oooUsers.length === 0) {
      return '';
    }

    let summary = `📴 *Out of Office (${oooUsers.length}):*\n`;
    
    oooUsers.forEach(oooUser => {
      const userName = oooUser.user?.displayName || `<@${oooUser.userId}>`;
      const reason = oooUser.reason;
      summary += `• ${userName} - ${reason}\n`;
    });

    return summary;
  }

  /**
   * Check if entire team is OOO (for special handling)
   * @param {string[]} availableUsers - Available user IDs
   * @param {object[]} oooUsers - OOO user objects
   * @param {number} threshold - Percentage threshold (default 90%)
   * @returns {boolean}
   */
  isEntireTeamOOO(availableUsers, oooUsers, threshold = 0.9) {
    const totalUsers = availableUsers.length + oooUsers.length;
    
    if (totalUsers === 0) {
      return true; // No users = can't have standup
    }

    const oooPercentage = oooUsers.length / totalUsers;
    return oooPercentage >= threshold;
  }

  /**
   * Filter participants for standup based on their status
   * @param {string[]} userIds - Array of user IDs
   * @returns {Promise<{participants: string[], oooSummary: string, shouldSkipStandup: boolean}>}
   */
  async filterAvailableParticipants(userIds) {
    const statusResults = await this.checkMultipleUserStatuses(userIds);
    
    const shouldSkipStandup = this.isEntireTeamOOO(
      statusResults.available, 
      statusResults.ooo
    );
    
    const oooSummary = this.createOOOSummary(statusResults.ooo);
    
    return {
      participants: statusResults.available,
      oooUsers: statusResults.ooo,
      oooSummary,
      shouldSkipStandup,
      originalCount: userIds.length,
      availableCount: statusResults.available.length,
      oooCount: statusResults.ooo.length
    };
  }
}

module.exports = UserStatusService;