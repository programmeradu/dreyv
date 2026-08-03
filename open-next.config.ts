import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

export default defineCloudflareConfig({
  default: {
    minify: true,
  },
  build: {
    esbuild: {
      external: ["uncrypto", "isows"],
    },
  },
});
