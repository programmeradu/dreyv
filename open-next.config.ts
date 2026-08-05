import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

const HEAVY_EXTERNALS = [
  // DB / infra
  "drizzle-orm",
  "@neondatabase/serverless",
  // Solana stack
  "@solana/web3.js",
  "@solana/spl-token",
  "@sqds/multisig",
  "@coral-xyz/anchor",
  "@solana-program/token",
  "@solana-program/system",
  "@solana/kit",
  "helius-sdk",
  // EVM stack
  "viem",
  "ethers",
  "wagmi",
  "@wagmi/core",
  // Coinbase / Base
  "@coinbase/coinbase-sdk",
  "@coinbase/cdp-sdk",
  "@base-org/account",
  // Crypto polyfills
  "uncrypto",
  "isows",
  // AI SDKs
  "ai",
  "@ai-sdk/groq",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  // Studio / PDF
  "ffmpeg-static",
  "@babel/standalone",
  "@react-pdf/renderer",
  "jspdf",
  "jspdf-autotable",
  "archiver",
  "@codesandbox/sandpack-react",
  "@monaco-editor/react",
  // OG image generation (large WASM binaries)
  "@vercel/og",
];

export default defineCloudflareConfig({
  default: {
    minify: true,
  },
  build: {
    esbuild: {
      external: HEAVY_EXTERNALS,
    },
  },
});
