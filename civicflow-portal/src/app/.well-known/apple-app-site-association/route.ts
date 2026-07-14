import { getServerEnv } from "@/lib/env";

/**
 * iOS universal link verification. Served unauthenticated, no extension, as
 * required by Apple. APPLE_APP_ID must be "<TeamID>.<BundleIdentifier>" once
 * the app is enrolled in the Apple Developer Program — the real bundle
 * identifier is com.aphtechnologies.unestra (see civicflow-mobile/app.json);
 * the "TEAMID" prefix here is a placeholder until the Apple Developer Team ID
 * is known, at which point set the full value via the APPLE_APP_ID env var.
 */
export async function GET() {
  const env = getServerEnv();
  const appId = env.APPLE_APP_ID || "TEAMID.com.aphtechnologies.unestra";

  return Response.json(
    {
      applinks: {
        apps: [],
        details: [
          {
            appIDs: [appId],
            components: [
              { "/": "/report-payment", comment: "Report a dues payment" },
              { "/": "/dues", comment: "Dues status" },
              { "/": "/announcements", comment: "Announcements" },
              { "/": "/events", comment: "Events" },
              { "/": "/organization/*", comment: "Switch organization" },
              { "/": "/accept-invite", comment: "Accept member app invite" },
            ],
          },
        ],
      },
    },
    { headers: { "Content-Type": "application/json" } }
  );
}
