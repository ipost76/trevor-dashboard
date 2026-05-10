// Display formatters + visual mappings for SCOUT signals.

export type Tone = "neutral" | "cyan" | "green" | "amber" | "red" | "magenta" | "violet";

const MCAP_TONE: Record<string, Tone> = {
  micro: "violet",
  small: "cyan",
  mid: "green",
  large: "amber",
  mega: "red",
};

export function mcapTone(label: string | null | undefined): Tone {
  if (!label) return "neutral";
  return MCAP_TONE[label] ?? "neutral";
}

export function mcapLabelFromValue(mcap: number | null | undefined): string | null {
  if (mcap == null || !Number.isFinite(mcap)) return null;
  if (mcap >= 200_000_000_000) return "mega";
  if (mcap >= 20_000_000_000) return "large";
  if (mcap >= 2_000_000_000) return "mid";
  if (mcap >= 300_000_000) return "small";
  return "micro";
}

export function formatMcap(mcap: number | null | undefined): string {
  if (mcap == null || !Number.isFinite(mcap)) return "—";
  if (mcap >= 1_000_000_000_000) return `${(mcap / 1_000_000_000_000).toFixed(2)}T`;
  if (mcap >= 1_000_000_000) return `${(mcap / 1_000_000_000).toFixed(2)}B`;
  if (mcap >= 1_000_000) return `${(mcap / 1_000_000).toFixed(0)}M`;
  if (mcap >= 1_000) return `${(mcap / 1_000).toFixed(0)}K`;
  return mcap.toFixed(0);
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toString();
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  // API returns "YYYY-MM-DDTHH:MM:SS.000" or "YYYY-MM-DD"; both slice cleanly.
  return iso.slice(0, 10);
}

export function formatRelativeDays(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 d";
  return `${days} d`;
}

// Score / RS coloring ————————————————————————————————

export function rsColor(rs: number | null | undefined): string {
  if (rs == null) return "var(--color-fg-muted)";
  if (rs >= 90) return "var(--color-accent-green)";
  if (rs >= 70) return "var(--color-accent-cyan)";
  if (rs >= 50) return "var(--color-accent-amber)";
  return "var(--color-accent-red)";
}

export function scoreColor(score: number | null | undefined, max = 50): string {
  if (score == null) return "var(--color-fg-muted)";
  if (score >= max * 0.85) return "var(--color-accent-green)";
  if (score >= max * 0.65) return "var(--color-accent-cyan)";
  if (score >= max * 0.45) return "var(--color-accent-amber)";
  return "var(--color-accent-red)";
}

export function pctTone(value: number | null | undefined): Tone {
  if (value == null) return "neutral";
  if (value >= 25) return "green";
  if (value >= 10) return "cyan";
  if (value >= 0) return "amber";
  return "red";
}

// Sub-signal coloring (Engine B) ————————————————————————

export const SUB_SIGNAL_TONE: Record<string, Tone> = {
  pead: "amber",
  momentum: "cyan",
  vcp: "violet",
  squeeze: "red",
  insider_cluster: "green",
  insider: "green",
  "8k": "amber",
};

export const SUB_SIGNAL_LABEL: Record<string, string> = {
  pead: "PEAD",
  momentum: "MOM",
  vcp: "VCP",
  squeeze: "SQZ",
  insider_cluster: "INS",
  insider: "INS",
  "8k": "8-K",
};

export function finvizUrl(ticker: string): string {
  return `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker.toUpperCase())}`;
}
