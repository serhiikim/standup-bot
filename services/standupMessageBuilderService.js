
const { BLOCK_IDS } = require('../utils/constants');
const SlackService = require('./slackService');

class StandupMessageBuilderService {
  constructor(app) {
    this.app = app;
    this.slackService = new SlackService(app);
  }

  createStandupMessage(standup, participants, channel, statusFilter = null) {
    const participantMentions = participants.map(p => this.slackService.formatUserMention(p.id)).join(' ');
    
    let text = `🚀 **Daily Standup Started!**\n\nPlease respond to the questions below in this thread within ${Math.floor(channel.config.responseTimeout / (1000 * 60 * 60))} hours.`;
    
    if (statusFilter && statusFilter.oooCount > 0) {
      text += `\n\n📴 ${statusFilter.oooCount} team member(s) are currently out of office.`;
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚀 *Daily Standup Started!*\n\n${participantMentions}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Started ${standup.isManual ? 'manually' : 'automatically'} • Deadline: <!date^${Math.floor(standup.responseDeadline.getTime() / 1000)}^{time}|${standup.responseDeadline.toLocaleTimeString()}>`
          }
        ]
      }
    ];

    if (statusFilter && statusFilter.oooCount > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📴 *Out of Office (${statusFilter.oooCount}):*`
        }
      });

      const oooText = statusFilter.oooUsers
        .slice(0, 5)
        .map(oooUser => {
          const userName = oooUser.user?.displayName || `<@${oooUser.userId}>`;
          return `• ${userName} - ${oooUser.reason}`;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: oooText + (statusFilter.oooUsers.length > 5 ? `\n... and ${statusFilter.oooUsers.length - 5} more` : '')
        }
      });
    }

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Please answer these questions in a reply to this thread:*'
        }
      }
    );

    standup.questions.forEach((question, index) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}.* ${question}`
        }
      });
    });

    blocks.push(
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 *Tip:* Reply to this message with your answers. You can edit your response anytime before the deadline.'
          }
        ]
      }
    );

    if (standup.isManual) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Complete Standup' },
            action_id: BLOCK_IDS.SUBMIT_RESPONSE,
            value: standup._id.toString(),
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '⏹️ Cancel Standup' },
            action_id: BLOCK_IDS.CANCEL_BUTTON,
            value: standup._id.toString(),
            style: 'danger'
          }
        ]
      });
    }

    return { text, blocks };
  }

  createCompletionMessage(standup, responses, stats, aiAnalysis = null) {
    const responseRate = standup.getResponseRate();
    const duration = Math.floor(standup.getDuration() / (1000 * 60));
    
    let text = `✅ *Standup Completed!*\n\n`;
    text += `📊 *Results:* ${stats.total}/${standup.stats.totalExpected} responses (${responseRate}%)\n`;
    text += `⏱️ *Duration:* ${duration} minutes\n`;

    if (standup.oooInfo && standup.oooInfo.oooCount > 0) {
      text += `📴 *Out of office:* ${standup.oooInfo.oooCount} team member(s)\n`;
    }

    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *Standup Completed!*` }
      },
      {
        type: 'section',
        fields: [
          { 
            type: 'mrkdwn', 
            text: `*Responses:*\n${stats.total}/${standup.stats.totalExpected} (${responseRate}%)` 
          }
        ]
      }
    ];

    if (standup.oooInfo && standup.oooInfo.oooCount > 0) {
      const oooSummary = standup.oooInfo.oooUsers
        .slice(0, 3)
        .map(u => `• ${u.displayName || `<@${u.userId}>`} - ${u.reason}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📴 *Out of Office (${standup.oooInfo.oooCount}):*\n${oooSummary}${standup.oooInfo.oooUsers.length > 3 ? `\n... and ${standup.oooInfo.oooUsers.length - 3} more` : ''}`
        }
      });
    }

    if (responses.length > 0) {
      const responseList = responses
        .slice(0, 10)
        .map(r => `• ${r.userDisplayName || r.username} ${r.isComplete ? '✅' : '⚠️'}`)
        .join('\n');
        
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { 
            type: 'mrkdwn', 
            text: `*Participants:*\n${responseList}${responses.length > 10 ? `\n... and ${responses.length - 10} more` : ''}` 
          }
        }
      );
    }

    const missing = standup.getMissingParticipants();
    if (missing.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `⚠️ Missing responses from ${missing.length} participant(s)` }
        ]
      });
    }

    if (aiAnalysis) {
      blocks.push({ type: 'divider' });
      
      if (aiAnalysis.summary) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `🤖 *AI Summary:*\n${aiAnalysis.summary}` }
        });
      }

      const fields = [];
      if (aiAnalysis.achievements && aiAnalysis.achievements.length > 0) {
        const achievementsText = aiAnalysis.achievements.slice(0, 3).map(a => `• ${a}`).join('\n');
        fields.push({ type: 'mrkdwn', text: `*🎉 Achievements:*\n${achievementsText}` });
      }
      
      if (aiAnalysis.blockers && aiAnalysis.blockers.length > 0) {
        const blockersText = aiAnalysis.blockers.slice(0, 3).map(b => `• ${b}`).join('\n');
        fields.push({ type: 'mrkdwn', text: `*🚫 Blockers:*\n${blockersText}` });
      }
      
      if (aiAnalysis.nextSteps && aiAnalysis.nextSteps.length > 0) {
        const nextStepsText = aiAnalysis.nextSteps.slice(0, 3).map(n => `• ${n}`).join('\n');
        fields.push({ type: 'mrkdwn', text: `*📋 Next Steps:*\n${nextStepsText}` });
      }
      
      if (fields.length > 0) {
        for (let i = 0; i < fields.length; i += 2) {
          blocks.push({ type: 'section', fields: fields.slice(i, i + 2) });
        }
      }
      
      if (aiAnalysis.teamMood) {
        const moodEmoji = { positive: '😊', neutral: '😐', negative: '😟' };
        blocks.push({
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Team mood: ${moodEmoji[aiAnalysis.teamMood] || '😐'} *${aiAnalysis.teamMood.charAt(0).toUpperCase() + aiAnalysis.teamMood.slice(1)}*` }
          ]
        });
      }
    } else if (responses.length > 0) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '🤖 AI analysis unavailable' }
        ]
      });
    }

    return { text, blocks };
  }

  createOOONotificationMessage(statusFilter, channel) {
    const { oooCount, originalCount, oooUsers } = statusFilter;
    const oooPercentage = Math.round((oooCount / originalCount) * 100);
    
    let text = `🏝️ *Standup Skipped - Team Out of Office*\n\n`;
    text += `${oooPercentage}% of the team (${oooCount}/${originalCount}) is currently out of office.\n\n`;
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🏝️ *Standup Skipped - Team Out of Office*`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: oooCount === originalCount 
            ? `Everyone is currently out of office! 🌴`
            : `${oooPercentage}% of the team is currently out of office.`
        }
      }
    ];

    if (oooUsers.length > 0) {
      const oooText = oooUsers
        .slice(0, 8)
        .map(oooUser => {
          const userName = oooUser.user?.displayName || `<@${oooUser.userId}>`;
          return `• ${userName} - ${oooUser.reason}`;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📴 *Out of Office (${oooCount}):*\n${oooText}${oooUsers.length > 8 ? `\n... and ${oooUsers.length - 8} more` : ''}`
        }
      });
    }

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *Next scheduled standup:* ${this.getNextStandupTime(channel)}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 Standup will resume automatically when team members return'
          }
        ]
      }
    );

    return { text, blocks };
  }

  getNextStandupTime(channel) {
    const { time, days, timezone } = channel.config;
    const now = new Date();
    const currentDay = now.getDay();
    const sortedDays = [...days].sort((a, b) => a - b);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Always next day - without "Today"
    const nextDay = sortedDays.find(day => day > currentDay) || sortedDays[0];
    return `${dayNames[nextDay]} at ${time} (${timezone})`;
  }
}

module.exports = StandupMessageBuilderService;