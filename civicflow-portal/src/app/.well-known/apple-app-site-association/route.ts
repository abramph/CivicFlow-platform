import { getServerEnv } from "@/lib/env";

/**
 * iOS universal link verification. Served unauthenticated, no extension, as
 * required by Apple. APPLE_APP_ID must be "<TeamID>.<BundleIdentifier>" once
 * the app is enrolled in the Apple Developer Program.
 */
export async function GET() {
  const env = getServerEnv();
  const appId = env.APPLE_APP_ID || "TEAMID.org.civicflowapp.mobile";

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
