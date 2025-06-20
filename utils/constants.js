// Default standup questions
const DEFAULT_STANDUP_QUESTIONS = [
    "What did you accomplish yesterday?",
    "What are you working on today?",
    "Any blockers or challenges?"
  ];
  
  // Time and scheduling constants
  const DEFAULT_STANDUP_TIME = "09:00";
  const DEFAULT_RESPONSE_TIMEOUT = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
  const DEFAULT_TIMEZONE = "UTC";
  
  // Weekdays mapping
  const WEEKDAYS = {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6
  };
  
  // Default standup days (Monday to Friday)
  const DEFAULT_STANDUP_DAYS = [
    WEEKDAYS.MONDAY,
    WEEKDAYS.TUESDAY,
    WEEKDAYS.WEDNESDAY,
    WEEKDAYS.THURSDAY,
    WEEKDAYS.FRIDAY
  ];
  
  // Standup statuses
  const STANDUP_STATUS = {
    SCHEDULED: 'scheduled',
    ACTIVE: 'active',
    COLLECTING: 'collecting',
    ANALYZING: 'analyzing',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired'
  };
  
  // Channel configuration status
  const CHANNEL_STATUS = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    DISABLED: 'disabled'
  };
  
  // System limits
  const LIMITS = {
    MAX_QUESTIONS: 10,
    MIN_QUESTIONS: 1,
    MAX_PARTICIPANTS: 100,
    MIN_RESPONSE_LENGTH: 5,
    MAX_RESPONSE_LENGTH: 2000,
    MAX_CHANNEL_NAME_LENGTH: 21 // Slack limit
  };
  
  // User messages
  const MESSAGES = {
    SETUP_SUCCESS: "✅ Standup configuration saved successfully!",
    SETUP_ERROR: "❌ Failed to save standup configuration. Please try again.",
    STANDUP_STARTED: "🚀 Daily standup has started! Please respond in this thread within 3 hours.",
    STANDUP_REMINDER: "⏰ Reminder: Please submit your standup response!",
    STANDUP_COMPLETED: "✅ Standup completed! Summary will be posted shortly.",
    STANDUP_CANCELLED: "❌ Standup has been cancelled.",
    NO_RESPONSES: "😴 No responses received for today's standup.",
    RESPONSE_RECEIVED: "✅ Response received!",
    RESPONSE_UPDATED: "✅ Response updated!",
    UNAUTHORIZED: "❌ You don't have permission to perform this action.",
    CHANNEL_NOT_CONFIGURED: "❌ This channel is not configured for standups. Use `/standup-setup` first.",
    INVALID_CONFIGURATION: "❌ Invalid configuration. Please check your settings."
  };
  
  // Slack Block Kit element IDs
  const BLOCK_IDS = {
    SETUP_MODAL: 'standup_setup_modal',
    QUESTIONS_INPUT: 'questions_input',
    TIME_SELECT: 'time_select',
    DAYS_SELECT: 'days_select',
    PARTICIPANTS_SELECT: 'participants_select',
    TIMEZONE_SELECT: 'timezone_select',
    START_BUTTON: 'start_standup_button',
    CANCEL_BUTTON: 'cancel_standup_button',
    SUBMIT_RESPONSE: 'submit_response_button'
  };
  
  // Time zones (common ones)
  const TIMEZONES = [
    { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
    { value: 'America/New_York', label: 'EST/EDT (Eastern Time)' },
    { value: 'America/Chicago', label: 'CST/CDT (Central Time)' },
    { value: 'America/Denver', label: 'MST/MDT (Mountain Time)' },
    { value: 'America/Los_Angeles', label: 'PST/PDT (Pacific Time)' },
    { value: 'Europe/London', label: 'GMT/BST (London)' },
    { value: 'Europe/Berlin', label: 'CET/CEST (Berlin)' },
    { value: 'Asia/Tokyo', label: 'JST (Tokyo)' },
    { value: 'Asia/Shanghai', label: 'CST (Shanghai)' },
    { value: 'Australia/Sydney', label: 'AEST/AEDT (Sydney)' }
  ];
  
  // Time options for standup (24-hour format)
  const TIME_OPTIONS = [];
  for (let hour = 6; hour <= 18; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayTime = hour < 12 
        ? `${hour === 0 ? 12 : hour}:${minute.toString().padStart(2, '0')} AM`
        : `${hour === 12 ? 12 : hour - 12}:${minute.toString().padStart(2, '0')} PM`;
      
      TIME_OPTIONS.push({
        value: timeString,
        label: displayTime
      });
    }
  }
  
  // Day options for standup
  const DAY_OPTIONS = [
    { value: WEEKDAYS.MONDAY, label: 'Monday' },
    { value: WEEKDAYS.TUESDAY, label: 'Tuesday' },
    { value: WEEKDAYS.WEDNESDAY, label: 'Wednesday' },
    { value: WEEKDAYS.THURSDAY, label: 'Thursday' },
    { value: WEEKDAYS.FRIDAY, label: 'Friday' },
    { value: WEEKDAYS.SATURDAY, label: 'Saturday' },
    { value: WEEKDAYS.SUNDAY, label: 'Sunday' }
  ];
  
  module.exports = {
    DEFAULT_STANDUP_QUESTIONS,
    DEFAULT_STANDUP_TIME,
    DEFAULT_RESPONSE_TIMEOUT,
    DEFAULT_TIMEZONE,
    WEEKDAYS,
    DEFAULT_STANDUP_DAYS,
    STANDUP_STATUS,
    CHANNEL_STATUS,
    LIMITS,
    MESSAGES,
    BLOCK_IDS,
    TIMEZONES,
    TIME_OPTIONS,
    DAY_OPTIONS
  };