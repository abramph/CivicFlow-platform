const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const nodemailer = require('nodemailer');

const { initializeDatabase, getDatabase, closeDatabase } = require('../src/main/db');
const { registerIpcHandlers } = require('../src/main/ipc-handlers');

async function run() {
  await app.whenReady();

  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'civicflow-reminder-smoke-'));
  app.setPath('userData', tempUserData);

  initializeDatabase();
  registerIpcHandlers();

  const db = getDatabase();
  db.prepare("UPDATE categories SET monthly_dues_cents = 5000").run();

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const joinDate = twoMonthsAgo.toISOString().slice(0, 10);

  const insertMember = db.prepare(`
    INSERT INTO members (first_name, last_name, email, status, category_id, join_date, organization_id)
    VALUES (?, ?, ?, 'active', (SELECT id FROM categories ORDER BY id ASC LIMIT 1), ?, 1)
  `);

  const validId = Number(insertMember.run('Delinquent', 'Valid', 'valid@example.com', joinDate).lastInsertRowid);
  const secondValidId = Number(insertMember.run('Delinquent', 'Second', 'second@example.com', joinDate).lastInsertRowid);
  insertMember.run('Delinquent', 'Missing', null, joinDate);
  insertMember.run('Delinquent', 'Invalid', 'not-an-email', joinDate);

  const getHandler = (channel) => {
    const handler = ipcMain._invokeHandlers?.get(channel);
    if (typeof handler !== 'function') {
      throw new Error(`Missing handler: ${channel}`);
    }
    return handler;
  };

  const preview = await getHandler('email:getDuesReminderPreview')({}, { recipientGroup: 'all' });
  const queueResult = await getHandler('email:queue')({}, { email_type: 'DUES_REMINDER', recipient_group: 'all' });
  const singleResult = await getHandler('email:sendDuesReminder')({}, {
    id: validId,
    email: 'valid@example.com',
    name: 'Delinquent Valid',
    orgId: 1,
  });

  db.prepare(`
    UPDATE email_settings
    SET from_name = 'CivicFlow',
        from_email = 'noreply@example.com',
        smtp_host = 'smtp.example.com',
        smtp_port = 587,
        smtp_secure = 0,
        smtp_user = 'tester',
        smtp_password_ref = 'secret',
        enabled = 1
    WHERE id = 1
  `).run();

  nodemailer.createTransport = () => ({
    sendMail: async ({ to }) => {
      const recipient = String(to || '').trim().toLowerCase();
      if (recipient.includes('second@example.com')) {
        throw new Error('Simulated SMTP failure');
      }
      return { messageId: `fake-${recipient}` };
    },
  });

  const singleSuccess = await getHandler('email:sendDuesReminder')({}, {
    id: validId,
    email: 'valid@example.com',
    name: 'Delinquent Valid',
    orgId: 1,
  });

  const queueConfigured = await getHandler('email:queue')({}, { email_type: 'DUES_REMINDER', recipient_group: 'all' });
  const processConfigured = await getHandler('email:processOutbox')({});

  console.log(JSON.stringify({
    preview,
    queueResult,
    singleResult,
    singleSuccess,
    queueConfigured,
    processConfigured,
    ids: { validId, secondValidId },
  }, null, 2));

  closeDatabase();
  await app.quit();
}

run().catch((error) => {
  console.error(error);
  closeDatabase();
  app.exit(1);
});
