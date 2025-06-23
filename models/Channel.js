const { ObjectId } = require('mongodb');
const database = require('../config/database');
const { 
  DEFAULT_STANDUP_QUESTIONS, 
  DEFAULT_STANDUP_TIME, 
  DEFAULT_STANDUP_DAYS,
  DEFAULT_TIMEZONE,
  CHANNEL_STATUS 
} = require('../utils/constants');

class Channel {
  constructor(data) {
    this._id = data._id || new ObjectId();
    this.teamId = data.teamId; // Slack Team ID
    this.channelId = data.channelId; // Slack Channel ID
    this.channelName = data.channelName;
    this.configuredBy = data.configuredBy; // User ID who configured
    
    // Standup configuration
    this.config = data.config || {
      questions: [...DEFAULT_STANDUP_QUESTIONS],
      time: DEFAULT_STANDUP_TIME,
      days: [...DEFAULT_STANDUP_DAYS],
      timezone: DEFAULT_TIMEZONE,
      participants: [], // Array of user IDs, empty = all channel members
      responseTimeout: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
      enableReminders: true,
      reminderInterval: 60 * 60 * 1000, // 1 hour
      requireAllResponses: false,
      autoSummary: true
    };
    
    this.status = data.status || CHANNEL_STATUS.ACTIVE;
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    
    // Statistics
    this.stats = data.stats || {
      totalStandups: 0,
      lastStandupDate: null,
      avgResponseRate: 0,
      avgResponseTime: 0
    };
    
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.lastStandupAt = data.lastStandupAt || null;
  }

  // Static methods for database operations
  static getCollection() {
    return database.getDb().collection('channels');
  }

  static async create(channelData) {
    const channel = new Channel(channelData);
    channel.updatedAt = new Date();
    
    const result = await this.getCollection().insertOne(channel);
    channel._id = result.insertedId;
    return channel;
  }

  static async findByChannelId(teamId, channelId) {
    const data = await this.getCollection().findOne({ teamId, channelId });
    return data ? new Channel(data) : null;
  }

  static async findById(id) {
    const data = await this.getCollection().findOne({ _id: new ObjectId(id) });
    return data ? new Channel(data) : null;
  }

  static async findByTeamId(teamId) {
    const cursor = this.getCollection().find({ teamId });
    const channels = await cursor.toArray();
    return channels.map(data => new Channel(data));
  }

  static async findActiveByTeamId(teamId) {
    const cursor = this.getCollection().find({ 
      teamId, 
      isActive: true, 
      status: CHANNEL_STATUS.ACTIVE 
    });
    const channels = await cursor.toArray();
    return channels.map(data => new Channel(data));
  }

  static async updateByChannelId(teamId, channelId, updateData) {
    updateData.updatedAt = new Date();
    
    const result = await this.getCollection().updateOne(
      { teamId, channelId },
      { $set: updateData }
    );
    
    return result.modifiedCount > 0;
  }

  static async deleteByChannelId(teamId, channelId) {
    const result = await this.getCollection().deleteOne({ teamId, channelId });
    return result.deletedCount > 0;
  }

  static async findScheduledForToday(dayOfWeek, currentTime) {
    // Find channels that should have standup today
    const cursor = this.getCollection().find({
      isActive: true,
      status: CHANNEL_STATUS.ACTIVE,
      'config.days': dayOfWeek
    });
    
    const channels = await cursor.toArray();
    return channels
      .map(data => new Channel(data))
      .filter(channel => {
        // Check if it's time for standup (considering timezone)
        return channel.isTimeForStandup(currentTime);
      });
  }

  // Instance methods
  async save() {
    this.updatedAt = new Date();
    
    if (this._id && await Channel.getCollection().findOne({ _id: this._id })) {
      // Update existing
      const { _id, ...updateData } = this;
      await Channel.getCollection().updateOne(
        { _id: this._id },
        { $set: updateData }
      );
    } else {
      // Create new
      const result = await Channel.getCollection().insertOne(this);
      this._id = result.insertedId;
    }
    
    return this;
  }

  async delete() {
    if (this._id) {
      const result = await Channel.getCollection().deleteOne({ _id: this._id });
      return result.deletedCount > 0;
    }
    return false;
  }

  // Configuration methods
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.updatedAt = new Date();
  }

  updateStatus(newStatus) {
    this.status = newStatus;
    this.updatedAt = new Date();
  }

  // Statistics methods
  updateStats(statsUpdate) {
    this.stats = { ...this.stats, ...statsUpdate };
    this.updatedAt = new Date();
  }

  incrementStandupCount() {
    this.stats.totalStandups += 1;
    this.lastStandupAt = new Date();
    this.stats.lastStandupDate = this.lastStandupAt;
    this.updatedAt = new Date();
  }

  // Helper methods
  isTimeForStandup(currentTime) {
    try {
      const configTime = this.config.time.split(':');
      const configHour = parseInt(configTime[0]);
      const configMinute = parseInt(configTime[1]);
      
      
      const channelTimezone = this.config.timezone || 'UTC';
      const now = new Date(currentTime);
      
      const timeInChannelTZ = new Date(now.toLocaleString('en-US', {
        timeZone: channelTimezone
      }));
      
      const currentHour = timeInChannelTZ.getHours();
      const currentMinute = timeInChannelTZ.getMinutes();
      
      console.log(`🕐 Channel ${this.channelId} time check:`, {
        configTime: `${configHour}:${String(configMinute).padStart(2, '0')}`,
        timezone: channelTimezone,
        currentTimeUTC: now.toISOString(),
        currentTimeInTZ: timeInChannelTZ.toLocaleString(),
        currentHour,
        currentMinute,
        matches: currentHour === configHour && currentMinute === configMinute
      });
      
      return currentHour === configHour && currentMinute === configMinute;
      
    } catch (error) {
      console.error('Error in isTimeForStandup:', error);
      // Fallback to UTC if timezone conversion fails
      const configTime = this.config.time.split(':');
      const configHour = parseInt(configTime[0]);
      const configMinute = parseInt(configTime[1]);
      
      const now = new Date(currentTime);
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      return currentHour === configHour && currentMinute === configMinute;
    }
  }

  getParticipants() {
    return this.config.participants || [];
  }

  hasSpecificParticipants() {
    return this.config.participants && this.config.participants.length > 0;
  }

  isParticipant(userId) {
    if (!this.hasSpecificParticipants()) {
      return true; // If no specific participants, everyone in channel can participate
    }
    return this.config.participants.includes(userId);
  }

  toJSON() {
    return {
      _id: this._id,
      teamId: this.teamId,
      channelId: this.channelId,
      channelName: this.channelName,
      configuredBy: this.configuredBy,
      config: this.config,
      status: this.status,
      isActive: this.isActive,
      stats: this.stats,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastStandupAt: this.lastStandupAt
    };
  }

  // Validation methods
  static validate(data) {
    const errors = [];
    
    if (!data.teamId) {
      errors.push('teamId is required');
    }
    
    if (!data.channelId) {
      errors.push('channelId is required');
    }
    
    if (!data.channelName) {
      errors.push('channelName is required');
    }
    
    if (data.config) {
      if (data.config.questions && (!Array.isArray(data.config.questions) || data.config.questions.length === 0)) {
        errors.push('At least one question is required');
      }
      
      if (data.config.time && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.config.time)) {
        errors.push('Invalid time format. Use HH:MM format');
      }
      
      if (data.config.days && (!Array.isArray(data.config.days) || data.config.days.length === 0)) {
        errors.push('At least one day must be selected');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = Channel;