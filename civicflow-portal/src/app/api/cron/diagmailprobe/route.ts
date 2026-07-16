import { sendEmail } from "@/lib/mail";

/**
 * TEMPORARY diagnostic route — added to directly observe the SMTP send
 * outcome (bypassing an unreliable application-log pipeline during the
 * 2026-07-16 email-delivery investigation). Delete this file once that
 * investigation concludes; it must never remain in production long-term.
 */
const DIAG_TOKEN = "40a65746824e34067378e838fd3bdc6be4ae22c88730550c6f7e7b952b4e93fa";

export async function GET(request: Request) {
  const token = request.headers.get("x-diag-token");
  if (token !== DIAG_TOKEN) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const to = new URL(request.url).searchParams.get("to");
  if (!to) {
    return Response.json({ error: "missing ?to=" }, { status: 400 });
  }

  try {
    const result = await sendEmail({
      to,
      subject: "[Diagnostic] Unestra mail probe — safe to ignore",
      text: "This is a one-time diagnostic message sent while investigating password-reset email delivery. No action needed.",
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const err = error as { code?: string; responseCode?: number; response?: string; command?: string; message?: string };
    return Response.json({
      ok: false,
      error: {
        code: err.code,
        responseCode: err.responseCode,
        command: err.command,
        response: err.response?.slice(0, 500),
        message: err.message,
      },
    });
  }
}
