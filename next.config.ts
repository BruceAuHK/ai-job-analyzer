import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@sparticuz/chromium',
    'puppeteer-core',
  ],
  /* other config options here */
};

export default nextConfig;
