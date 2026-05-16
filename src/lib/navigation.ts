/**
 * TREVOR // NAVIGATION CONTRACT v1
 *
 * Single source of truth for the 5-zone navigation + per-zone sub-tabs.
 * Every nav-rendering component (BottomNav, SidebarRail, TabBar instances,
 * mobile long-press BottomSheet) imports from here. No bespoke zone arrays.
 *
 * Mobile bottom-nav order is the priority order:
 *   1. DASHBOARD (home)
 *   2. AUTO       (Scalper — front and center per Ghost crunch posture)
 *   3. MANUAL     (manual systems that display but never trade — was SCALP/TRADING)
 *   4. INTEL      (learning surface — Lessons / Journal / Similar / Calibration / Shadow)
 *   5. MEMORY     (was COMMAND — Brain / Memory / ChromaDB / System Health / Aggressive)
 *
 * CHAT is a floating action button, NOT a tab. Always available, modal-style
 * full-screen on mobile, side panel on desktop.
 */

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Bot,
  Activity,
  Brain,
  Database,
  MessageSquare,
} from "lucide-react";

export type ZoneId = "dashboard" | "auto" | "manual" | "intel" | "memory";

export type ZoneAccent = "cyan" | "green" | "violet" | "magenta" | "amber";

export interface ZoneSubTab<K extends string = string> {
  key: K;
  label: string;
  badge?: number | string;
}

export interface Zone {
  id: ZoneId;
  href: `/${string}`;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  accent: ZoneAccent;
  subTabs?: ReadonlyArray<ZoneSubTab>;
  defaultSubTab?: string;
}

export const ZONES: ReadonlyArray<Zone> = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: LayoutDashboard,
    accent: "cyan",
  },
  {
    id: "auto",
    href: "/autotrader",
    label: "Auto Trader",
    shortLabel: "Auto",
    icon: Bot,
    accent: "green",
  },
  {
    id: "manual",
    href: "/manual",
    label: "Manual",
    shortLabel: "Manual",
    icon: Activity,
    accent: "violet",
    subTabs: [
      { key: "scalp", label: "Scalp" },
      { key: "stock", label: "Stock" },
      { key: "dca", label: "DCA" },
    ],
    defaultSubTab: "scalp",
  },
  {
    id: "intel",
    href: "/intel",
    label: "Intelligence",
    shortLabel: "Intel",
    icon: Brain,
    accent: "magenta",
    subTabs: [
      { key: "downloads", label: "Downloads" },
      { key: "lessons", label: "Lessons" },
      { key: "journal", label: "Journal" },
      { key: "similar", label: "Similar" },
      { key: "calibration", label: "Calibration" },
      { key: "shadow", label: "Shadow" },
    ],
    defaultSubTab: "downloads",
  },
  {
    id: "memory",
    href: "/memory",
    label: "Memory",
    shortLabel: "Memory",
    icon: Database,
    accent: "cyan",
    subTabs: [
      { key: "brain", label: "Brain" },
      { key: "memory", label: "Memory" },
      { key: "chromadb", label: "ChromaDB" },
      { key: "health", label: "System Health" },
      { key: "aggressive", label: "Aggressive" },
    ],
    defaultSubTab: "brain",
  },
] as const;

export const CHAT_FAB = {
  id: "chat" as const,
  href: "/chat" as const,
  label: "Chat",
  shortLabel: "Chat",
  icon: MessageSquare,
  accent: "cyan" as const,
};

export const LEGACY_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["/trading", "/manual"],
  ["/scalp", "/manual"],
  ["/command", "/memory"],
  ["/intelligence", "/intel"],
] as const;

export function zoneFromPath(pathname: string): Zone | null {
  return (
    ZONES.find(
      (z) =>
        pathname === z.href ||
        pathname.startsWith(z.href + "/") ||
        pathname.startsWith(z.href + "?"),
    ) ?? null
  );
}

export function accentTextClass(accent: ZoneAccent): string {
  switch (accent) {
    case "cyan":
      return "text-accent-cyan";
    case "green":
      return "text-accent-green";
    case "violet":
      return "text-accent-violet";
    case "magenta":
      return "text-accent-magenta";
    case "amber":
      return "text-accent-amber";
  }
}

export function accentGlowClass(accent: ZoneAccent): string {
  switch (accent) {
    case "cyan":
      return "shadow-glow-cyan";
    case "green":
      return "shadow-glow-green";
    case "violet":
      return "shadow-glow-magenta";
    case "magenta":
      return "shadow-glow-magenta";
    case "amber":
      return "shadow-glow-amber";
  }
}
