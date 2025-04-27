import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moved out of experimental as per Next.js 15.3 warning
  serverExternalPackages: [
    'chrome-aws-lambda', // Added back - seemed to cause map file build errors when removed
    'puppeteer-core', // Keep puppeteer-core external if needed
  ],
  /* other config options here */
};

export default nextConfig;
