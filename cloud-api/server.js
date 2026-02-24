const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
require('./db/database');

const createPaymentRoutes = require('./routes/paymentRoutes');
const { requireApiKey } = require('./middleware/validateRequest');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 8787);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://civicflow.app';
const logsDir = path.join(__dirname, 'logs');
const accessLogPath = path.join(logsDir, 'access.log');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const requestCounters = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;

app.disable('x-powered-by');
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  const line = `${new Date().toISOString()} ${req.method} ${req.originalUrl}`;
  // eslint-disable-next-line no-console
  console.log(line);
  fs.appendFile(accessLogPath, `${line}\n`, () => {});
  next();
});

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || 'unknown';
  const now = Date.now();
  const state = requestCounters.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + RATE_WINDOW_MS;
  }
  state.count += 1;
  requestCounters.set(ip, state);
  if (state.count > RATE_MAX) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded. Try again shortly.' });
  }
  next();
});

app.use('/api', createPaymentRoutes(requireApiKey));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (_req, res) => {
  res.redirect('/report-payment.html');
});

app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Cloud payment API running on port ${PORT}`);
});
