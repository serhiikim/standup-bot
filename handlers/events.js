const SlackService = require('../services/slackService');
const Channel = require('../models/Channel');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const StandupService = require('../services/standupService');
const { STANDUP_STATUS } = require('../utils/constants');

let slackService;
let standupService;

// Serialises work per standup. The previous lock was keyed per user AND per
// standup and dropped the message when held, which caused two problems: two
// people replying at once each held their own key and raced, and a second
// message from the same person was discarded outright. Queueing on one key per
// standup fixes both — nothing is dropped, it just waits its turn.
const standupLocks = new Map();

function withStandupLock(standupId, fn) {
  const key = String(standupId);
  const previous = standupLocks.get(key) || Promise.resolve();

  const run = previous.then(fn);
  // The stored link must never reject, or the next waiter inherits the failure.
  const link = run.catch(() => {});
  standupLocks.set(key, link);

  link.then(() => {
    // Only the last waiter clears the entry, so the map does not grow forever.
    if (standupLocks.get(key) === link) {
      standupLocks.delete(key);
    }
  });

  return run;
}

// Message subtypes that still carry a genuine standup reply:
//  - file_share: a reply with an uploaded screenshot/video. The typed text and
//    the attachment arrive as ONE message, so dropping it loses the text too.
//  - thread_broadcast: a thread reply the author also sent to the channel.
// Everything else stays out. A whitelist fails closed, so a subtype Slack adds
// later is ignored rather than silently flowing into standup responses.
const ALLOWED_SUBTYPES = new Set(['file_share', 'thread_broadcast']);

function shouldProcessSubtype(subtype, isNativeEdit) {
  if (!subtype) return true;
  if (isNativeEdit) return true;
  return ALLOWED_SUBTYPES.has(subtype);
}

// A file-only reply has empty text. Recording it as-is would mark the user as
// having responded while contributing nothing to the summary, so stand in a
// short description of what they shared.
function describeAttachments(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return '';
  }
  const label = files.length === 1 ? '1 file' : `${files.length} files`;
  const names = files.map(f => f?.title || f?.name).filter(Boolean);
  return names.length > 0
    ? `[shared ${label}: ${names.join(', ')}]`
    : `[shared ${label}]`;
}

// Reactions are cosmetic, but an unhandled failure here (a missing
// reactions:write scope, a deleted message, already_reacted) used to abort the
// rest of the handler — including the completion check that posts the summary.
async function addReaction(client, channel, timestamp, name) {
  try {
    await client.reactions.add({ channel, timestamp, name });
  } catch (error) {
    const reason = error?.data?.error || error?.message;
    if (reason !== 'already_reacted') {
      console.warn(`⚠️ Could not add :${name}: to ${channel}/${timestamp}: ${reason}`);
    }
  }
}

// The text to record for a message, falling back to an attachment description.
// Returns an empty string when there is nothing worth recording.
function resolveResponseText(text, files) {
  const hasText = typeof text === 'string' && text.trim().length > 0;
  return hasText ? text : describeAttachments(files);
}

function register(app) {
  slackService = new SlackService(app);
  standupService = new StandupService(app);
  // Handle messages in threads (for standup responses)
  app.event('message', async ({ event, client, context, body }) => {
    try {
      // Allow message_changed subtype for native Slack edits
      const isNativeEdit = event.subtype === 'message_changed';

      if (!shouldProcessSubtype(event.subtype, isNativeEdit)) {
        return;
      }

      // For native edits, message data is nested under event.message
      const messageData = isNativeEdit ? event.message : event;

      // Only process threaded messages
      if (!messageData.thread_ts) {
        return;
      }

      // Skip bot messages
      if (messageData.bot_id) {
        return;
      }

      const { user, text, ts, thread_ts } = messageData;
      // Slack omits `team` on messages that carry an uploaded file, so reading
      // it only from the payload resolved to undefined and every lookup below
      // missed. The Bolt envelope always carries the workspace id.
      const team = event.team || messageData.team || context?.teamId || body?.team_id;
      const channel = event.channel;

      // Uploads arrive with the typed text and the files in one message; a
      // file-only reply has no text at all.
      const responseText = resolveResponseText(text, messageData.files);
      if (!responseText) {
        return; // Nothing worth recording
      }

      // Check if this is a response to an active (or just-completed) standup
      const standup = await Standup.findByThreadTs(team, thread_ts);
      const isCompletedStandup = standup?.status === STANDUP_STATUS.COMPLETED;
      if (!standup || (!standup.isActive() && !isCompletedStandup)) {
        // Logged because a reply silently vanishing here is indistinguishable
        // from a reply in an unrelated thread, which is how a lost-response bug
        // stayed invisible for weeks.
        console.debug(
          `↩️ Ignoring thread reply: no active standup (team=${team}, thread=${thread_ts}, user=${user}, status=${standup?.status || 'none'})`
        );
        return; // Not a standup thread we still accept responses for
      }

      // Check if user is expected to participate
      if (!standup.expectedParticipants.includes(user)) {
        console.debug(
          `↩️ Ignoring thread reply: user not an expected participant (team=${team}, thread=${thread_ts}, user=${user})`
        );
        return;
      }

      await withStandupLock(standup._id, async () => {
        // Get user info for better display
        const userInfo = await slackService.getUserInfo(user);

        // A response is "late" if the standup already completed (summary sent) or
        // the deadline has passed but the completion job hasn't caught up yet.
        const isLate = isCompletedStandup ||
          (standup.responseDeadline && new Date() > standup.responseDeadline);

        // Handle response (create or update)
        const existingResponse = await Response.findByStandupAndUser(standup._id, user);
        let responseAction = '';

        if (existingResponse) {
          // Add this message to the reply rather than replacing it. Someone who
          // posts their update across two messages used to keep only the last.
          existingResponse.recordMessage(ts, responseText);
          existingResponse.messageTs = ts;
          existingResponse.isLate = isLate;
          existingResponse.markAsEdited();
          await existingResponse.save();
          responseAction = 'updated';

          // React to show update received (skip for native edits — the original ✅ is already there)
          if (!isNativeEdit) {
            await addReaction(client, channel, ts, 'pencil2');
          }

        } else if (!isNativeEdit) {
          // Create new response (only for new messages, not native edits)
          const responseData = {
            standupId: standup._id,
            teamId: team,
            channelId: channel,
            userId: user,
            username: userInfo.name,
            userDisplayName: userInfo.profile?.display_name || userInfo.real_name || userInfo.name,
            messageTs: ts,
            threadTs: thread_ts,
            submittedAt: new Date(),
            isLate
          };

          const response = await Response.create(responseData);
          response.recordMessage(ts, responseText);
          response.calculateResponseTime(standup.startedAt);
          await response.save();

          // Don't touch participant/stats for a standup that already completed —
          // its summary and stats were already computed and posted.
          if (!isCompletedStandup) {
            // Re-read inside the lock. The copy above was fetched before the lock
            // was held, and save() rewrites the whole document, so mutating a
            // stale copy erases participants added in the meantime.
            const current = await Standup.findById(standup._id) || standup;
            current.addParticipant(user);
            await current.save();
          }
          responseAction = 'received';

          // React to show response received
          await addReaction(client, channel, ts, 'white_check_mark');
        } else {
          // Native edit on a message we don't have a response for — ignore
          return;
        }

        console.log(`Standup response ${responseAction} from ${userInfo.name}${isLate ? ' (late)' : ''}`);

        // Skip completion checks entirely for a standup that's already completed —
        // nothing left to auto-complete or re-summarize.
        if (!isCompletedStandup) {
          // 🎯 SINGLE RESPONSIBILITY: Delegate all business logic to StandupService
          const completionResult = await standupService.checkStandupCompletion(standup._id, 'response');

          if (completionResult.success) {
            console.log(`📊 Standup completion check result:`, completionResult);
          } else {
            console.error(`❌ Standup completion check failed:`, completionResult.error);
          }
        }

      });

    } catch (error) {
      console.error('Error handling message event:', error);
    }
  });

  // Handle app mentions (for bot interaction)
  app.event('app_mention', async ({ event, client, say }) => {
    try {
      const { channel, user, text } = event;

      // Simple bot interaction - could be expanded
      if (text.toLowerCase().includes('help')) {
        await say({
          channel: channel,
          text: `👋 Hi there! I'm your standup bot. Here's what I can do:

• \`/standup-setup\` - Configure standup for this channel
• \`/standup-start\` - Manually start a standup
• \`/standup-status\` - Check current standup configuration

For more help, visit our documentation!`
        });
      } else {
        await say({
          channel: channel,
          text: `👋 Hi ${slackService.formatUserMention(user)}! I'm here to help with standups. Type \`/standup-setup\` to get started or mention me with "help" for more information.`
        });
      }

    } catch (error) {
      console.error('Error handling app mention:', error);
    }
  });

  // Handle channel events (for maintaining channel info)
  app.event('channel_rename', async ({ event }) => {
    try {
      const { channel } = event;
      
      // Update channel name in our database
      const channelConfig = await Channel.findByChannelId(event.team, channel.id);
      if (channelConfig) {
        await Channel.updateByChannelId(event.team, channel.id, {
          channelName: channel.name
        });
        console.log(`Updated channel name: ${channel.name}`);
      }

    } catch (error) {
      console.error('Error handling channel rename:', error);
    }
  });

  // Handle member join/leave events (for participant management)
  app.event('member_joined_channel', async ({ event }) => {
    try {
      const { channel, user, team } = event;
      
      // Check if this channel has standup configured
      const channelConfig = await Channel.findByChannelId(team, channel);
      if (channelConfig && channelConfig.isActive) {
        
        // If no specific participants are set, new member is automatically included
        if (!channelConfig.hasSpecificParticipants()) {
          console.log(`New member ${user} joined standup-enabled channel ${channel}`);
          
          // Optionally send welcome message
          // await slackService.sendDM(user, 
          //   `👋 Welcome! This channel has daily standups configured. You'll be automatically included in future standups.`
          // );
        }
      }

    } catch (error) {
      console.error('Error handling member joined:', error);
    }
  });

  app.event('member_left_channel', async ({ event }) => {
    try {
      const { channel, user, team } = event;
      
      // Remove user from specific participants if they were added
      const channelConfig = await Channel.findByChannelId(team, channel);
      if (channelConfig && channelConfig.config.participants.includes(user)) {
        const updatedParticipants = channelConfig.config.participants.filter(p => p !== user);
        await Channel.updateByChannelId(team, channel, {
          'config.participants': updatedParticipants
        });
        console.log(`Removed ${user} from standup participants in ${channel}`);
      }

    } catch (error) {
      console.error('Error handling member left:', error);
    }
  });

  // Handle reaction events (for bot interaction feedback)
  app.event('reaction_added', async ({ event }) => {
    try {
      // Could implement reaction-based interactions here
      // For example, reacting with specific emoji to standup messages
      if (event.reaction === 'question' && event.item.type === 'message') {
        // User has a question about the standup
        console.log('User has question about standup:', event.user);
      }

    } catch (error) {
      console.error('Error handling reaction:', error);
    }
  });

  console.log('✅ Event handlers registered');
}

// The subtype gate and text resolution are exported for unit tests; the app
// itself only needs register.
module.exports = { register, shouldProcessSubtype, describeAttachments, resolveResponseText, withStandupLock, addReaction, ALLOWED_SUBTYPES };