import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
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
  async rewrites() {
    return [
      {
        source: "/.well-known/dns-aid/zone.txt",
        destination: "/.well-known/dns-aid-zone.txt",
      },
    ];
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
    // Top-level Studio document: use `credentialless` so cross-origin
    // resources without CORP headers (Stripe, dicebear avatars, third-party
    // images, RPCs) still load while keeping crossOriginIsolated=true. A
    // credentialless parent can embed a require-corp child iframe — that
    // combo is what WebContainers needs.
    const coiParentHeaders = [
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "cross-origin-isolated=(self)" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
    ];
    // Hidden wc-host iframe: WebContainer's worker requires strict
    // `require-corp` to transfer SharedArrayBuffer reliably.
    const coiHostHeaders = [
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "cross-origin-isolated=(self)" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
    ];
    return [
      {
        source: "/app/studio",
        headers: coiParentHeaders,
      },
      {
        source: "/app/studio/wc-host",
        headers: coiHostHeaders,
      },
      {
        source: "/app/studio/wc-host/:path*",
        headers: coiHostHeaders,
      },

      {
        source: "/:path*",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Allow Phantom embedded wallet iframe (Track A of Phantom SDK migration)
          // + WebContainer preview iframe (webcontainer-api.io) used by /app/studio.
          // frame-ancestors 'self' provides modern clickjacking protection alongside X-Frame-Options.
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
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // allowedDevOrigins: ['192.168.227.1:3000'],
  },
  serverExternalPackages: [
    'drizzle-orm',
    '@neondatabase/serverless',
    'ffmpeg-static',
  ],
  webpack: (config, { isServer }) => {
    // Disable persistent cache when disk is constrained (e.g. Vercel build)
    if (process.env.NEXT_DISABLE_WEBPACK_CACHE) {
      config.cache = false;
    }
    // Prevent drizzle-orm circular init error in client bundles.
    // Server actions use "use server" but drizzle-orm's ESM star-exports
    // can leak into client chunks and fail with TDZ errors.
    // MetaMask SDK imports this React Native–only package on both server and
    // client bundle paths; stub it everywhere so webpack resolves.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    // Prevent drizzle-orm circular init error in client bundles.
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'drizzle-orm': require.resolve('./src/lib/drizzle-client-stub.js'),
      };
      // Node builtin fallbacks for browser bundles (Coinbase Wallet SDK,
      // eth-json-rpc-filters, etc. transitively reference node:* modules).
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        os: false,
        path: false,
        child_process: false,
        worker_threads: false,
      };
      // Some libs import `node:*` prefix — normalize to bare specifiers
      // so the fallbacks above (and webpack's own resolution) apply.
      config.plugins = config.plugins || [];
    }
    if (!isServer && process.env.VISUAL_EDITS_ENABLED) {
      // Disabled to prevent restart loop - enable only when needed
      // config.module.rules.push({
      //   test: /\.(jsx?|tsx?)$/,
      //   exclude: /node_modules/,
      //   use: [{ loader: "./component-tagger-loader.js" }],
      // });
    }
    return config;
  },
};

export default nextConfig;