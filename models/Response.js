const { ObjectId } = require('mongodb');
const database = require('../config/database');

class Response {
  constructor(data) {
    this._id = data._id || new ObjectId();
    this.standupId = data.standupId; // Reference to Standup
    this.teamId = data.teamId; // Slack Team ID
    this.channelId = data.channelId; // Slack Channel ID
    this.userId = data.userId; // Slack User ID
    this.username = data.username; // Slack username for easier display
    this.userDisplayName = data.userDisplayName; // User's display name
    
    // Response content
    this.responses = data.responses || []; // Array of answers corresponding to questions
    this.rawMessage = data.rawMessage || ''; // Original message text
    this.messageTs = data.messageTs; // Timestamp of response message
    this.threadTs = data.threadTs; // Thread timestamp
    
    // Response metadata
    this.isComplete = data.isComplete || false; // Has answered all questions
    this.isEdited = data.isEdited || false; // Was the response edited
    this.editCount = data.editCount || 0; // Number of times edited
    
    // Timing
    this.submittedAt = data.submittedAt || new Date();
    this.lastEditedAt = data.lastEditedAt || null;
    this.responseTime = data.responseTime || null; // Time taken to respond (ms from standup start)
    

    
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Static methods for database operations
  static getCollection() {
    return database.getDb().collection('responses');
  }

  static async create(responseData) {
    const response = new Response(responseData);
    response.updatedAt = new Date();
    
    const result = await this.getCollection().insertOne(response);
    response._id = result.insertedId;
    return response;
  }

  static async findById(id) {
    const data = await this.getCollection().findOne({ _id: new ObjectId(id) });
    return data ? new Response(data) : null;
  }

  static async findByStandupId(standupId) {
    const cursor = this.getCollection().find({ 
      standupId: standupId instanceof ObjectId ? standupId : new ObjectId(standupId)
    });
    const responses = await cursor.toArray();
    return responses.map(data => new Response(data));
  }

  static async findByStandupAndUser(standupId, userId) {
    const data = await this.getCollection().findOne({ 
      standupId: standupId instanceof ObjectId ? standupId : new ObjectId(standupId),
      userId 
    });
    return data ? new Response(data) : null;
  }

  static async findByUser(teamId, userId, limit = 10) {
    const cursor = this.getCollection()
      .find({ teamId, userId })
      .sort({ submittedAt: -1 })
      .limit(limit);
    const responses = await cursor.toArray();
    return responses.map(data => new Response(data));
  }

  static async findByChannel(teamId, channelId, limit = 50) {
    const cursor = this.getCollection()
      .find({ teamId, channelId })
      .sort({ submittedAt: -1 })
      .limit(limit);
    const responses = await cursor.toArray();
    return responses.map(data => new Response(data));
  }

  static async findIncomplete(standupId) {
    const cursor = this.getCollection().find({ 
      standupId: standupId instanceof ObjectId ? standupId : new ObjectId(standupId),
      isComplete: false 
    });
    const responses = await cursor.toArray();
    return responses.map(data => new Response(data));
  }

  static async updateByStandupAndUser(standupId, userId, updateData) {
    updateData.updatedAt = new Date();
    
    const result = await this.getCollection().updateOne(
      { 
        standupId: standupId instanceof ObjectId ? standupId : new ObjectId(standupId),
        userId 
      },
      { $set: updateData }
    );
    
    return result.modifiedCount > 0;
  }

  static async deleteByStandupId(standupId) {
    const result = await this.getCollection().deleteMany({ 
      standupId: standupId instanceof ObjectId ? standupId : new ObjectId(standupId)
    });
    return result.deletedCount;
  }

  // Instance methods
  async save() {
    this.updatedAt = new Date();
    
    if (this._id && await Response.getCollection().findOne({ _id: this._id })) {
      // Update existing
      const { _id, ...updateData } = this;
      await Response.getCollection().updateOne(
        { _id: this._id },
        { $set: updateData }
      );
    } else {
      // Create new
      const result = await Response.getCollection().insertOne(this);
      this._id = result.insertedId;
    }
    
    return this;
  }

  async delete() {
    if (this._id) {
      const result = await Response.getCollection().deleteOne({ _id: this._id });
      return result.deletedCount > 0;
    }
    return false;
  }

  // Response management
  updateResponse(questionIndex, answer) {
    // Ensure responses array is large enough
    while (this.responses.length <= questionIndex) {
      this.responses.push('');
    }
    
    this.responses[questionIndex] = answer;
    this.checkCompletion();
    this.updatedAt = new Date();
  }

  updateResponses(answers) {
    this.responses = [...answers];
    this.checkCompletion();
    this.updatedAt = new Date();
  }

  parseRawMessage(message, questions) {
    // Simple parsing logic - can be enhanced
    this.rawMessage = message;
    const lines = message.split('\n').filter(line => line.trim());
    
    // Try to match responses to questions
    const newResponses = [];
    for (let i = 0; i < questions.length; i++) {
      newResponses.push(lines[i] || '');
    }
    
    this.responses = newResponses;
    this.checkCompletion();
    this.updatedAt = new Date();
  }

  checkCompletion() {
    // Consider complete if all responses have content
    this.isComplete = this.responses.every(response => 
      response && response.trim().length > 0
    );
  }

  markAsEdited() {
    this.isEdited = true;
    this.editCount += 1;
    this.lastEditedAt = new Date();
    this.updatedAt = new Date();
  }

  calculateResponseTime(standupStartTime) {
    if (standupStartTime && this.submittedAt) {
      this.responseTime = this.submittedAt - standupStartTime;
    }
  }




  // Helper methods
  getFormattedResponse(questions) {
    const formatted = [];
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const answer = this.responses[i] || 'No response';
      formatted.push(`**${question}**\n${answer}`);
    }
    return formatted.join('\n\n');
  }

  getResponseSummary() {
    return {
      userId: this.userId,
      username: this.username,
      displayName: this.userDisplayName,
      isComplete: this.isComplete,
      submittedAt: this.submittedAt,
      responseTime: this.responseTime,
    };
  }

  toJSON() {
    return {
      _id: this._id,
      standupId: this.standupId,
      teamId: this.teamId,
      channelId: this.channelId,
      userId: this.userId,
      username: this.username,
      userDisplayName: this.userDisplayName,
      responses: this.responses,
      rawMessage: this.rawMessage,
      messageTs: this.messageTs,
      threadTs: this.threadTs,
      isComplete: this.isComplete,
      isEdited: this.isEdited,
      editCount: this.editCount,
      submittedAt: this.submittedAt,
      lastEditedAt: this.lastEditedAt,
      responseTime: this.responseTime,
      analysis: this.analysis,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Validation methods
  static validate(data) {
    const errors = [];
    
    if (!data.standupId) {
      errors.push('standupId is required');
    }
    
    if (!data.teamId) {
      errors.push('teamId is required');
    }
    
    if (!data.channelId) {
      errors.push('channelId is required');
    }
    
    if (!data.userId) {
      errors.push('userId is required');
    }
    
    if (!data.responses || !Array.isArray(data.responses)) {
      errors.push('responses must be an array');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Static utility methods
  static async getStandupStatistics(standupId) {
    const responses = await this.findByStandupId(standupId);
    
    const stats = {
      total: responses.length,
      complete: responses.filter(r => r.isComplete).length,
      incomplete: responses.filter(r => !r.isComplete).length,
      avgResponseTime: 0,
    };
    
    // Calculate average response time
    const responseTimes = responses
      .filter(r => r.responseTime)
      .map(r => r.responseTime);
    
    if (responseTimes.length > 0) {
      stats.avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    }
    
    return stats;
  }
}

module.exports = Response;