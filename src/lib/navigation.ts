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
    // B1 (2026-06-28, Hub Read-Only Lockdown): the Config + Control sub-tabs
    // (the concentrated bot-control UI) were removed — all config/control now
    // happens via CC prompts, never the Hub. Dashboard/Recent/Activity stay as
    // read-only views; the killswitch lives in the header/scalper-header/health.
    subTabs: [
      { key: "dashboard", label: "Dashboard" },
      { key: "recent", label: "Recent" },
      { key: "activity", label: "Activity" },
    ],
    defaultSubTab: "dashboard",
  },
  {
    id: "intel",
    href: "/intel",
    // R12-B3: zone RENAME only — route id + href stay "intel"/"/intel" (the whole
    // /api/intel/* namespace + HUB_REDESIGN_INTEL + the route folder are unchanged).
    // The TRAINER cockpit renders here when HUB_REDESIGN_TRAINER is on (B1); the
    // Shadows view renders when it's off. Accent stays magenta → refined plum
    // (accentTextClass), the TRAINER identity.
    label: "Trainer",
    shortLabel: "TRAINER",
    icon: Brain,
    accent: "magenta",
    // H1 (2026-07-09): the "Impact" ($-rank) + "Daily Edge" tabs were removed —
    // they were the display layer of the promotion/edge apparatus RM-DECOM
    // decommissioned; Ghost now drives all edge/tweak analysis through CC recon.
    subTabs: [
      { key: "shadow", label: "Shadow" },
      { key: "promotions", label: "Promotions" },
    ],
    defaultSubTab: "shadow",
  },
  {
    // RM-HUB-INTEL B2 (2026-07-11): the 4 raw MEMORY sub-tabs (Brain / Memory /
    // ChromaDB / Aggressive) + their sections were stripped and replaced by a
    // single quick-glance "Memory & Intelligence" loop_health dashboard. Now a
    // single-view zone — `<ZoneSubTabs />` auto-hides (no subTabs), exactly like
    // the /docs zone. The Aggressive Hub surface (section + /api/memory/aggressive
    // route + query_aggressive.py / set_aggressive.py helpers) was removed here
    // too; the aggressive_mode DB tables/columns are preserved and
    // HUB_AGGRESSIVE_TOGGLE_ENABLED is tombstoned (=false), never dropped.
    id: "memory",
    href: "/memory",
    // R12-B3: zone RENAME only — route id + href stay "memory"/"/memory" (the
    // /api/memory/* namespace + HUB_REDESIGN_MEMORY + the route folder are
    // unchanged). The WATCHER cockpit renders here when HUB_REDESIGN_WATCHER is on
    // (B2); the loop_health glance renders when it's off. Accent stays cyan → the
    // refined cyan-soft, the WATCHER identity (distinct from TRAINER's plum).
    label: "Watcher",
    shortLabel: "Watcher",
    icon: Database,
    accent: "cyan",
  },
  {
    // R12-B3 (2026-07-22): DOCS moved AFTER memory(Watcher), before health —
    // target zone order auto → intel(Trainer) → memory(Watcher) → docs → health.
    id: "docs",
    href: "/docs",
    label: "Docs",
    shortLabel: "Docs",
    icon: BookOpen,
    accent: "amber",
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
    // B4 (2026-06-22): + "cost" sub-tab → the GCP cost tracker card
    // (/health?tab=cost), reading the data/hub.db cost_snapshots cache.
    subTabs: [
      { key: "health", label: "Health" },
      { key: "docs", label: "Docs" },
      { key: "cost", label: "Cost" },
    ],
    defaultSubTab: "health",
  },
] as const;

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
