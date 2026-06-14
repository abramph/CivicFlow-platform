import nodemailer from "nodemailer";
import { getServerEnv, isEmailSendEnabled } from "@/lib/env";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
};

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const env = getServerEnv();

  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: Number(env.SMTP_PORT) === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return cachedTransporter;
}

export async function sendEmail(input: SendEmailInput) {
  const env = getServerEnv();

  // Safe dev mode: never send emails unless explicitly enabled.
  if (!isEmailSendEnabled()) {
    return {
      sent: false,
      skipped: true,
      reason: "ENABLE_EMAIL_SEND is not enabled",
    };
  }

  const transporter = getTransporter();
  const result = await transporter.sendMail({
    from: env.FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  } as nodemailer.SendMailOptions);

  return {
    sent: true,
    skipped: false,
    messageId: (result as { messageId?: string }).messageId,
  };
}

export async function sendReceiptEmail(params: {
  to: string;
  receiptNumber: string;
  amount: string;
  date: string;
  downloadUrl?: string;
}) {
  const subject = `Your CivicFlow Receipt ${params.receiptNumber}`;
  const text = [
    `Receipt Number: ${params.receiptNumber}`,
    `Amount: ${params.amount}`,
    `Date: ${params.date}`,
    params.downloadUrl ? `Download: ${params.downloadUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendEmail({
    to: params.to,
    subject,
    text,
  });
}

export async function sendReminderEmail(params: {
  to: string;
  reminderType: string;
  subject?: string;
  body: string;
}) {
  return sendEmail({
    to: params.to,
    subject: params.subject ?? `CivicFlow Reminder: ${params.reminderType}`,
    text: params.body,
  });
}

export async function sendVerificationEmail(params: { to: string; verifyUrl: string }) {
  const subject = "Verify your CivicFlow email address";
  const text = [
    "Welcome to CivicFlow!",
    "",
    "Click the link below to verify your email address. The link expires in 24 hours.",
    "",
    params.verifyUrl,
    "",
    "If you did not create a CivicFlow account, you can safely ignore this email.",
  ].join("\n");
  const html = `
    <p>Welcome to <strong>CivicFlow</strong>!</p>
    <p>Click the button below to verify your email address. The link expires in 24 hours.</p>
    <p style="margin:24px 0">
      <a href="${params.verifyUrl}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
        Verify Email Address
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px">Or copy this link: ${params.verifyUrl}</p>
    <p style="color:#6b7280;font-size:13px">If you did not create a CivicFlow account, you can safely ignore this email.</p>
  `.trim();
  return sendEmail({ to: params.to, subject, text, html });
}

export async function sendPasswordResetEmail(params: { to: string; resetUrl: string }) {
  const subject = "Reset your CivicFlow password";
  const text = [
    "You requested a password reset for your CivicFlow account.",
    "",
    "Click the link below to set a new password. The link expires in 30 minutes.",
    "",
    params.resetUrl,
    "",
    "If you did not request a password reset, you can safely ignore this email.",
  ].join("\n");
  const html = `
    <p>You requested a password reset for your <strong>CivicFlow</strong> account.</p>
    <p>Click the button below to set a new password. The link expires in 30 minutes.</p>
    <p style="margin:24px 0">
      <a href="${params.resetUrl}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
        Reset Password
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px">Or copy this link: ${params.resetUrl}</p>
    <p style="color:#6b7280;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p>
  `.trim();
  return sendEmail({ to: params.to, subject, text, html });
}
