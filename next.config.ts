import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    const coiHeaders = [
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "cross-origin-isolated=(self)" },
    ];
    return [
      // Cross-origin isolation for WebContainers — must apply to the top-level
      // Studio document AND the hidden wc-host iframe. Use (.*) so bare path
      // and any sub-segment are both covered (Next's :path* can miss the bare
      // path in some matchers, so be explicit).
      {
        source: "/app/studio",
        headers: coiHeaders,
      },
      {
        source: "/app/studio/wc-host",
        headers: coiHeaders,
      },
      {
        source: "/app/studio/wc-host/:path*",
        headers: coiHeaders,
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