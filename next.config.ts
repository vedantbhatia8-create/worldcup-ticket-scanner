import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright + bundled Chromium must load from node_modules at runtime,
  // not be inlined by the bundler.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
