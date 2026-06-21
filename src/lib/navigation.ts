/**
 * TREVOR // NAVIGATION CONTRACT v1
 *
 * Single source of truth for the 4-zone navigation + per-zone sub-tabs.
 * Every nav-rendering component (BottomNav, SidebarRail, TabBar instances,
 * mobile long-press BottomSheet) imports from here. No bespoke zone arrays.
 *
 * Mobile bottom-nav order is the priority order:
 *   1. AUTO       (Scalper — front and center per Ghost crunch posture; Hub landing)
 *   2. INTEL      (analysis surface — Notes / Shadow / Lessons / Journal)
 *   3. DOCS       (reference surface — Downloads file browser with category tabs; single-view zone)
 *   4. MEMORY     (was COMMAND — Brain / Memory / ChromaDB / System Health / Aggressive)
 *   5. HEALTH     (Health home — freshness/drift + reconcile + heartbeat + sentinels; B4 promotion)
 *
 * STOCKS zone removed 2026-06-19 (Stock+DCA removal); its legacy paths
 * (/trading, /scalp, /manual, /reminders) now redirect to /autotrader.
 *
 * HEALTH zone added 2026-06-19 (B4) — promotes the <HealthSection> view
 * (formerly at /memory?tab=health) to a top-level single-view zone at /health.
 * B1 (2026-06-20) removed the duplicate MEMORY "System Health" sub-tab; the old
 * /memory?tab=health deep link now 308-redirects to /health via middleware.ts.
 *
 * CHAT is a floating action button, NOT a tab. Always available, modal-style
 * full-screen on mobile, side panel on desktop.
 */

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  BookOpen,
  Database,
  Activity,
  MessageSquare,
} from "lucide-react";

export type ZoneId = "auto" | "intel" | "docs" | "memory" | "health";

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
    id: "intel",
    href: "/intel",
    label: "Intelligence",
    shortLabel: "Intel",
    icon: Brain,
    accent: "magenta",
    subTabs: [
      { key: "shadow", label: "Shadow" },
      { key: "impact", label: "Impact" },
      { key: "lessons", label: "Lessons" },
      { key: "journal", label: "Journal" },
      { key: "promote", label: "Promote" },
    ],
    defaultSubTab: "shadow",
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
      { key: "aggressive", label: "Aggressive" },
    ],
    defaultSubTab: "brain",
  },
  {
    // B4: Health home — the promoted <HealthSection> view (single-view zone).
    // B1 (2026-06-20): the duplicate MEMORY "System Health" sub-tab was removed;
    // this is now the single health home. The old /memory?tab=health deep link
    // 308-redirects here via middleware.ts. Reuses the existing "green" accent
    // (mint = healthy) so accentTextClass/accentGlowClass need no new case.
    id: "health",
    href: "/health",
    label: "Health",
    shortLabel: "Health",
    icon: Activity,
    accent: "green",
    // B4 AI engine (Hub read-side): the Health home gains two sub-tabs —
    // "health" (default: AI findings panel + the existing health cards incl. the
    // B6 ShadowLabCard) and "docs" (the AI recon-doc feed). The "docs" sub-tab is
    // distinct from the bottom-nav DOCS zone (id:"docs", /docs): different zone,
    // route, and storage (ai_findings.recon_md, not the downloads file system).
    subTabs: [
      { key: "health", label: "Health" },
      { key: "docs", label: "Docs" },
    ],
    defaultSubTab: "health",
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
  ["/trading", "/autotrader"], // was /stocks — zone removed (Stock+DCA removal 2026-06-19)
  ["/scalp", "/autotrader"], // was /stocks — zone removed (Stock+DCA removal 2026-06-19)
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
