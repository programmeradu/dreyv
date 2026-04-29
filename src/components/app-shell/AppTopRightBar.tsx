"use client";

/**
 * AppTopRightBar — floats in the top-right of the /app canvas.
 *
 * Houses team switcher + wallet connect/display + notifications. Lives outside
 * the hero so the carousel and headline don't have to fight for the same
 * vertical band.
 */

import { WalletButton } from "@/components/WalletButton";
import { NotificationBell } from "@/components/NotificationBell";
import { TeamSwitcher } from "@/components/team/TeamSwitcher";

export function AppTopRightBar() {
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 sm:right-6 sm:top-5">
      <div className="pointer-events-auto hidden sm:block">
        <TeamSwitcher />
      </div>
      <div className="pointer-events-auto">
        <NotificationBell />
      </div>
      <div className="pointer-events-auto">
        <WalletButton />
      </div>
    </div>
  );
}
