const SlackService = require('../services/slackService');
const Channel = require('../models/Channel');
const Team = require('../models/Team');
const { 
  MESSAGES, 
  BLOCK_IDS, 
  LIMITS,
  DEFAULT_STANDUP_QUESTIONS,
  DEFAULT_DEADLINE_TIME,
  DEFAULT_TIMEZONE,
  DEFAULT_RESPONSE_TIMEOUT,
  TIME_OPTIONS
} = require('../utils/constants');

/**
 * Convert 24h time string to AM/PM display format.
 * e.g. '18:00' → '6:00 PM', '09:30' → '9:30 AM'
 */
function formatTimeAmPm(time24) {
  const match = TIME_OPTIONS.find(t => t.value === time24);
  if (match) return match.label;
  // Fallback: manual conversion
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

let slackService;

function register(app) {
  slackService = new SlackService(app);

  // Handle standup setup modal submission
  app.view(BLOCK_IDS.SETUP_MODAL, async ({ ack, body, view, client }) => {
    // Extract form data
    const values = view.state.values;
    
    let userTimezone = 'UTC';
    try {
      const metadata = JSON.parse(body.view.private_metadata);
      userTimezone = metadata.userTimezone || 'UTC';
    } catch (e) {
      console.error('Error parsing metadata:', e);
    }
    
    // Validate the form data (timezone is no longer validated)
    const validation = validateSetupForm(values);
    
    if (!validation.isValid) {
      // Return validation errors
      await ack({
        response_action: 'errors',
        errors: validation.errors
      });
      return;
    }
  
    // If validation passes, acknowledge without errors
    await ack();
  
    try {
      const { team, user, trigger_id } = body;
      const teamId = team.id;
      const userId = user.id;
      
      // Extract channel ID from private metadata
      let channelId;
      try {
        const metadata = JSON.parse(body.view.private_metadata);
        channelId = metadata.channelId;
      } catch (e) {
        throw new Error('Missing channel context');
      }
  
      // Get channel info
      const channelInfo = await slackService.getChannelInfo(channelId);
      if (!channelInfo) {
        throw new Error('Channel not found');
      }
  
      // Extract and process form data с учетом auto-detected таймзоны
      const formData = extractFormData(values, userTimezone);
      
      // Save or update channel configuration
      await saveChannelConfiguration(teamId, channelId, userId, channelInfo, formData);
  
      // Send success message to user
      await slackService.sendDM(userId, 
        `${MESSAGES.SETUP_SUCCESS}\n\n` +
        `📋 Configuration saved for #${channelInfo.name}:\n` +
        `• Time: ${formatTimeAmPm(formData.time)} (${formData.timezone})\n` +
        `• Deadline: ${formatTimeAmPm(formData.deadlineTime)} (${formData.timezone})\n` +
        `• Days: ${formData.daysText}\n` +
        `• Questions: ${formData.questions.length}\n` +
        `• Participants: ${formData.participants.length > 0 ? `${formData.participants.length} specific users` : 'All channel members'}`
      );
  
      // Post confirmation in channel (only if bot is in channel)
      try {
        await slackService.postMessage(channelId,
          `✅ Standup configuration ${formData.isUpdate ? 'updated' : 'created'} by ${slackService.formatUserMention(userId)}!\n\n` +
          `🕒 Standups will run at *${formatTimeAmPm(formData.time)}* (${formData.timezone}) on *${formData.daysText}*\n` +
          `⏰ Deadline: *${formatTimeAmPm(formData.deadlineTime)}* (${formData.timezone})\n` +
          `❓ ${formData.questions.length} questions configured\n` +
          `👥 ${formData.participants.length > 0 ? `${formData.participants.length} specific participants` : 'All channel members can participate'}`
        );
      } catch (channelError) {
        // If bot can't post to channel, just skip this step
        console.log('Could not post to channel (bot not in channel):', channelError.data?.error);
      }
  
    } catch (error) {
      console.error('Error saving standup configuration:', error);
      
      // Try to send error message to user
      try {
        await slackService.sendDM(body.user.id, MESSAGES.SETUP_ERROR);
      } catch (dmError) {
        console.error('Failed to send error DM:', dmError);
      }
    }
  });

  console.log('✅ View handlers registered');
}

function validateSetupForm(values) {
    const errors = {};
    let isValid = true;
  
    // Validate questions
    const questionsValue = values[BLOCK_IDS.QUESTIONS_INPUT]?.[BLOCK_IDS.QUESTIONS_INPUT]?.value;
    if (!questionsValue || questionsValue.trim().length === 0) {
      errors[BLOCK_IDS.QUESTIONS_INPUT] = 'At least one question is required';
      isValid = false;
    } else {
      const questions = questionsValue.split('\n')
        .map(q => q.trim())
        .filter(q => q.length > 0);
      
      if (questions.length === 0) {
        errors[BLOCK_IDS.QUESTIONS_INPUT] = 'At least one question is required';
        isValid = false;
      } else if (questions.length > LIMITS.MAX_QUESTIONS) {
        errors[BLOCK_IDS.QUESTIONS_INPUT] = `Maximum ${LIMITS.MAX_QUESTIONS} questions allowed`;
        isValid = false;
      } else {
        // Check individual question length
        const longQuestions = questions.filter(q => q.length > 200);
        if (longQuestions.length > 0) {
          errors[BLOCK_IDS.QUESTIONS_INPUT] = 'Questions must be 200 characters or less';
          isValid = false;
        }
      }
    }
  
    // Validate time selection
    const timeValue = values[BLOCK_IDS.TIME_SELECT]?.[BLOCK_IDS.TIME_SELECT]?.selected_option?.value;
    if (!timeValue) {
      errors[BLOCK_IDS.TIME_SELECT] = 'Please select a time';
      isValid = false;
    }
  
    // Validate days selection
    const daysValue = values[BLOCK_IDS.DAYS_SELECT]?.[BLOCK_IDS.DAYS_SELECT]?.selected_options;
    if (!daysValue || daysValue.length === 0) {
      errors[BLOCK_IDS.DAYS_SELECT] = 'Please select at least one day';
      isValid = false;
    }

    // Validate deadline time
    const deadlineTimeValue = values[BLOCK_IDS.DEADLINE_TIME_SELECT]?.[BLOCK_IDS.DEADLINE_TIME_SELECT]?.selected_option?.value;
    if (!deadlineTimeValue) {
      errors[BLOCK_IDS.DEADLINE_TIME_SELECT] = 'Please select a deadline time';
      isValid = false;
    } else if (timeValue) {
      // Validate deadline is after start time
      const [startH, startM] = timeValue.split(':').map(Number);
      const [deadH, deadM] = deadlineTimeValue.split(':').map(Number);
      if (deadH * 60 + deadM <= startH * 60 + startM) {
        errors[BLOCK_IDS.DEADLINE_TIME_SELECT] = 'Deadline time must be after the start time';
        isValid = false;
      }
    }
  
    return { isValid, errors };
  }

  function extractFormData(values, userTimezone = 'UTC') {
    // Extract questions
    const questionsValue = values[BLOCK_IDS.QUESTIONS_INPUT][BLOCK_IDS.QUESTIONS_INPUT].value;
    const questions = questionsValue.split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0);
  
    // Extract time
    const time = values[BLOCK_IDS.TIME_SELECT][BLOCK_IDS.TIME_SELECT].selected_option.value;

    // Extract deadline time
    const deadlineTime = values[BLOCK_IDS.DEADLINE_TIME_SELECT]?.[BLOCK_IDS.DEADLINE_TIME_SELECT]?.selected_option?.value || DEFAULT_DEADLINE_TIME;
  
    // Extract days
    const daysOptions = values[BLOCK_IDS.DAYS_SELECT][BLOCK_IDS.DAYS_SELECT].selected_options;
    const days = daysOptions.map(option => parseInt(option.value));
    
    // Create days text for display
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysText = days.map(day => dayNames[day]).join(', ');
  
    // ✅ MAIN FIX: Use selected timezone from form!
    const selectedTimezone = values[BLOCK_IDS.TIMEZONE_SELECT]?.[BLOCK_IDS.TIMEZONE_SELECT]?.selected_option?.value;
    const timezone = selectedTimezone || userTimezone || 'UTC';
  
    // Extract participants (optional)
    const participantsData = values[BLOCK_IDS.PARTICIPANTS_SELECT]?.[BLOCK_IDS.PARTICIPANTS_SELECT];
    const participants = participantsData?.selected_users || [];
  
    return {
      questions,
      time,
      deadlineTime,
      days,
      daysText,
      timezone,
      participants
    };
  }

  async function saveChannelConfiguration(teamId, channelId, userId, channelInfo, formData) {
    // Check if channel configuration already exists
    const existingChannel = await Channel.findByChannelId(teamId, channelId);
    const isUpdate = !!existingChannel;
  
    // Ensure team record exists
    let team = await Team.findByTeamId(teamId);
    if (!team) {
      // Create basic team record without API call
      team = await Team.create({
        teamId: teamId,
        teamName: `Team-${teamId}`, // Placeholder name
        teamDomain: 'unknown',
        installedBy: userId,
        isActive: true
      });
    }
  
    // Calculate responseTimeout as fallback (difference between start and deadline)
    let responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
    try {
      const [startHour, startMinute] = formData.time.split(':').map(Number);
      const [deadHour, deadMinute] = formData.deadlineTime.split(':').map(Number);
      const startMins = startHour * 60 + startMinute;
      const endMins = deadHour * 60 + deadMinute;
      const diffMins = endMins - startMins;
      if (diffMins > 0) {
        responseTimeout = diffMins * 60 * 1000;
      }
    } catch (e) {
      console.error('Error calculating response timeout:', e);
    }

    const channelData = {
      teamId: teamId,
      channelId: channelId,
      channelName: channelInfo.name,
      configuredBy: userId,
      config: {
        questions: formData.questions,
        time: formData.time,
        deadlineTime: formData.deadlineTime,
        days: formData.days,
        timezone: formData.timezone,
        participants: formData.participants,
        responseTimeout: responseTimeout,
        enableReminders: true,
        reminderInterval: 60 * 60 * 1000, // 1 hour
        requireAllResponses: false,
        autoSummary: true
      },
      isActive: true,
      status: 'active'
    };
  
    if (isUpdate) {
      // Update existing channel
      await Channel.updateByChannelId(teamId, channelId, channelData);
      formData.isUpdate = true;
    } else {
      // Create new channel configuration
      await Channel.create(channelData);
      formData.isUpdate = false;
    }
  
    // Update team's last active timestamp
    await Team.updateLastActive(teamId);
  }

module.exports = { register };