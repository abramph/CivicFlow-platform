import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";

// Align Prisma CLI env loading with Next.js's own precedence. loadEnvConfig's
// second argument controls this: omitting it defaults to production-mode
// file order (.env.production.local > .env.local > .env.production > .env),
// which never looks at .env.development.local at all -- silently resolving
// bare `npx prisma ...` commands to whatever .env.local points at (which may
// be production). Passing dev: true unless NODE_ENV is explicitly
// "production" makes Prisma CLI match `next dev`'s own behavior locally,
// while the real production deploy (.do/app.yaml sets NODE_ENV=production
// before `npm run db:deploy`) is unaffected.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "prisma/schema.prisma",
});
