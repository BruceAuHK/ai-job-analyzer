import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moved out of experimental as per Next.js 15.3 warning
  serverExternalPackages: [
    '@sparticuz/chromium', // Ensure sparticuz is external
    'puppeteer-core',      // Ensure puppeteer-core is external
  ],
  /* other config options here */
};

export default nextConfig;
