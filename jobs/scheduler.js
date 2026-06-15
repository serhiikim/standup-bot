
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
   * Initialize with app 
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
  
      // Find channels scheduled for today
      const channels = await Channel.findScheduledForToday(currentDay, now);
  
      for (const channel of channels) {
        try {
          // ✅ Use channel method to check time (it considers timezone!)
          if (channel.isTimeForStandup(now)) {
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
      const channelTimezone = channel.config?.timezone || 'UTC';
      
      // Get today's date in the channel's timezone
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: channelTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const todayStr = formatter.format(now); // YYYY-MM-DD in channel TZ
      
      // Query a generous window (last 24h) and check calendar day in timezone
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const Standup = require('../models/Standup');
      const standups = await Standup.getCollection().find({
        teamId: channel.teamId,
        channelId: channel.channelId,
        startedAt: { $gte: twentyFourHoursAgo }
      }).toArray();

      // Check if any standup was started on the same calendar day in the channel's timezone
      for (const standup of standups) {
        const standupDateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: channelTimezone,
          year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(standup.startedAt);
        
        if (standupDateStr === todayStr) {
          return true;
        }
      }

      return false;

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
      return processed;
    } catch (error) {
      console.error('❌ Error processing expired standups:', error);
      return 0;
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
      return processed;
    } catch (error) {
      console.error('❌ Error processing reminders:', error);
      return 0;
    }
  }

  /**
   * Cleanup old data (optional)
   */
  async cleanupOldData() {
    try {
      console.log('🧹 Starting daily cleanup...');
      
      // Delete standups older than 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const Standup = require('../models/Standup');
      const Response = require('../models/Response');

      // Find old standups
      const oldStandups = await Standup.getCollection().find({
        createdAt: { $lt: ninetyDaysAgo },
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