import React from "react";

type LogoProps = { size?: number; className?: string };

export const StripeLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size * 2.4} height={size} viewBox="0 0 60 25" className={className} aria-label="Stripe">
    <rect width="60" height="25" rx="5" fill="#635BFF" />
    <path
      fill="#fff"
      d="M28.5 10.2c0-.7.6-1 1.5-1 1.3 0 3 .4 4.3 1.1V6.4c-1.4-.5-2.8-.8-4.3-.8-3.5 0-5.9 1.8-5.9 4.9 0 4.7 6.5 4 6.5 6 0 .8-.7 1-1.7 1-1.4 0-3.3-.6-4.7-1.4v3.9c1.6.7 3.2 1 4.7 1 3.6 0 6.2-1.8 6.2-4.9-.1-5.1-6.6-4.3-6.6-5.9zM12.2 6h-3.7l-.8 4.1H6.3v3.4h1.2l-.8 4.2c-.5 2.5.7 3.9 3 3.9 1 0 1.9-.2 2.5-.5v-3c-.5.2-1 .3-1.4.3-.7 0-1-.3-.8-1l.6-3.8h2.3v-3.4h-1.7l.6-4.2zM18.4 11.2l-.2-1.1h-3.5v11h4V14c.9-1.2 2.5-1 3-.8V9.6c-.5-.2-2.4-.5-3.3 1.6zM44.3 9.7c-3.2 0-5.4 2.6-5.4 5.8s2.1 5.8 5.4 5.8c2.7 0 4.9-1.6 5.4-3.9h-3.6c-.2.8-.9 1.2-1.7 1.2-1.2 0-2-.9-2-2.3h7.4c.1-.2.1-1 .1-1.3.1-2.9-2-5.3-5.6-5.3zm-1.9 4.5c0-1.2.7-2.2 1.9-2.2s1.8 1 1.8 2.2h-3.7z"
    />
  </svg>
);

export const PaystackLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size * 2.6} height={size} viewBox="0 0 78 30" className={className} aria-label="Paystack">
    <rect width="78" height="30" rx="6" fill="#011B33" />
    <g transform="translate(8 8)">
      <rect width="14" height="2.4" rx="1.2" fill="#00C3F7" />
      <rect y="4" width="14" height="2.4" rx="1.2" fill="#00C3F7" />
      <rect y="8" width="10" height="2.4" rx="1.2" fill="#00C3F7" />
      <rect y="12" width="6" height="2.4" rx="1.2" fill="#00C3F7" />
    </g>
    <text x="28" y="20" fontFamily="ui-sans-serif,system-ui" fontSize="11" fontWeight="700" fill="#fff" letterSpacing="0.5">
      paystack
    </text>
  </svg>
);

export const UsdcLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="USDC">
    <circle cx="16" cy="16" r="16" fill="#2775CA" />
    <path
      fill="#fff"
      d="M20.5 18.2c0-2-1.2-2.7-3.6-3-1.7-.2-2-.7-2-1.5s.6-1.4 1.7-1.4c1 0 1.6.3 1.9 1.1.1.2.2.3.4.3h.9c.3 0 .4-.2.4-.4-.2-1.3-1.3-2.3-2.6-2.5v-1.3c0-.2-.2-.4-.4-.4h-.9c-.2 0-.4.2-.4.4v1.2c-1.7.2-2.8 1.4-2.8 2.8 0 1.9 1.2 2.6 3.5 2.9 1.6.3 2.1.6 2.1 1.6s-.8 1.6-1.9 1.6c-1.5 0-2-.6-2.2-1.3-.1-.3-.2-.4-.4-.4h-.9c-.3 0-.4.2-.4.4.2 1.5 1.2 2.5 3 2.8v1.2c0 .2.2.4.4.4h.9c.2 0 .4-.2.4-.4v-1.2c1.8-.3 2.9-1.5 2.9-3z"
    />
    <path
      fill="#fff"
      d="M12.7 24.3c-4.5-1.6-6.8-6.6-5.1-11 .9-2.5 2.8-4.4 5.1-5.2.2-.1.4-.3.4-.6v-.8c0-.2-.1-.4-.4-.4-.1 0-.1 0-.2.1-5.4 1.7-8.3 7.4-6.6 12.8 1 3.2 3.5 5.6 6.6 6.6.2.1.4 0 .5-.2 0-.1 0-.1 0-.2v-.8c0-.1-.2-.3-.3-.3zm6.5-17.9c-.2-.1-.4 0-.5.2v.1l.1.8c0 .2.2.4.3.5 4.5 1.6 6.8 6.6 5.1 11-.9 2.5-2.8 4.4-5.1 5.2-.2.1-.4.3-.4.6v.8c0 .2.1.4.4.4.1 0 .1 0 .2-.1 5.4-1.7 8.3-7.4 6.6-12.8-1-3.2-3.5-5.7-6.7-6.7z"
    />
  </svg>
);

export const UsdtLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="USDT">
    <circle cx="16" cy="16" r="16" fill="#26A17B" />
    <path
      fill="#fff"
      d="M17.9 14.4v-1.9h4.4V9.6H9.7v2.9h4.4v1.9c-3.6.2-6.3.9-6.3 1.7s2.7 1.5 6.3 1.7v6h3.8v-6c3.6-.2 6.3-.9 6.3-1.7s-2.7-1.5-6.3-1.7zm0 2.9v-.1c-.1 0-.6 0-1.9 0-1 0-1.7 0-2 0v.1c-3.1-.1-5.4-.7-5.4-1.4s2.3-1.2 5.4-1.4v2.2c.3 0 1 0 2 0 1.2 0 1.8 0 1.9 0v-2.2c3.1.1 5.4.7 5.4 1.4s-2.3 1.3-5.4 1.4z"
    />
  </svg>
);

export const SolLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="Solana">
    <defs>
      <linearGradient id="sol-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#9945FF" />
        <stop offset="1" stopColor="#14F195" />
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="16" fill="#0a0a0a" />
    <path fill="url(#sol-g)" d="M8.5 21.2c.2-.2.4-.3.7-.3h13.4c.4 0 .6.5.3.8l-2.6 2.6c-.2.2-.4.3-.7.3H6.2c-.4 0-.6-.5-.3-.8l2.6-2.6zm0-9.7c.2-.2.5-.3.7-.3h13.4c.4 0 .6.5.3.8l-2.6 2.6c-.2.2-.4.3-.7.3H6.2c-.4 0-.6-.5-.3-.8l2.6-2.6zm14.1 4.8c-.2-.2-.4-.3-.7-.3H8.5c-.4 0-.6.5-.3.8l2.6 2.6c.2.2.4.3.7.3h13.4c.4 0 .6-.5.3-.8l-2.6-2.6z" />
  </svg>
);

export const PhantomLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="Phantom">
    <rect width="32" height="32" rx="8" fill="#AB9FF2" />
    <path
      fill="#fff"
      d="M27 16.4c0-6.3-5.1-11.4-11.4-11.4S4.2 10.1 4.2 16.4c0 5.8 4.3 10.5 9.8 11.3v-3c-3.9-.8-6.9-4.2-6.9-8.3 0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5c0 1.3-.3 2.4-.8 3.5-.3.6-.9 1-1.5 1-.5 0-1-.3-1.2-.8-.1-.2-.2-.5-.2-.8v-4.7c0-.4-.3-.7-.7-.7s-.7.3-.7.7v.4c-.6-.7-1.5-1.1-2.5-1.1-2.3 0-4.2 2.2-4.2 4.9s1.9 4.9 4.2 4.9c1.1 0 2.1-.5 2.8-1.4.3 1.1 1.3 1.9 2.5 1.9.9 0 1.7-.4 2.3-1 .5-.5.9-1.2 1.2-1.9.5-1.2.7-2.5.7-3.9zm-11.3 2.9c-1 0-1.8-1-1.8-2.3s.8-2.3 1.8-2.3 1.8 1 1.8 2.3-.8 2.3-1.8 2.3z"
    />
  </svg>
);

export const EthLogo: React.FC<LogoProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="EVM">
    <circle cx="16" cy="16" r="16" fill="#627EEA" />
    <path fill="#fff" fillOpacity=".6" d="M16 4v8.9l7.5 3.4z" />
    <path fill="#fff" d="M16 4l-7.5 12.3 7.5-3.4z" />
    <path fill="#fff" fillOpacity=".6" d="M16 21.9v6.1l7.5-10.4z" />
    <path fill="#fff" d="M16 28v-6.1l-7.5-7.6z" />
    <path fill="#fff" fillOpacity=".2" d="M16 20.6l7.5-4.3-7.5-3.4z" />
    <path fill="#fff" fillOpacity=".6" d="M8.5 16.3l7.5 4.3v-7.7z" />
  </svg>
);

export const ASSET_LOGOS: Record<"usdc" | "usdt" | "sol", React.FC<LogoProps>> = {
  usdc: UsdcLogo,
  usdt: UsdtLogo,
  sol: SolLogo,
};
