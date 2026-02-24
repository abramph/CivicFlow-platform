const nodemailer = require('nodemailer');

function receiptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function buildTransport() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  if (!host || !user || !pass) {
    throw receiptError('SMTP_NOT_CONFIGURED', 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendReceiptEmail({ member_name, email, amount, method, invoice_id }) {
  if (!email) {
    throw receiptError('RECIPIENT_REQUIRED', 'Recipient email is required.');
  }

  const transport = buildTransport();
  const memberName = String(member_name || 'Member').trim();
  const amountText = Number(amount || 0).toFixed(2);
  const methodText = String(method || 'PAYMENT').trim().toUpperCase();
  const invoiceText = String(invoice_id || '').trim() || 'N/A';

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Payment Received - CivicFlow',
    text: `Hello ${memberName},\n\nWe received your payment of $${amountText} via ${methodText}.\n\nInvoice: ${invoiceText}\n\nThank you.`,
  });

  return { success: true };
}

module.exports = {
  sendReceiptEmail,
};
