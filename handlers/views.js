const SlackService = require('../services/slackService');
const Channel = require('../models/Channel');
const Team = require('../models/Team');
const { 
  MESSAGES, 
  BLOCK_IDS, 
  LIMITS,
  DEFAULT_STANDUP_QUESTIONS,
  DEFAULT_STANDUP_TIME,
  DEFAULT_STANDUP_DAYS,
  DEFAULT_TIMEZONE
} = require('../utils/constants');

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
    
    // Validate the form data (таймзона больше не валидируется)
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
        `• Time: ${formData.time} (${formData.timezone})\n` +
        `• Days: ${formData.daysText}\n` +
        `• Questions: ${formData.questions.length}\n` +
        `• Participants: ${formData.participants.length > 0 ? `${formData.participants.length} specific users` : 'All channel members'}`
      );
  
      // Post confirmation in channel (only if bot is in channel)
      try {
        await slackService.postMessage(channelId,
          `✅ Standup configuration ${formData.isUpdate ? 'updated' : 'created'} by ${slackService.formatUserMention(userId)}!\n\n` +
          `🕒 Standups will run at *${formData.time}* (${formData.timezone}) on *${formData.daysText}*\n` +
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
  
    // Extract days
    const daysOptions = values[BLOCK_IDS.DAYS_SELECT][BLOCK_IDS.DAYS_SELECT].selected_options;
    const days = daysOptions.map(option => parseInt(option.value));
    
    // Create days text for display
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysText = days.map(day => dayNames[day]).join(', ');
  
    const timezone = userTimezone;
  
    // Extract participants (optional)
    const participantsData = values[BLOCK_IDS.PARTICIPANTS_SELECT]?.[BLOCK_IDS.PARTICIPANTS_SELECT];
    const participants = participantsData?.selected_users || [];
  
    return {
      questions,
      time,
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
        accessToken: '', // This should be set during OAuth
        isActive: true
      });
    }
  
    const channelData = {
      teamId: teamId,
      channelId: channelId,
      channelName: channelInfo.name,
      configuredBy: userId,
      config: {
        questions: formData.questions,
        time: formData.time,
        days: formData.days,
        timezone: formData.timezone, // Taken from the auto-detected value
        participants: formData.participants,
        responseTimeout: 3 * 60 * 60 * 1000, // 3 hours
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

function extractChannelIdFromContext(body) {
  // Try to extract channel ID from various sources in the body
  // This is a fallback - ideally we'd pass it in private_metadata
  if (body.view?.private_metadata) {
    try {
      const metadata = JSON.parse(body.view.private_metadata);
      return metadata.channelId;
    } catch (e) {
      // Fall back to other methods
    }
  }
  
  // Could also be in trigger context, but this requires modification
  // of the command handler to pass it
  return null;
}

module.exports = { register };