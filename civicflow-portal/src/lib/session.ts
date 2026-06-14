import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { PortalSession } from "@/lib/apiClient";
import { authOptions } from "@/lib/authOptions";

/** Legacy portal API-key session (preserved). */
export async function requirePortalSession(): Promise<PortalSession> {
  const session = await getServerSession(authOptions);
  if (!session?.org_id || !session?.api_key) {
    redirect("/login");
  }

  return {
    org_id: session.org_id,
    api_key: session.api_key,
    api_base: session.api_base,
  };
}

/**
 * Read-only helper: returns the current server session or null.
 * Does NOT redirect. Use in layouts/components that conditionally show content.
 */
export async function getOptionalSession() {
  return getServerSession(authOptions);
}
