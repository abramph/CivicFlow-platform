const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { APP_SLUG } = require('../shared/appConfig.js');

let logPath = null;
let logStream = null;

function getLogPath() {
  if (logPath) return logPath;
  const userData = app.getPath('userData');
  const logsDir = path.join(userData, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logPath = path.join(logsDir, `${APP_SLUG}.log`);
  return logPath;
}

function ensureStream() {
  if (!logStream) {
    logStream = fs.createWriteStream(getLogPath(), { flags: 'a' });
  }
  return logStream;
}

function formatLevel(level) {
  return `[${new Date().toISOString()}] [${level}]`;
}

function log(level, ...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `${formatLevel(level)} ${msg}\n`;
  try {
    ensureStream().write(line);
  } catch (err) {
    console.error('Logger write failed:', err);
  }
  if (level === 'ERROR') {
    console.error(...args);
  } else if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
}

function info(...args) {
  log('INFO', ...args);
}

function error(...args) {
  log('ERROR', ...args);
}

function warn(...args) {
  log('WARN', ...args);
}

module.exports = {
  log,
  info,
  error,
  warn,
};
