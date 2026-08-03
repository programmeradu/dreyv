import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

export default defineCloudflareConfig({
  build: {
    esbuildOptions: {
      plugins: [
        {
          name: "opennext-aliases",
          setup(build) {
            build.onResolve({ filter: /^(@x402\/svm|@x402\/core|uncrypto|isows)/ }, (args) => {
              const root = process.cwd();
              if (args.path.startsWith("@x402/svm") || args.path.startsWith("@x402/core")) {
                return { path: root + "/src/lib/empty-module.js" };
              }
              if (args.path === "uncrypto") {
                return { path: root + "/src/lib/uncrypto-stub.js" };
              }
              if (args.path === "isows") {
                return { path: root + "/src/lib/isows-stub.js" };
              }
            });
          },
        },
      ],
    },
  },
});
