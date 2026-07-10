import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright + bundled Chromium must load from node_modules at runtime,
  // not be inlined by the bundler.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Vercel's file tracing misses files these packages read via fs at runtime
  // (e.g. playwright-core/browsers.json). The scrape runs from /api/scan and
  // from the dashboard's Scan Now server action, so include both routes.
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/playwright-core/**", "./node_modules/@sparticuz/chromium/**"],
    "/": ["./node_modules/playwright-core/**", "./node_modules/@sparticuz/chromium/**"],
  },
};

export default nextConfig;
