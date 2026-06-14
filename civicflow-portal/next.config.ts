import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.1.176",
    "http://192.168.1.176:3000",
    "http://localhost:3000",
  ],
  turbopack: {
    root: process.cwd(),
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // Source map uploads require SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
  // Omit those env vars to skip uploads (errors still report at runtime)
});
