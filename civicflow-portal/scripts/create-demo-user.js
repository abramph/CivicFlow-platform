/**
 * One-off: add a real email account to the demo org as ORG_OWNER.
 * Run with: DATABASE_URL="..." node scripts/create-demo-user.js
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
const ORG_SLUG = "sample-org";

if (!EMAIL || !PASSWORD) {
  console.error("Usage: DEMO_EMAIL=you@example.com DEMO_PASSWORD=... node scripts/create-demo-user.js");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    console.error(`Org "${ORG_SLUG}" not found. Run db:seed first.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, emailVerified: true },
    create: { email: EMAIL, displayName: "Demo Owner", passwordHash, emailVerified: true },
  });

  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: { role: "ORG_OWNER" },
    create: { organizationId: org.id, userId: user.id, role: "ORG_OWNER" },
  });

  console.log(`Done: ${EMAIL} is ORG_OWNER of "${org.name}"`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
