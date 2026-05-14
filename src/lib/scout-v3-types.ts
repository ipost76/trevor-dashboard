// scout-v3-types.ts — response contract for /api/scout/discoveries/v2 (SCOUT G3 endpoint).
// Mirrors the Pydantic models in /home/trevor/scout/scout/api/server.py DiscoveryV2*
// surface. CATALYST_PILL_CONFIG.none.label MUST be "" so the UI hides the pill —
// this is the explicit fix for the v2 "NO CATALYST" bug.

export type CatalystType =
  | "multi"
  | "new_stake_alert"
  | "insider_cluster"
  | "new_8k_filing"
  | "earnings_8k"
  | "new_52wk_high"
  | "volume_breakout"
  | "none";

export interface ResearchLink {
  label: string;
  url: string;
  icon: string;
  slot: "front" | "drawer";
}

export interface ResearchLinks {
  front: ResearchLink[];
  drawer: ResearchLink[];
}

export interface DiscoveryMetrics {
  price: number | null;
  mcap_str: string | null;
  rs: number | null;
  trend: string | null;
  vol_mult: number | null;
  sector: string | null;
}

export interface DiscoveryNarrative {
  bull_thesis: string[];
  triggers_to_watch: string[];
  research_priorities: string[];
  risk_flags: string[];
}

export interface DiscoveryV2Item {
  ticker: string;
  company_name: string | null;
  posted_at: string;
  unified_score: number;
  engines_fired: string[];
  catalyst_type: CatalystType;
  catalyst_label: string;
  narrative: DiscoveryNarrative;
  metrics: DiscoveryMetrics;
  research_links: ResearchLinks;
  surfaced_count: number;
  first_seen_at: string;
  material_change_log: string;
}

export interface DiscoveryV2Meta {
  count: number;
  window_days: number;
  catalyst_filter: string | null;
  generated_at: string;
}

export interface DiscoveryV2Response {
  discoveries: DiscoveryV2Item[];
  meta: DiscoveryV2Meta;
}

// Catalyst pill display config — drives color + visibility.
// Empty label = pill hidden entirely (fixes "NO CATALYST" bug).
export const CATALYST_PILL_CONFIG: Record<
  CatalystType,
  { label: string; colorClass: string }
> = {
  multi:           { label: "MULTI-CATALYST", colorClass: "text-amber-400 border-amber-400/50 bg-amber-400/10" },
  new_stake_alert: { label: "NEW STAKE",      colorClass: "text-fuchsia-400 border-fuchsia-400/50 bg-fuchsia-400/10" },
  insider_cluster: { label: "INSIDER CLUSTER", colorClass: "text-cyan-300 border-cyan-300/50 bg-cyan-300/10" },
  new_8k_filing:   { label: "NEW 8-K",        colorClass: "text-amber-300 border-amber-300/50 bg-amber-300/10" },
  earnings_8k:     { label: "EARNINGS",       colorClass: "text-emerald-400 border-emerald-400/50 bg-emerald-400/10" },
  new_52wk_high:   { label: "52WK HIGH",      colorClass: "text-emerald-300 border-emerald-300/50 bg-emerald-300/10" },
  volume_breakout: { label: "VOL BREAKOUT",   colorClass: "text-cyan-400 border-cyan-400/50 bg-cyan-400/10" },
  none:            { label: "",               colorClass: "" },
};
