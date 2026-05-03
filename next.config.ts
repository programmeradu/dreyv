import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
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
    return [
      {
        // Cross-origin isolation for WebContainers (Vite-in-browser) — scoped to
        // the dedicated host route so it does NOT affect /app/studio itself
        // (would break Phantom embedded wallet, GitHub OAuth popup, etc.).
        source: "/app/studio/wc-host/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Allow Phantom embedded wallet iframe (Track A of Phantom SDK migration)
          // + WebContainer preview iframe (webcontainer-api.io) used by /app/studio.
          {
            key: "Content-Security-Policy",
            value: "frame-src 'self' https://*.phantom.app https://connect.phantom.app https://*.webcontainer-api.io https://*.local-credentialless.webcontainer-api.io;",
          },
        ],
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // allowedDevOrigins: ['192.168.227.1:3000'],
  },
  serverExternalPackages: [
    'drizzle-orm',
    '@neondatabase/serverless',
  ],
  webpack: (config, { isServer }) => {
    // Disable persistent cache when disk is constrained (e.g. Vercel build)
    if (process.env.NEXT_DISABLE_WEBPACK_CACHE) {
      config.cache = false;
    }
    // Prevent drizzle-orm circular init error in client bundles.
    // Server actions use "use server" but drizzle-orm's ESM star-exports
    // can leak into client chunks and fail with TDZ errors.
    if (!isServer) {
      config.resolve = config.resolve || {};
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