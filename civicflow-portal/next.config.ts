import type { NextConfig } from "next";

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

export default nextConfig;
