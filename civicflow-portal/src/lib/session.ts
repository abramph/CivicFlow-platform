import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { PortalSession } from "@/lib/apiClient";
import { authOptions } from "@/lib/authOptions";

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
