import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'playwright-aws-lambda',
  ],
  /* other config options here */
};

export default nextConfig; 