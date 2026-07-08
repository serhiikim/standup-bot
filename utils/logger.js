const fs = require('fs');
const path = require('path');
const util = require('util');
const rfs = require('rotating-file-stream');

// Wraps console.* so every log line also lands in a daily-rotating file on
// disk (utils/logger.js, not just Docker's per-container log driver). That
// file lives on the `./logs:/app/logs` volume already declared in
// docker-compose.yml, so history survives container recreation on deploy,
// unlike `docker logs` which is tied to the container instance.

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '60', 10);

fs.mkdirSync(LOG_DIR, { recursive: true });

const original = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console)
};

const stream = rfs.createStream('app.log', {
  path: LOG_DIR,
  interval: '1d',
  maxFiles: RETENTION_DAYS,
  compress: 'gzip'
});

// A stream 'error' (disk full, permission denied, rotation failure) is
// otherwise unhandled and would throw, crashing the process via the
// uncaughtException handler in app.js — a logging hiccup shouldn't take
// the bot down.
stream.on('error', (err) => {
  original.error('Logger stream error:', err);
});

function formatArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  // util.inspect matches what Node prints to the real console (multi-line
  // objects, depth) and, unlike JSON.stringify, doesn't throw on circular refs.
  return util.inspect(arg, { depth: 4 });
}

function writeLine(level, args) {
  const timestamp = new Date().toISOString();
  const message = args.map(formatArg).join(' ');
  stream.write(`[${timestamp}] [${level}] ${message}\n`);
}

console.log = (...args) => {
  original.log(...args);
  writeLine('INFO', args);
};

console.error = (...args) => {
  original.error(...args);
  writeLine('ERROR', args);
};

console.warn = (...args) => {
  original.warn(...args);
  writeLine('WARN', args);
};

console.info = (...args) => {
  original.info(...args);
  writeLine('INFO', args);
};

console.debug = (...args) => {
  original.debug(...args);
  writeLine('DEBUG', args);
};

module.exports = { LOG_DIR, RETENTION_DAYS };
