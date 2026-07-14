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
