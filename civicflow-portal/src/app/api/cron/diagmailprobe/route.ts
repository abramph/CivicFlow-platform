import { sendEmail } from "@/lib/mail";

/**
 * TEMPORARY diagnostic route — added to directly observe the SMTP send
 * outcome (bypassing an unreliable application-log pipeline during the
 * 2026-07-16 email-delivery investigation). Delete this file once that
 * investigation concludes; it must never remain in production long-term.
 */
const DIAG_TOKEN = "b8f2e7a1c93d4560f7e2a8b6d1c4e9f03a5b7c8d2e1f4a6b9c0d3e5f7a8b1c2d";

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
      subject: "[Diagnostic 2] Unestra mail probe — safe to ignore",
      text: "Second diagnostic message, testing the new sender address. No action needed.",
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
