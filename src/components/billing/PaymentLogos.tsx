import React from "react";
import Image from "next/image";
import { SiStripe, SiTether, SiSolana, SiEthereum } from "react-icons/si";

type LogoProps = { size?: number; className?: string };

/** Real brand logos. Sources:
 *  - Stripe / Tether / Solana / Ethereum: simple-icons (react-icons/si)
 *  - USDC: spothq/cryptocurrency-icons (official Circle/Centre mark)
 *  - Paystack: official Paystack wordmark SVG
 *  - Phantom: official Phantom brand avatar
 *  Do not replace with hand-drawn approximations.
 */

export const StripeLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <span
    className={className}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#635BFF",
      color: "#fff",
      borderRadius: 6,
      padding: "3px 8px",
      height: size,
    }}
    aria-label="Stripe"
  >
    <SiStripe size={size * 0.7} />
  </span>
);

export const PaystackLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <Image
    src="/brand/paystack.svg"
    alt="Paystack"
    width={Math.round(size * 3.2)}
    height={size}
    className={className}
    style={{ height: size, width: "auto" }}
    unoptimized
  />
);

export const UsdcLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <Image
    src="/brand/usdc.svg"
    alt="USDC"
    width={size}
    height={size}
    className={className}
    unoptimized
  />
);

export const UsdtLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <SiTether size={size} color="#26A17B" className={className} aria-label="Tether USDT" />
);

export const SolLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <Image
    src="/brand/sol.svg"
    alt="Solana"
    width={size}
    height={size}
    className={className}
    unoptimized
  />
);

export const EthLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <SiEthereum size={size} color="#627EEA" className={className} aria-label="Ethereum" />
);

export const SolanaLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <SiSolana size={size} color="#9945FF" className={className} aria-label="Solana" />
);

export const PhantomLogo: React.FC<LogoProps> = ({ size = 22, className }) => (
  <Image
    src="/brand/phantom.png"
    alt="Phantom"
    width={size}
    height={size}
    className={className}
    style={{ borderRadius: 6 }}
    unoptimized
  />
);

export const ASSET_LOGOS: Record<"usdc" | "usdt" | "sol", React.FC<LogoProps>> = {
  usdc: UsdcLogo,
  usdt: UsdtLogo,
  sol: SolLogo,
};
