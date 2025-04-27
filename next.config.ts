import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'chrome-aws-lambda',
    'puppeteer-core',
  ],
  /* other config options here */
};

export default nextConfig;
