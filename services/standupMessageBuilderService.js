const { BLOCK_IDS } = require('../utils/constants');
const SlackService = require('./slackService');

class StandupMessageBuilderService {
  constructor(app) {
    this.app = app;
    this.slackService = new SlackService(app);
  }

  createStandupMessage(standup, participants, channel) {
    const participantMentions = participants.map(p => this.slackService.formatUserMention(p.id)).join(' ');
    const text = `🚀 **Daily Standup Started!**\n\nPlease respond to the questions below in this thread within ${Math.floor(channel.config.responseTimeout / (1000 * 60 * 60))} hours.`;
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
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Please answer these questions in a reply to this thread:*'
        }
      }
    ];
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
    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *Standup Completed!*` }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Responses:*\n${stats.total}/${standup.stats.totalExpected} (${responseRate}%)` }
        //   { type: 'mrkdwn', text: `*Duration:*\n${duration} minutes` }
        ]
      }
    ];
    if (responses.length > 0) {
      const responseList = responses
        .slice(0, 10)
        .map(r => `• ${r.userDisplayName || r.username} ${r.isComplete ? '✅' : '⚠️'}`)
        .join('\n');
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Participants:*\n${responseList}${responses.length > 10 ? `\n... and ${responses.length - 10} more` : ''}` }
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
}

module.exports = StandupMessageBuilderService; 