// Shim for viem/chains to work around package.json exports resolution issue.
declare module "viem/chains" {
  const chains: any;
  export = chains;
  export const mainnet: any;
  export const base: any;
  export const arbitrum: any;
  export const polygon: any;
  export const bsc: any;
  export const optimism: any;
  export const sepolia: any;
  export const baseSepolia: any;
  export const arbitrumSepolia: any;
  export const polygonMumbai: any;
}
