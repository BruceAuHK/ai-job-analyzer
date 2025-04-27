import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moved out of experimental as per Next.js 15.3 warning
  serverExternalPackages: [
    // 'chrome-aws-lambda', // Removed - let Next.js bundle it?
    'puppeteer-core', // Keep puppeteer-core external if needed
  ],
  /* other config options here */
};

export default nextConfig;
