import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      // TRADING zone
      { source: '/trades', destination: '/trading?tab=trades', permanent: true },
      { source: '/holdings', destination: '/trading?tab=holdings', permanent: true },
      // INTELLIGENCE zone
      { source: '/signals', destination: '/intelligence?tab=signals', permanent: true },
      { source: '/research', destination: '/intelligence?tab=research', permanent: true },
      { source: '/training', destination: '/intelligence?tab=training', permanent: true },
      // COMMAND zone
      { source: '/control', destination: '/command?tab=control', permanent: true },
      { source: '/ghost', destination: '/command?tab=ghosthq', permanent: true },
      { source: '/reminders', destination: '/command?tab=reminders', permanent: true },
      { source: '/dev-tasks', destination: '/command?tab=devtasks', permanent: true },
      // D3 (2026-04-30) — AUTO API consolidation: legacy /api/auto-trader/*
      // routes redirect to the 3 consolidated /api/auto/* endpoints. The
      // remaining 8 legacy paths (config / equity-curve / activity / analytics
      // / per-ticker / scan-status / slippage / stream) were deleted outright;
      // their consumers all lived in the now-deleted src/components/autotrader/.
      { source: '/api/auto-trader', destination: '/api/auto/state', permanent: true },
      { source: '/api/auto-trader/history', destination: '/api/auto/trades?type=closed&limit=10', permanent: true },
      { source: '/api/auto-trader/per-ticker-thresholds', destination: '/api/auto/config', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    return config;
  },
};

export default nextConfig;
