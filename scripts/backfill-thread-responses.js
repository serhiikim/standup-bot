#!/usr/bin/env node
/**
 * Recovers standup replies that are sitting in Slack threads but never made it
 * into the database — the ones lost while messages carrying a file resolved to
 * an undefined workspace id, and any dropped during a container restart.
 *
 * It also rebuilds actualParticipants from the stored responses, repairing the
 * drift left by concurrent replies overwriting each other.
 *
 * Reads only, until --apply is passed.
 *
 *   node scripts/backfill-thread-responses.js --since 7d
 *   node scripts/backfill-thread-responses.js --standup 68a1... --apply
 *   node scripts/backfill-thread-responses.js --channel C0BQM7FLA91 --apply
 */

require('dotenv').config();
require('../utils/logger');

const { WebClient } = require('@slack/web-api');
const database = require('../config/database');
const Standup = require('../models/Standup');
const Response = require('../models/Response');
const SlackService = require('../services/slackService');
const { resolveResponseText } = require('../handlers/events');

function parseArgs(argv) {
  const args = { apply: false, since: '7d' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--standup') args.standup = argv[++i];
    else if (arg === '--channel') args.channel = argv[++i];
    else if (arg === '--since') args.since = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function parseSince(since) {
  const match = /^(\d+)([dh])$/.exec(since);
  if (!match) {
    throw new Error(`--since must look like "7d" or "12h", got "${since}"`);
  }
  const amount = Number(match[1]);
  const ms = match[2] === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return new Date(Date.now() - amount * ms);
}

async function findStandups(args) {
  if (args.standup) {
    const standup = await Standup.findById(args.standup);
    return standup ? [standup] : [];
  }

  const query = { startedAt: { $gte: parseSince(args.since) } };
  if (args.channel) {
    query.channelId = args.channel;
  }

  const docs = await Standup.getCollection().find(query).toArray();
  return docs.map(doc => new Standup(doc));
}

// Replies from real people, oldest first, excluding the bot's own prompt.
function humanReplies(messages, threadTs) {
  return messages
    .filter(m => m.ts !== threadTs)
    .filter(m => !m.bot_id && m.user && m.subtype !== 'tombstone')
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

function groupByUser(replies) {
  const byUser = new Map();
  for (const reply of replies) {
    if (!byUser.has(reply.user)) byUser.set(reply.user, []);
    byUser.get(reply.user).push(reply);
  }
  return byUser;
}

async function backfillStandup(standup, slackService, args, report) {
  const replies = humanReplies(
    await slackService.getThreadReplies(standup.channelId, standup.threadTs),
    standup.threadTs
  );
  const byUser = groupByUser(replies);

  for (const [userId, userReplies] of byUser) {
    if (!standup.expectedParticipants.includes(userId)) {
      report.skippedNotExpected++;
      continue;
    }

    const usable = userReplies
      .map(m => ({ ts: m.ts, text: resolveResponseText(m.text, m.files) }))
      .filter(m => m.text);

    if (usable.length === 0) {
      report.skippedEmpty++;
      continue;
    }

    const existing = await Response.findByStandupAndUser(standup._id, userId);

    // Which of the thread's messages this reply does not already account for.
    const known = new Set((existing?.messages || []).map(m => m.ts));
    if (existing && known.size === 0 && existing.messageTs) {
      // Stored before messages were tracked: only the last one is represented.
      known.add(existing.messageTs);
    }
    const missing = usable.filter(m => !known.has(m.ts));

    if (existing && missing.length === 0) {
      report.alreadyStored++;
      continue;
    }

    const first = usable[0];
    const last = usable[usable.length - 1];
    const submittedAt = new Date(Number(first.ts) * 1000);
    const preview = missing.map(m => m.text).join(' / ');

    report.recovered.push({
      standupId: String(standup._id),
      channelId: standup.channelId,
      userId,
      submittedAt,
      merged: !!existing,
      messages: missing.length,
      preview: preview.length > 60 ? `${preview.slice(0, 60)}…` : preview
    });

    if (!args.apply) continue;

    let response = existing;
    if (!response) {
      const userInfo = await slackService.getUserInfo(userId).catch(() => null);
      response = await Response.create({
        standupId: standup._id,
        teamId: standup.teamId,
        channelId: standup.channelId,
        userId,
        username: userInfo?.name || userId,
        userDisplayName: userInfo?.profile?.display_name || userInfo?.real_name || userId,
        messageTs: last.ts,
        threadTs: standup.threadTs,
        submittedAt,
        isLate: !!(standup.responseDeadline && submittedAt > standup.responseDeadline)
      });
    }

    // Replaying every message is idempotent: a timestamp already recorded is
    // replaced rather than duplicated, so the reply ends up as the full thread.
    for (const message of usable) {
      response.recordMessage(message.ts, message.text);
    }
    response.messageTs = last.ts;

    // A recovered message that predates what was stored is when this person
    // actually answered, so the timing has to move with it.
    if (submittedAt < response.submittedAt) {
      response.submittedAt = submittedAt;
      response.isLate = !!(standup.responseDeadline && submittedAt > standup.responseDeadline);
      response.calculateResponseTime(standup.startedAt);
    }
    if (usable.length > 1) {
      response.isEdited = true;
    }
    await response.save();

    if (existing) {
      // The answer already carried a checkmark; mark the additions instead of
      // stamping a second one on the same thread.
      for (const message of missing) {
        await addReactionQuietly(slackService, standup.channelId, message.ts, 'pencil2');
      }
    } else {
      await addReactionQuietly(slackService, standup.channelId, first.ts, 'white_check_mark');
      for (const later of usable.slice(1)) {
        await addReactionQuietly(slackService, standup.channelId, later.ts, 'pencil2');
      }
    }
  }

  // Rebuild from the responses themselves, which is the only trustworthy source
  // after concurrent writes overwrote one another.
  const stored = await Response.findByStandupId(standup._id);
  const actual = [...new Set(stored.map(r => r.userId))];
  const drifted = actual.length !== standup.actualParticipants.length;

  if (drifted) {
    report.statsRepaired.push({
      standupId: String(standup._id),
      channelId: standup.channelId,
      before: standup.actualParticipants.length,
      after: actual.length
    });
  }

  if (args.apply) {
    standup.actualParticipants = actual;
    standup.updateStats();
    await standup.save();
  }

  report.standupsScanned++;
}

async function addReactionQuietly(slackService, channel, timestamp, name) {
  try {
    await slackService.app.client.reactions.add({ channel, timestamp, name });
  } catch (error) {
    const reason = error?.data?.error || error?.message;
    if (reason !== 'already_reacted') {
      console.warn(`⚠️ Could not react :${name}: on ${channel}/${timestamp}: ${reason}`);
    }
  }
}

function printReport(report, args) {
  const mode = args.apply ? 'APPLIED' : 'DRY RUN — nothing was written';
  console.log(`\n=== Backfill report (${mode}) ===`);
  console.log(`Standups scanned:        ${report.standupsScanned}`);
  const created = report.recovered.filter(r => !r.merged).length;
  const merged = report.recovered.filter(r => r.merged).length;
  console.log(`Replies recovered:       ${created}`);
  console.log(`Replies completed:       ${merged} (messages added to an existing reply)`);
  console.log(`Already stored:          ${report.alreadyStored}`);
  console.log(`Skipped (not expected):  ${report.skippedNotExpected}`);
  console.log(`Skipped (no content):    ${report.skippedEmpty}`);
  console.log(`Standups with drifted participant counts: ${report.statsRepaired.length}`);

  if (report.recovered.length > 0) {
    console.log('\nRecovered replies:');
    for (const r of report.recovered) {
      const kind = r.merged ? `+${r.messages} msg` : 'new';
      console.log(`  ${r.channelId}  ${r.userId}  ${r.submittedAt.toISOString()}  [${kind}]  ${r.preview}`);
    }
  }

  if (report.statsRepaired.length > 0) {
    console.log('\nParticipant counts corrected:');
    for (const s of report.statsRepaired) {
      console.log(`  ${s.channelId}  standup ${s.standupId}  ${s.before} -> ${s.after}`);
    }
  }

  if (!args.apply && (report.recovered.length > 0 || report.statsRepaired.length > 0)) {
    console.log('\nRe-run with --apply to write these changes.');
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is required');
  }

  await database.connect();

  // A bare web client: this must not open a socket or register handlers.
  const slackService = new SlackService({ client: new WebClient(token) });

  const standups = await findStandups(args);
  console.log(`Found ${standups.length} standup(s) to inspect`);

  const report = {
    standupsScanned: 0,
    recovered: [],
    alreadyStored: 0,
    skippedNotExpected: 0,
    skippedEmpty: 0,
    statsRepaired: []
  };

  for (const standup of standups) {
    if (!standup.threadTs) continue;
    try {
      await backfillStandup(standup, slackService, args, report);
    } catch (error) {
      console.error(`❌ Standup ${standup._id} (${standup.channelId}): ${error?.data?.error || error.message}`);
    }
  }

  printReport(report, args);
  await database.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  });
}

module.exports = { parseArgs, parseSince, humanReplies, groupByUser, backfillStandup };
