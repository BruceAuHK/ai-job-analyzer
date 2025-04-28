import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moved out of experimental as per Next.js 15.3 warning
  serverExternalPackages: [
    'playwright-aws-lambda', // Use playwright-aws-lambda
    // '@sparticuz/chromium', // Ensure sparticuz is external - Removed
    // 'puppeteer-core',      // Ensure puppeteer-core is external - Removed
  ],
  /* other config options here */
};

export default nextConfig;
