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
  "@webcontainer/api",
  // Syntax highlighting (can be large with language grammars)
  "react-syntax-highlighter",
  // Charting libraries - removed due to transpilePackages conflict
  // "recharts",
  // Animation libraries
  "framer-motion",
  // Animation libraries
  "embla-carousel-react",
  // Icons
  "react-icons",
  "lucide-react",
  // OG image generation (large WASM binaries) - stubbed in next.config instead
  // "@vercel/og",
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
