import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ messageId: "test-message-id" });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    SMTP_HOST: "smtp-relay.brevo.com",
    SMTP_PORT: "587",
    SMTP_USER: "test-user",
    SMTP_PASS: "test-pass",
    FROM_EMAIL: "Unestra Notifications <notifications@getunestra.com>",
  }),
  isEmailSendEnabled: () => true,
}));

describe("sendEmail", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("sends from the configured FROM_EMAIL with Reply-To set to the support mailbox", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await sendEmail({ to: "member@example.org", subject: "Test", text: "Body" });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Unestra Notifications <notifications@getunestra.com>",
        replyTo: "support@getunestra.com",
        to: "member@example.org",
      })
    );
  });
});

/**
 * Security Patch A -- nodemailer header-injection hardening
 * (mail-header-safety.ts, wired into sendEmail() itself so no caller can
 * bypass it). Every send here uses the same mocked, never-real transport
 * as the suite above -- no test in this file ever contacts a real SMTP
 * server.
 */
describe("sendEmail -- header-injection hardening", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("sends normally for an ordinary subject", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await sendEmail({ to: "member@example.org", subject: "Your receipt is ready", text: "Body" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Your receipt is ready" }));
  });

  it("sends normally for a Unicode subject", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await sendEmail({ to: "member@example.org", subject: "Réunion du conseil — 会议记录 📋", text: "Body" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Réunion du conseil — 会议记录 📋" }));
  });

  it("rejects a subject containing a bare CR and never calls the transport", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(sendEmail({ to: "member@example.org", subject: "Hi\rBcc: attacker@evil.example", text: "Body" })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a subject containing a bare LF and never calls the transport", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(sendEmail({ to: "member@example.org", subject: "Hi\nBcc: attacker@evil.example", text: "Body" })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a subject containing a full CRLF header-injection payload and never calls the transport", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(
      sendEmail({ to: "member@example.org", subject: "Hi\r\nBcc: attacker@evil.example\r\nSubject: spoofed", text: "Body" })
    ).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a subject containing a NUL byte", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(sendEmail({ to: "member@example.org", subject: "Hi\x00there", text: "Body" })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects an attachment filename carrying a CRLF injection payload", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(
      sendEmail({
        to: "member@example.org",
        subject: "Test",
        text: "Body",
        attachments: [{ filename: "receipt.pdf\r\nBcc: attacker@evil.example", content: Buffer.from("x") }],
      })
    ).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a recipient address containing CRLF (a malicious organization-controlled value flowing into `to`)", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(sendEmail({ to: "member@example.org\r\nBcc: attacker@evil.example", subject: "Test", text: "Body" })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a recipient that is not a syntactically valid email address, with no control characters involved", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await expect(sendEmail({ to: "not-an-email", subject: "Test", text: "Body" })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("accepts a normal, valid recipient address", async () => {
    const { sendEmail } = await import("@/lib/mail");
    await sendEmail({ to: "treasurer@pinegrovepta.example", subject: "Test", text: "Body" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "treasurer@pinegrovepta.example" }));
  });

  it("never logs the malicious subject text itself when rejecting -- only that validation failed", async () => {
    const { sendEmail } = await import("@/lib/mail");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(sendEmail({ to: "member@example.org", subject: "Hi\r\nBcc: attacker@evil.example", text: "Body" })).rejects.toThrow();
      const loggedText = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
      expect(loggedText).not.toContain("attacker@evil.example");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
