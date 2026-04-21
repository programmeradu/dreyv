// Shim for viem/chains to work around package.json exports resolution issue
// under certain TypeScript module resolution settings.
declare module "viem/chains" {
  export * from "viem/chains/index";
}
