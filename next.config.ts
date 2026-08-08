import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for Docker / Cloudflare Containers deployment
  output: "standalone",

  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    "/api/admin/migrations/run": [
      "node_modules/**",
      ".next/**",
      "public/**",
      "src/**",
      "contracts/**",
      "programs/**",
      "mini-apps/**",
      "packages/**",
      "workers/**",
      "scripts/**",
      "supabase/**",
      ".git/**",
      "*.csv",
    ],
  },
  outputFileTracingIncludes: {
    "/api/admin/migrations/run": [
      "db-migrations/**/*.sql",
      "migrations/sql/**/*.sql",
    ],
    "/api/studio/video/render": [
      "node_modules/ffmpeg-static/**/*",
    ],
    "/api/inngest": [
      "node_modules/ffmpeg-static/**/*",
    ],
  },
  async redirects() {
    return [
      {
        source: "/guides/command-ops-for-web3-treasuries",
        destination: "/guides/intent-driven-treasury-solana",
        permanent: true,
      },
    ];
  },
  async headers() {
    const coiParentHeaders = [
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "cross-origin-isolated=(self)" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
    ];
    const coiHostHeaders = [
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "cross-origin-isolated=(self)" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
    ];
    return [
      { source: "/app/studio", headers: coiParentHeaders },
      { source: "/app/studio/wc-host", headers: coiHostHeaders },
      { source: "/app/studio/wc-host/:path*", headers: coiHostHeaders },
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; frame-src 'self' https://*.phantom.app https://connect.phantom.app https://*.webcontainer-api.io https://*.local-credentialless.webcontainer-api.io https://stackblitz.com https://*.stackblitz.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com;",
          },
        ],
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
  },
  serverExternalPackages: [
    'drizzle-orm',
    '@neondatabase/serverless',
    'ffmpeg-static',
  ],
  webpack: (config, { isServer }) => {
    if (process.env.NEXT_DISABLE_WEBPACK_CACHE) {
      config.cache = false;
    }
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // Client-side only: stub drizzle-orm to prevent server code leaking to browser bundles
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'drizzle-orm': false,
      };
    }

    return config;
  },
};

export default nextConfig;