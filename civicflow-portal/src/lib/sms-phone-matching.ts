import { prisma } from "@/lib/prisma";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * OrgMember.phone is free text (manual entry or CSV import) and rarely
 * stored in E.164, while Twilio's `From` always is — so an exact string
 * match would miss most members. Matches by digits only, against either
 * the full number or just the last 10 (to catch a stored number missing
 * its "1" country code), via a raw query since Prisma can't express a
 * normalize-then-compare filter directly. Returns organizationId alongside
 * id since a shared/reused phone number can match members across different
 * organizations, and each match needs its own org-scoped audit event.
 *
 * The `\\D` below is deliberate — a literal single-backslash '\D' inside a
 * JS/TS template literal is not a recognized escape sequence, so the parser
 * silently drops the backslash, sending Postgres the literal character `D`
 * instead of the non-digit regex metacharacter. That exact bug shipped here
 * (unnoticed because every test mocks $queryRaw) and was only caught by a
 * real-database test after the identical mistake was mirrored into the
 * WhatsApp inbound webhook and caught live during PR #58's Twilio Sandbox
 * walkthrough — see sms-phone-matching.integration.test.ts.
 */
export async function findMembersByPhone(from: string): Promise<{ id: string; organizationId: string }[]> {
  const fullDigits = digitsOnly(from);
  const last10Digits = fullDigits.slice(-10);
  return prisma.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT id, "organizationId" FROM "OrgMember"
    WHERE phone IS NOT NULL
      AND regexp_replace(phone, '\\D', '', 'g') IN (${fullDigits}, ${last10Digits})
  `;
}
