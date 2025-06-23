const { ObjectId } = require('mongodb');
const database = require('../config/database');
const { STANDUP_STATUS } = require('../utils/constants');

class Standup {
  constructor(data) {
    this._id = data._id || new ObjectId();
    this.teamId = data.teamId; // Slack Team ID
    this.channelId = data.channelId; // Slack Channel ID
    this.messageTs = data.messageTs; // Slack message timestamp (thread parent)
    this.threadTs = data.threadTs; // Thread timestamp for responses
    
    // Standup metadata
    this.questions = data.questions || [];
    this.expectedParticipants = data.expectedParticipants || []; // Array of user IDs
    this.actualParticipants = data.actualParticipants || []; // Users who responded
    
    // Timing
    this.scheduledDate = data.scheduledDate; // When it was supposed to start
    this.startedAt = data.startedAt || new Date();
    this.responseDeadline = data.responseDeadline; // When responses should stop
    this.completedAt = data.completedAt || null;
    
    // Status and control
    this.status = data.status || STANDUP_STATUS.ACTIVE;
    this.createdBy = data.createdBy; // User ID who started (manual) or 'system' (scheduled)
    this.isManual = data.isManual || false; // Manual vs scheduled
    
    // Results
    this.summary = data.summary || null; // AI-generated summary
    this.summaryMessageTs = data.summaryMessageTs || null; // Timestamp of summary message
    
    // Statistics
    this.stats = data.stats || {
      totalExpected: 0,
      totalResponded: 0,
      responseRate: 0,
      avgResponseTime: 0,
      remindersSent: 0
    };
    
    // Reminders
    this.reminders = data.reminders || {
      sent: [],
      nextReminderAt: null
    };
    
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Static methods for database operations
  static getCollection() {
    return database.getDb().collection('standups');
  }

  static async create(standupData) {
    const standup = new Standup(standupData);
    standup.updatedAt = new Date();
    
    // Calculate initial stats
    standup.stats.totalExpected = standup.expectedParticipants.length;
    
    const result = await this.getCollection().insertOne(standup);
    standup._id = result.insertedId;
    return standup;
  }

  static async findById(id) {
    const data = await this.getCollection().findOne({ _id: new ObjectId(id) });
    return data ? new Standup(data) : null;
  }

  static async findByMessageTs(teamId, messageTs) {
    const data = await this.getCollection().findOne({ teamId, messageTs });
    return data ? new Standup(data) : null;
  }

  static async findByThreadTs(teamId, threadTs) {
    const data = await this.getCollection().findOne({ teamId, threadTs });
    return data ? new Standup(data) : null;
  }

  static async findActiveByChannel(teamId, channelId) {
    const cursor = this.getCollection().find({
      teamId,
      channelId,
      status: { $in: [STANDUP_STATUS.ACTIVE, STANDUP_STATUS.COLLECTING] }
    });
    const standups = await cursor.toArray();
    return standups.map(data => new Standup(data));
  }

  static async findByChannel(teamId, channelId, limit = 10) {
    const cursor = this.getCollection()
      .find({ teamId, channelId })
      .sort({ createdAt: -1 })
      .limit(limit);
    const standups = await cursor.toArray();
    return standups.map(data => new Standup(data));
  }

  static async findByStatus(status) {
    const cursor = this.getCollection().find({ status });
    const standups = await cursor.toArray();
    return standups.map(data => new Standup(data));
  }

  static async findExpired() {
    const now = new Date();
    const cursor = this.getCollection().find({
      status: { $in: [STANDUP_STATUS.ACTIVE, STANDUP_STATUS.COLLECTING] },
      responseDeadline: { $lt: now }
    });
    const standups = await cursor.toArray();
    return standups.map(data => new Standup(data));
  }

  static async findNeedingReminders() {
    const now = new Date();
    const cursor = this.getCollection().find({
      status: { $in: [STANDUP_STATUS.ACTIVE, STANDUP_STATUS.COLLECTING] },
      'reminders.nextReminderAt': { $lte: now }
    });
    const standups = await cursor.toArray();
    return standups.map(data => new Standup(data));
  }

  // Instance methods
  async save() {
    this.updatedAt = new Date();
    
    if (this._id && await Standup.getCollection().findOne({ _id: this._id })) {
      // Update existing
      const { _id, ...updateData } = this;
      await Standup.getCollection().updateOne(
        { _id: this._id },
        { $set: updateData }
      );
    } else {
      // Create new
      const result = await Standup.getCollection().insertOne(this);
      this._id = result.insertedId;
    }
    
    return this;
  }

  async delete() {
    if (this._id) {
      const result = await Standup.getCollection().deleteOne({ _id: this._id });
      return result.deletedCount > 0;
    }
    return false;
  }

  // Status management
  updateStatus(newStatus) {
    this.status = newStatus;
    this.updatedAt = new Date();
    
    if (newStatus === STANDUP_STATUS.COMPLETED) {
      this.completedAt = new Date();
    }
  }

  // Participant management
  addParticipant(userId) {
    if (!this.actualParticipants.includes(userId)) {
      this.actualParticipants.push(userId);
      this.updateStats();
    }
  }

  removeParticipant(userId) {
    const index = this.actualParticipants.indexOf(userId);
    if (index > -1) {
      this.actualParticipants.splice(index, 1);
      this.updateStats();
    }
  }

  clearReminders() {
    this.reminders.nextReminderAt = null;
    this.updatedAt = new Date();
    console.log(`🔕 Cleared reminders for standup ${this._id}`);
  }

  // Enhanced reminder management
  hasScheduledReminder() {
    return this.reminders.nextReminderAt && new Date() < this.reminders.nextReminderAt;
  }

  // Get time until next reminder
  getTimeUntilNextReminder() {
    if (!this.reminders.nextReminderAt) {
      return null;
    }
    return this.reminders.nextReminderAt - new Date();
  }

  // Statistics
  updateStats() {
    this.stats.totalResponded = this.actualParticipants.length;
    this.stats.responseRate = this.stats.totalExpected > 0 
      ? (this.stats.totalResponded / this.stats.totalExpected) * 100 
      : 0;
    this.updatedAt = new Date();
  }

  // Reminder management
  addReminder(reminderType, sentAt = new Date()) {
    this.reminders.sent.push({
      type: reminderType,
      sentAt: sentAt
    });
    this.stats.remindersSent += 1;
    this.updatedAt = new Date();
  }

  setNextReminder(nextReminderTime) {
    this.reminders.nextReminderAt = nextReminderTime;
    this.updatedAt = new Date();
  }

  // Helper methods
  isActive() {
    return [STANDUP_STATUS.ACTIVE, STANDUP_STATUS.COLLECTING].includes(this.status);
  }

  isExpired() {
    return this.responseDeadline && new Date() > this.responseDeadline;
  }

  isCompleted() {
    return this.status === STANDUP_STATUS.COMPLETED;
  }

  needsReminder() {
    if (!this.isActive()) return false;
    if (!this.reminders.nextReminderAt) return false;
    return new Date() >= this.reminders.nextReminderAt;
  }

  hasAllResponses() {
    return this.stats.totalResponded >= this.stats.totalExpected;
  }

  canComplete() {
    return this.isActive() && (this.hasAllResponses() || this.isExpired());
  }

  getResponseRate() {
    return Math.round(this.stats.responseRate);
  }

  getMissingParticipants() {
    return this.expectedParticipants.filter(
      userId => !this.actualParticipants.includes(userId)
    );
  }

  getDuration() {
    const end = this.completedAt || new Date();
    return end - this.startedAt;
  }

  toJSON() {
    return {
      _id: this._id,
      teamId: this.teamId,
      channelId: this.channelId,
      messageTs: this.messageTs,
      threadTs: this.threadTs,
      questions: this.questions,
      expectedParticipants: this.expectedParticipants,
      actualParticipants: this.actualParticipants,
      scheduledDate: this.scheduledDate,
      startedAt: this.startedAt,
      responseDeadline: this.responseDeadline,
      completedAt: this.completedAt,
      status: this.status,
      createdBy: this.createdBy,
      isManual: this.isManual,
      summary: this.summary,
      summaryMessageTs: this.summaryMessageTs,
      stats: this.stats,
      reminders: this.reminders,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
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
    
    if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      errors.push('At least one question is required');
    }
    
    if (!data.expectedParticipants || !Array.isArray(data.expectedParticipants)) {
      errors.push('expectedParticipants must be an array');
    }
    
    if (!data.responseDeadline || !(data.responseDeadline instanceof Date)) {
      errors.push('responseDeadline must be a valid Date');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = Standup;