// Shim for viem/chains — works around exports resolution under bundler moduleResolution.
declare module "viem/chains" {
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
  const _default: any;
  export default _default;
}
