/**
 * TREVOR // NAVIGATION CONTRACT v1
 *
 * Single source of truth for the 5-zone navigation + per-zone sub-tabs.
 * Every nav-rendering component (BottomNav, SidebarRail, TabBar instances,
 * mobile long-press BottomSheet) imports from here. No bespoke zone arrays.
 *
 * Mobile bottom-nav order is the priority order:
 *   1. AUTO       (Scalper — front and center per Ghost crunch posture; Hub landing)
 *   2. STOCKS     (Stock discovery + DCA reminders — was MANUAL/SCALP/TRADING)
 *   3. INTEL      (analysis surface — Notes / Shadow / Lessons / Journal)
 *   4. DOCS       (reference surface — Downloads file browser with category tabs; single-view zone)
 *   5. MEMORY     (was COMMAND — Brain / Memory / ChromaDB / System Health / Aggressive)
 *
 * CHAT is a floating action button, NOT a tab. Always available, modal-style
 * full-screen on mobile, side panel on desktop.
 */

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Activity,
  Brain,
  BookOpen,
  Database,
  MessageSquare,
} from "lucide-react";

export type ZoneId = "auto" | "stocks" | "intel" | "docs" | "memory";

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
    id: "auto",
    href: "/autotrader",
    label: "Auto Trader",
    shortLabel: "Auto",
    icon: Bot,
    accent: "green",
    subTabs: [
      { key: "dashboard", label: "Dashboard" },
      { key: "recent", label: "Recent" },
      { key: "config", label: "Config" },
      { key: "control", label: "Control" },
      { key: "activity", label: "Activity" },
    ],
    defaultSubTab: "dashboard",
  },
  {
    id: "stocks",
    href: "/stocks",
    label: "Stocks",
    shortLabel: "Stocks",
    icon: Activity,
    accent: "violet",
    subTabs: [
      { key: "stock", label: "Stock" },
      { key: "dca", label: "DCA" },
    ],
    defaultSubTab: "stock",
  },
  {
    id: "intel",
    href: "/intel",
    label: "Intelligence",
    shortLabel: "Intel",
    icon: Brain,
    accent: "magenta",
    subTabs: [
      { key: "notes", label: "Notes" },
      { key: "shadow", label: "Shadow" },
      { key: "promote", label: "Promote" },
      { key: "lessons", label: "Lessons" },
      { key: "journal", label: "Journal" },
    ],
    defaultSubTab: "notes",
  },
  {
    id: "docs",
    href: "/docs",
    label: "Docs",
    shortLabel: "Docs",
    icon: BookOpen,
    accent: "amber",
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
  ["/trading", "/stocks"],
  ["/scalp", "/stocks"],
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

// A4 v1.1 refined accent mapping (C1).
// cyan   → cyan-soft   (default UI accent)
// green  → mint        (financial green, ACTIVE/LIVE/RUNNING)
// violet → plum        (mid-cap accent — plum replaces violet)
// magenta→ plum        (plum substitutes magenta for restrained UI)
// amber  → gold        (refined amber)
export function accentTextClass(accent: ZoneAccent): string {
  switch (accent) {
    case "cyan":
      return "text-accent-cyan-soft-strong";
    case "green":
      return "text-accent-mint-strong";
    case "violet":
      return "text-accent-plum-strong";
    case "magenta":
      return "text-accent-plum-strong";
    case "amber":
      return "text-accent-gold-strong";
  }
}

export function accentGlowClass(accent: ZoneAccent): string {
  switch (accent) {
    case "cyan":
      return "shadow-glow-active-cyan";
    case "green":
      return "shadow-glow-active-mint";
    case "violet":
      return "shadow-glow-active-plum";
    case "magenta":
      return "shadow-glow-active-plum";
    case "amber":
      return "shadow-glow-active-gold";
  }
}
