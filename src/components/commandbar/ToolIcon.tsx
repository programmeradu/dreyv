"use client";

// Mascot-themed tool icon: small Dreyv mascot avatar with a tiny lucide glyph
// badge indicating the tool category. Replaces the previous emoji icons that
// felt generic across the app.

import Image from "next/image";
import {
  ArrowLeftRight,
  Send,
  Lock,
  Waypoints,
  PiggyBank,
  Banknote,
  Scale,
  Users,
  ShieldCheck,
  Landmark,
  CalendarClock,
  Eye,
  Telescope,
  Radar,
  Search,
  FileCode2,
  MessageSquareText,
  Microscope,
  Store,
  Plug,
  Compass,
  Crosshair,
  FlaskConical,
  Satellite,
  Sprout,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

type Mascot = "think" | "alert" | "celebrate" | "greet";

const MASCOT_SRC: Record<Mascot, string> = {
  think: "/mascot/dreyv-think.png",
  alert: "/mascot/dreyv-alert.png",
  celebrate: "/mascot/dreyv-celebrate.png",
  greet: "/mascot/dreyv-greet.png",
};

interface ToolIconMeta {
  glyph: LucideIcon;
  mascot: Mascot;
}

const TOOL_ICONS: Record<string, ToolIconMeta> = {
  swap: { glyph: ArrowLeftRight, mascot: "greet" },
  execute_swap: { glyph: ArrowLeftRight, mascot: "greet" },
  transfer: { glyph: Send, mascot: "greet" },
  stake: { glyph: Lock, mascot: "think" },
  bridge: { glyph: Waypoints, mascot: "think" },
  yield_deposit: { glyph: PiggyBank, mascot: "celebrate" },
  yield_withdraw: { glyph: Banknote, mascot: "think" },
  rebalance: { glyph: Scale, mascot: "think" },
  mass_dispatch: { glyph: Users, mascot: "celebrate" },
  create_multisig: { glyph: ShieldCheck, mascot: "greet" },
  multisig_proposal: { glyph: Landmark, mascot: "alert" },
  execute_dca: { glyph: CalendarClock, mascot: "think" },
  foresight_simulation: { glyph: Telescope, mascot: "think" },
  risk_assessment: { glyph: Radar, mascot: "alert" },
  browser_research: { glyph: Search, mascot: "think" },
  idl_extraction: { glyph: FileCode2, mascot: "think" },
  sentiment_analysis: { glyph: MessageSquareText, mascot: "think" },
  studio_init_miniapp: { glyph: Wrench, mascot: "celebrate" },
  studio_analyze_code: { glyph: Microscope, mascot: "think" },
  security_firewall: { glyph: ShieldCheck, mascot: "alert" },
  marketplace_publish: { glyph: Store, mascot: "celebrate" },
  sdk_hooks: { glyph: Plug, mascot: "think" },
  navigate: { glyph: Compass, mascot: "greet" },
  set_monitor: { glyph: Eye, mascot: "think" },
  deploy_sniper_bot: { glyph: Crosshair, mascot: "alert" },
  protocol_sdk_analyze: { glyph: Microscope, mascot: "think" },
  simulation_firewall: { glyph: ShieldCheck, mascot: "alert" },
  route_simulator: { glyph: FlaskConical, mascot: "think" },
  risk_sentinel: { glyph: Radar, mascot: "alert" },
  mev_guard: { glyph: Satellite, mascot: "alert" },
  token_resolver: { glyph: Search, mascot: "think" },
  treasury_watcher: { glyph: Eye, mascot: "think" },
  yield_optimizer: { glyph: Sprout, mascot: "celebrate" },
};

const FALLBACK: ToolIconMeta = { glyph: Wrench, mascot: "greet" };

interface Props {
  toolName: string;
  size?: "sm" | "md";
  className?: string;
}

export function ToolIcon({ toolName, size = "sm", className = "" }: Props) {
  const meta = TOOL_ICONS[toolName] ?? FALLBACK;
  const Glyph = meta.glyph;
  const dims = size === "md" ? { box: "h-10 w-10", img: 32, badge: "h-4 w-4", icon: "h-2.5 w-2.5" }
                              : { box: "h-7 w-7", img: 22, badge: "h-3.5 w-3.5", icon: "h-2 w-2" };

  return (
    <span className={`relative inline-flex ${dims.box} flex-none items-center justify-center rounded-xl bg-violet-50 ring-1 ring-violet-100 ${className}`}>
      <Image
        src={MASCOT_SRC[meta.mascot]}
        alt=""
        width={dims.img}
        height={dims.img}
        className="object-contain"
        unoptimized
      />
      <span className={`absolute -bottom-0.5 -right-0.5 inline-flex ${dims.badge} items-center justify-center rounded-full bg-violet-600 text-white ring-2 ring-white`}>
        {toolName === "studio_init_miniapp" ? (
          <DreyvStar size={size === "md" ? 10 : 8} className={dims.icon} />
        ) : (
          <Glyph className={dims.icon} strokeWidth={2.5} />
        )}
      </span>
    </span>
  );
}
