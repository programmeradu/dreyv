import React from "react";

export const TelegramLogo: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 240 240" className={className} aria-hidden>
    <defs>
      <linearGradient id="tg-bg" x1=".667" x2=".417" y1=".167" y2=".75">
        <stop offset="0" stopColor="#37aee2" />
        <stop offset="1" stopColor="#1e96c8" />
      </linearGradient>
    </defs>
    <circle cx="120" cy="120" r="120" fill="url(#tg-bg)" />
    <path fill="#c8daea" d="M98 175c-3.9 0-3.2-1.5-4.6-5.2L82 132.2 170 80" />
    <path fill="#a9c9dd" d="M98 175c3 0 4.3-1.4 6-3l16-15.6-19.9-12" />
    <path fill="#fff" d="M100.1 144.4l48.2 35.6c5.5 3 9.5 1.5 10.9-5.1l19.7-92.9c2-8.1-3.1-11.7-8.4-9.3L55 119.7c-7.9 3.2-7.9 7.6-1.4 9.5l29.6 9.2 68.5-43.2c3.2-2 6.2-.9 3.8 1.2" />
  </svg>
);

export const SlackLogo: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 122.8 122.8" className={className} aria-hidden>
    <path fill="#e01e5a" d="M25.8 77.6a12.9 12.9 0 11-12.9-12.9h12.9zm6.5 0a12.9 12.9 0 0125.8 0v32.3a12.9 12.9 0 11-25.8 0z" />
    <path fill="#36c5f0" d="M45.2 25.8a12.9 12.9 0 1112.9-12.9v12.9zm0 6.5a12.9 12.9 0 010 25.8H12.9a12.9 12.9 0 010-25.8z" />
    <path fill="#2eb67d" d="M97 45.2a12.9 12.9 0 1112.9 12.9H97zm-6.5 0a12.9 12.9 0 11-25.8 0V12.9a12.9 12.9 0 1125.8 0z" />
    <path fill="#ecb22e" d="M77.6 97a12.9 12.9 0 11-12.9 12.9V97zm0-6.5a12.9 12.9 0 010-25.8h32.3a12.9 12.9 0 010 25.8z" />
  </svg>
);
