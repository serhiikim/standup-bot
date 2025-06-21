// jobs/scheduler.js - простое исправление

const cron = require('node-cron');
const StandupService = require('../services/standupService');
const Channel = require('../models/Channel');
const { WEEKDAYS } = require('../utils/constants');

class Scheduler {
  constructor() {
    this.app = null;
    this.standupService = null;
    this.jobs = new Map();
    this.isRunning = false;
  }

  /**
   * Initialize with app (вызывается из app.js)
   */
  setApp(app) {
    this.app = app;
    this.standupService = new StandupService(app);
    console.log('✅ Scheduler app initialized');
  }

  /**
   * Start the scheduler
   */
  start() {
    if (!this.app || !this.standupService) {
      console.error('❌ Scheduler not initialized with app. Call setApp(app) first.');
      return;
    }

    if (this.isRunning) {
      console.log('⚠️ Scheduler already running');
      return;
    }

    console.log('🕐 Starting scheduler...');

    // Check for scheduled standups every minute
    this.jobs.set('standup-check', cron.schedule('* * * * *', () => {
      this.checkScheduledStandups();
    }, {
      scheduled: false
    }));

    // Process expired standups every 5 minutes
    this.jobs.set('expired-check', cron.schedule('*/5 * * * *', () => {
      this.processExpiredStandups();
    }, {
      scheduled: false
    }));

    // Process pending reminders every 2 minutes
    this.jobs.set('reminders-check', cron.schedule('*/2 * * * *', () => {
      this.processPendingReminders();
    }, {
      scheduled: false
    }));

    // Cleanup old data daily at 2 AM
    this.jobs.set('cleanup', cron.schedule('0 2 * * *', () => {
      this.cleanupOldData();
    }, {
      scheduled: false
    }));

    // Start all jobs
    this.jobs.forEach((job, name) => {
      job.start();
      console.log(`✅ Started job: ${name}`);
    });

    this.isRunning = true;
    console.log('✅ Scheduler started successfully');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Scheduler not running');
      return;
    }

    console.log('🛑 Stopping scheduler...');

    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`✅ Stopped job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Scheduler stopped successfully');
  }

  /**
   * Check for channels that should have standup now
   */
  async checkScheduledStandups() {
    if (!this.standupService) {
      console.error('❌ StandupService not available');
      return;
    }

    try {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // Find channels scheduled for today
      const channels = await Channel.findScheduledForToday(currentDay, now);

      for (const channel of channels) {
        try {
          // Check if it's the right time for this channel
          const [configHour, configMinute] = channel.config.time.split(':').map(Number);
          
          // Allow 1-minute window for scheduling
          if (currentHour === configHour && 
              currentMinute >= configMinute && 
              currentMinute < configMinute + 1) {
            
            console.log(`🕒 Time to start standup for channel ${channel.channelId}`);
            
            // Check if standup already started today
            if (await this.hasStandupToday(channel)) {
              console.log(`⏭️ Standup already started today for channel ${channel.channelId}`);
              continue;
            }

            // Start automated standup
            await this.standupService.startStandup(
              channel.teamId,
              channel.channelId,
              'system',
              false // not manual
            );

            console.log(`✅ Auto-started standup for channel ${channel.channelId}`);

          }
        } catch (error) {
          console.error(`❌ Error starting standup for channel ${channel.channelId}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error checking scheduled standups:', error);
    }
  }

  /**
   * Check if channel already had standup today
   */
  async hasStandupToday(channel) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const Standup = require('../models/Standup');
      const standups = await Standup.getCollection().find({
        teamId: channel.teamId,
        channelId: channel.channelId,
        startedAt: {
          $gte: today,
          $lt: tomorrow
        }
      }).toArray();

      return standups.length > 0;

    } catch (error) {
      console.error('Error checking today standups:', error);
      return false;
    }
  }

  /**
   * Process expired standups
   */
  async processExpiredStandups() {
    if (!this.standupService) {
      console.error('❌ StandupService not available');
      return;
    }

    try {
      const processed = await this.standupService.processExpiredStandups();
      if (processed > 0) {
        console.log(`✅ Processed ${processed} expired standup(s)`);
      }
    } catch (error) {
      console.error('❌ Error processing expired standups:', error);
    }
  }

  /**
   * Process pending reminders
   */
  async processPendingReminders() {
    if (!this.standupService) {
      console.error('❌ StandupService not available');
      return;
    }

    try {
      const processed = await this.standupService.processPendingReminders();
      if (processed > 0) {
        console.log(`📢 Processed ${processed} reminder(s)`);
      }
    } catch (error) {
      console.error('❌ Error processing reminders:', error);
    }
  }

  /**
   * Cleanup old data (optional)
   */
  async cleanupOldData() {
    try {
      console.log('🧹 Starting daily cleanup...');
      
      // Example: Delete standups older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const Standup = require('../models/Standup');
      const Response = require('../models/Response');

      // Find old standups
      const oldStandups = await Standup.getCollection().find({
        createdAt: { $lt: thirtyDaysAgo },
        status: { $in: ['completed', 'cancelled', 'expired'] }
      }).toArray();

      if (oldStandups.length > 0) {
        // Delete responses first
        for (const standup of oldStandups) {
          await Response.deleteByStandupId(standup._id);
        }

        // Delete standups
        await Standup.getCollection().deleteMany({
          _id: { $in: oldStandups.map(s => s._id) }
        });

        console.log(`🗑️ Cleaned up ${oldStandups.length} old standup(s) and their responses`);
      }

      console.log('✅ Daily cleanup completed');

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasApp: !!this.app,
      hasStandupService: !!this.standupService,
      jobCount: this.jobs.size,
      jobs: Array.from(this.jobs.keys())
    };
  }

  /**
   * Manual trigger for testing
   */
  async triggerStandupCheck() {
    console.log('🔍 Manual trigger: checking scheduled standups');
    await this.checkScheduledStandups();
  }

  async triggerExpiredCheck() {
    console.log('🔍 Manual trigger: checking expired standups');
    await this.processExpiredStandups();
  }

  async triggerRemindersCheck() {
    console.log('🔍 Manual trigger: checking pending reminders');
    await this.processPendingReminders();
  }
}

// Singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;