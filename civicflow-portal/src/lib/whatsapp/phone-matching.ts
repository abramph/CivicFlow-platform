import { prisma } from "@/lib/prisma";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * OrgMember.whatsappPhoneNumber is normalized to E.164 at opt-in time (see
 * lib/phone.ts's normalizeToE164, used throughout whatsapp-service.ts), but
 * matches by digits-only anyway — same defensive approach as the SMS
 * webhook's findMembersByPhone, in case a row was ever set by a path that
 * didn't normalize. Returns organizationId alongside id since a shared/
 * reused phone number can match members across different organizations,
 * and each match needs its own org-scoped audit event.
 *
 * The `\\D` below is deliberate — a literal single-backslash '\D' inside a
 * JS/TS template literal is not a recognized escape sequence, so the parser
 * silently drops the backslash, sending Postgres the literal character `D`
 * instead of the non-digit regex metacharacter. That exact bug shipped
 * (mirrored from the pre-existing SMS webhook) and was only caught by a
 * real-database test — see whatsapp-phone-matching.integration.test.ts.
 */
export async function findMembersByWhatsAppPhone(from: string): Promise<{ id: string; organizationId: string }[]> {
  const fullDigits = digitsOnly(from);
  const last10Digits = fullDigits.slice(-10);
  return prisma.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT id, "organizationId" FROM "OrgMember"
    WHERE "whatsappPhoneNumber" IS NOT NULL
      AND regexp_replace("whatsappPhoneNumber", '\\D', '', 'g') IN (${fullDigits}, ${last10Digits})
  `;
}
