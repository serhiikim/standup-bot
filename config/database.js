const { MongoClient } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
  }

  async connect() {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/slack-standup-bot';
      
      this.client = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      await this.client.connect();
      
      // Extract database name from URI or use default
      const dbName = uri.split('/').pop().split('?')[0] || 'slack-standup-bot';
      this.db = this.client.db(dbName);

      console.log('✅ Connected to MongoDB successfully');
      
      // Create indexes for better performance
      await this.createIndexes();
      
      return this.db;
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      // Teams collection indexes
      await this.db.collection('teams').createIndex({ teamId: 1 }, { unique: true });
      
      // Channels collection indexes
      await this.db.collection('channels').createIndex({ teamId: 1, channelId: 1 }, { unique: true });
      await this.db.collection('channels').createIndex({ teamId: 1 });
      
      // Standups collection indexes
      await this.db.collection('standups').createIndex({ teamId: 1, channelId: 1 });
      await this.db.collection('standups').createIndex({ status: 1 });
      await this.db.collection('standups').createIndex({ scheduledDate: 1 });
      
      // Responses collection indexes
      await this.db.collection('responses').createIndex({ standupId: 1 });
      await this.db.collection('responses').createIndex({ userId: 1, standupId: 1 }, { unique: true });
      
      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('❌ Error creating indexes:', error);
      // Don't throw here, as duplicate key errors are expected on subsequent runs
    }
  }

  getDb() {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      console.log('✅ MongoDB connection closed');
    }
  }

  // Health check method
  async ping() {
    try {
      await this.db.admin().ping();
      return true;
    } catch (error) {
      console.error('❌ Database ping failed:', error);
      return false;
    }
  }
}

// Singleton instance
const database = new Database();

module.exports = database;