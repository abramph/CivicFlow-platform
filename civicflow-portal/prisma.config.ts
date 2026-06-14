import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";

// Align Prisma CLI env loading with Next.js (.env.local first, then .env fallback).
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
});
