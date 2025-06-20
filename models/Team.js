const { ObjectId } = require('mongodb');
const database = require('../config/database');

class Team {
  constructor(data) {
    this._id = data._id || new ObjectId();
    this.teamId = data.teamId; // Slack Team ID
    this.teamName = data.teamName;
    this.teamDomain = data.teamDomain;
    this.installedBy = data.installedBy; // User ID who installed the app
    this.botUserId = data.botUserId; // Bot's user ID in this workspace
    this.accessToken = data.accessToken; // OAuth access token
    this.scope = data.scope || '';
    this.settings = data.settings || {
      defaultTimezone: 'UTC',
      allowUserTimezones: true,
      maxResponseTime: 3 * 60 * 60 * 1000, // 3 hours
      enableReminders: true,
      reminderInterval: 60 * 60 * 1000 // 1 hour
    };
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.lastActiveAt = data.lastActiveAt || new Date();
  }

  // Static methods for database operations
  static getCollection() {
    return database.getDb().collection('teams');
  }

  static async create(teamData) {
    const team = new Team(teamData);
    team.updatedAt = new Date();
    
    const result = await this.getCollection().insertOne(team);
    team._id = result.insertedId;
    return team;
  }

  static async findByTeamId(teamId) {
    const data = await this.getCollection().findOne({ teamId });
    return data ? new Team(data) : null;
  }

  static async findById(id) {
    const data = await this.getCollection().findOne({ _id: new ObjectId(id) });
    return data ? new Team(data) : null;
  }

  static async updateByTeamId(teamId, updateData) {
    updateData.updatedAt = new Date();
    
    const result = await this.getCollection().updateOne(
      { teamId },
      { $set: updateData }
    );
    
    return result.modifiedCount > 0;
  }

  static async deleteByTeamId(teamId) {
    const result = await this.getCollection().deleteOne({ teamId });
    return result.deletedCount > 0;
  }

  static async findAll(filter = {}) {
    const cursor = this.getCollection().find(filter);
    const teams = await cursor.toArray();
    return teams.map(data => new Team(data));
  }

  static async findActive() {
    return this.findAll({ isActive: true });
  }

  static async updateLastActive(teamId) {
    return this.updateByTeamId(teamId, { lastActiveAt: new Date() });
  }

  // Instance methods
  async save() {
    this.updatedAt = new Date();
    
    if (this._id && await Team.getCollection().findOne({ _id: this._id })) {
      // Update existing
      const { _id, ...updateData } = this;
      await Team.getCollection().updateOne(
        { _id: this._id },
        { $set: updateData }
      );
    } else {
      // Create new
      const result = await Team.getCollection().insertOne(this);
      this._id = result.insertedId;
    }
    
    return this;
  }

  async delete() {
    if (this._id) {
      const result = await Team.getCollection().deleteOne({ _id: this._id });
      return result.deletedCount > 0;
    }
    return false;
  }

  // Helper methods
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.updatedAt = new Date();
  }

  isValidToken() {
    return this.accessToken && this.accessToken.length > 0;
  }

  toJSON() {
    return {
      _id: this._id,
      teamId: this.teamId,
      teamName: this.teamName,
      teamDomain: this.teamDomain,
      installedBy: this.installedBy,
      botUserId: this.botUserId,
      scope: this.scope,
      settings: this.settings,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastActiveAt: this.lastActiveAt
    };
  }

  // Validation methods
  static validate(data) {
    const errors = [];
    
    if (!data.teamId) {
      errors.push('teamId is required');
    }
    
    if (!data.teamName) {
      errors.push('teamName is required');
    }
    
    if (!data.accessToken) {
      errors.push('accessToken is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = Team;