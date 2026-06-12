const crypto = require('crypto');

// Set useMongo based on env variable MONGODB_URI
const useMongo = !!process.env.MONGODB_URI;

class MockObjectId {
  constructor(id) {
    if (id) {
      if (id instanceof MockObjectId) {
        this.id = id.id;
      } else {
        this.id = String(id);
      }
    } else {
      this.id = crypto.randomBytes(12).toString('hex');
    }
  }

  toString() {
    return this.id;
  }

  toHexString() {
    return this.id;
  }

  toJSON() {
    return this.id;
  }

  equals(other) {
    if (!other) return false;
    return this.toString() === other.toString();
  }
}

const ObjectIdClass = useMongo ? require('mongodb').ObjectId : MockObjectId;

// Generate an ID (standard hex string if SQLite, MongoDB's ObjectId if Mongo)
function generateId() {
  if (useMongo) {
    return new ObjectIdClass();
  }
  return new MockObjectId();
}

function getValueByPath(doc, path) {
  if (!doc) return undefined;
  if (path === '_id') return doc._id ? String(doc._id) : undefined;

  const parts = path.split('.');
  let current = doc;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function setValueByPath(obj, path, val) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = val;
}

function matchQuery(doc, query) {
  for (const [key, value] of Object.entries(query)) {
    const docValue = getValueByPath(doc, key);

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp) && !(value instanceof ObjectIdClass)) {
      // Operator check (e.g. { status: { $in: [...] } })
      for (const [op, opVal] of Object.entries(value)) {
        if (op === '$in') {
          if (!Array.isArray(opVal)) return false;
          const docValStr = docValue ? String(docValue) : '';
          const match = opVal.some(val => String(val) === docValStr);
          if (!match) return false;
        } else if (op === '$lt') {
          const dVal = docValue instanceof Date ? docValue : new Date(docValue);
          const oVal = opVal instanceof Date ? opVal : new Date(opVal);
          if (!(dVal < oVal)) return false;
        } else if (op === '$lte') {
          const dVal = docValue instanceof Date ? docValue : new Date(docValue);
          const oVal = opVal instanceof Date ? opVal : new Date(opVal);
          if (!(dVal <= oVal)) return false;
        } else if (op === '$gt') {
          const dVal = docValue instanceof Date ? docValue : new Date(docValue);
          const oVal = opVal instanceof Date ? opVal : new Date(opVal);
          if (!(dVal > oVal)) return false;
        } else if (op === '$gte') {
          const dVal = docValue instanceof Date ? docValue : new Date(docValue);
          const oVal = opVal instanceof Date ? opVal : new Date(opVal);
          if (!(dVal >= oVal)) return false;
        } else if (op === '$ne') {
          if (String(docValue) === String(opVal)) return false;
        }
      }
    } else {
      // Direct equality check
      if (Array.isArray(docValue)) {
        if (!docValue.some(v => String(v) === String(value))) return false;
      } else {
        if (String(docValue) !== String(value)) return false;
      }
    }
  }
  return true;
}

class SqliteCollection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  async _getAll() {
    const rows = await this.db.all(`SELECT data FROM ${this.name}`);
    return rows.map(r => JSON.parse(r.data));
  }

  async _save(doc) {
    const dataStr = JSON.stringify(doc);
    await this.db.run(
      `INSERT OR REPLACE INTO ${this.name} (id, data) VALUES (?, ?)`,
      [String(doc._id), dataStr]
    );
  }

  async insertOne(doc) {
    if (!doc._id) {
      doc._id = generateId();
    }
    await this._save(doc);
    return { insertedId: doc._id };
  }

  async findOne(query) {
    const docs = await this._getAll();
    const match = docs.find(d => matchQuery(d, query));
    return match || null;
  }

  find(query) {
    const self = this;
    let sortSpec = null;
    let limitVal = null;

    const cursor = {
      sort(spec) {
        sortSpec = spec;
        return cursor;
      },
      limit(val) {
        limitVal = val;
        return cursor;
      },
      async toArray() {
        let docs = await self._getAll();
        docs = docs.filter(d => matchQuery(d, query));

        if (sortSpec) {
          docs.sort((a, b) => {
            for (const [key, direction] of Object.entries(sortSpec)) {
              const valA = getValueByPath(a, key);
              const valB = getValueByPath(b, key);

              if (valA < valB) return direction === -1 ? 1 : -1;
              if (valA > valB) return direction === -1 ? -1 : 1;
            }
            return 0;
          });
        }

        if (limitVal !== null) {
          docs = docs.slice(0, limitVal);
        }

        return docs;
      }
    };

    return cursor;
  }

  async updateOne(query, updateSpec, options = {}) {
    const docs = await this._getAll();
    const match = docs.find(d => matchQuery(d, query));

    if (match) {
      if (updateSpec.$set) {
        for (const [key, val] of Object.entries(updateSpec.$set)) {
          setValueByPath(match, key, val);
        }
      }
      match.updatedAt = new Date();
      await this._save(match);
      return { modifiedCount: 1 };
    } else if (options.upsert) {
      const newDoc = {
        _id: query._id || generateId(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      for (const [key, val] of Object.entries(query)) {
        if (!key.startsWith('$') && !key.includes('.')) {
          newDoc[key] = val;
        }
      }

      if (updateSpec.$set) {
        for (const [key, val] of Object.entries(updateSpec.$set)) {
          setValueByPath(newDoc, key, val);
        }
      }

      await this._save(newDoc);
      return { modifiedCount: 0, upsertedId: newDoc._id };
    }

    return { modifiedCount: 0 };
  }

  async deleteOne(query) {
    const docs = await this._getAll();
    const match = docs.find(d => matchQuery(d, query));
    if (match) {
      await this.db.run(`DELETE FROM ${this.name} WHERE id = ?`, [String(match._id)]);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(query) {
    const docs = await this._getAll();
    const matches = docs.filter(d => matchQuery(d, query));
    let deletedCount = 0;
    for (const match of matches) {
      await this.db.run(`DELETE FROM ${this.name} WHERE id = ?`, [String(match._id)]);
      deletedCount++;
    }
    return { deletedCount };
  }

  async createIndex(indexSpec, options) {
    return true;
  }
}

class SqliteDbWrapper {
  constructor(db) {
    this.db = db;
  }

  collection(name) {
    return new SqliteCollection(this.db, name);
  }
}

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.sqliteDb = null;
  }

  async connect() {
    if (useMongo) {
      try {
        const { MongoClient } = require('mongodb');
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/slack-standup-bot';
        this.client = new MongoClient(uri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        });

        await this.client.connect();
        const dbName = uri.split('/').pop().split('?')[0] || 'slack-standup-bot';
        this.db = this.client.db(dbName);

        this.client.on('close', () => {
          console.error('⚠️ MongoDB connection closed unexpectedly');
        });
        this.client.on('error', (err) => {
          console.error('⚠️ MongoDB connection error:', err.message);
        });

        console.log('✅ Connected to MongoDB successfully');
        await this.createIndexes();
        return this.db;
      } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
      }
    } else {
      try {
        const sqlite = require('sqlite');
        const sqlite3 = require('sqlite3');
        const path = require('path');
        const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../standup-bot.db');

        this.sqliteDb = await sqlite.open({
          filename: dbPath,
          driver: sqlite3.Database
        });

        // Create tables if they do not exist
        const collections = ['teams', 'channels', 'standups', 'responses'];
        for (const col of collections) {
          await this.sqliteDb.exec(
            `CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, data TEXT)`
          );
        }

        this.db = new SqliteDbWrapper(this.sqliteDb);
        console.log(`✅ Connected to SQLite successfully (path: ${dbPath})`);
        return this.db;
      } catch (error) {
        console.error('❌ SQLite connection error:', error);
        throw error;
      }
    }
  }

  async createIndexes() {
    if (!useMongo) return;
    try {
      await this.db.collection('teams').createIndex({ teamId: 1 }, { unique: true });
      await this.db.collection('channels').createIndex({ teamId: 1, channelId: 1 }, { unique: true });
      await this.db.collection('channels').createIndex({ teamId: 1 });
      await this.db.collection('channels').createIndex(
        { isActive: 1, status: 1, 'config.days': 1 },
        { name: 'scheduler_lookup' }
      );
      await this.db.collection('standups').createIndex({ teamId: 1, channelId: 1 });
      await this.db.collection('standups').createIndex({ status: 1 });
      await this.db.collection('standups').createIndex({ scheduledDate: 1 });
      await this.db.collection('standups').createIndex(
        { status: 1, responseDeadline: 1 },
        { name: 'expired_standups_lookup' }
      );
      await this.db.collection('standups').createIndex(
        { status: 1, 'reminders.nextReminderAt': 1 },
        { name: 'pending_reminders_lookup' }
      );
      await this.db.collection('standups').createIndex(
        { teamId: 1, channelId: 1, startedAt: -1 },
        { name: 'has_standup_today_lookup' }
      );
      await this.db.collection('responses').createIndex({ standupId: 1 });
      await this.db.collection('responses').createIndex({ userId: 1, standupId: 1 }, { unique: true });
      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('❌ Error creating indexes:', error);
    }
  }

  getDb() {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  async close() {
    if (useMongo) {
      if (this.client) {
        await this.client.close();
        console.log('✅ MongoDB connection closed');
      }
    } else {
      if (this.sqliteDb) {
        await this.sqliteDb.close();
        console.log('✅ SQLite connection closed');
      }
    }
  }

  async ping() {
    try {
      if (useMongo) {
        await this.db.admin().ping();
      } else {
        await this.sqliteDb.get('SELECT 1');
      }
      return true;
    } catch (error) {
      console.error('❌ Database ping failed:', error);
      return false;
    }
  }
}

const database = new Database();
// Attach ObjectId dynamically
database.ObjectId = useMongo ? require('mongodb').ObjectId : MockObjectId;

module.exports = database;