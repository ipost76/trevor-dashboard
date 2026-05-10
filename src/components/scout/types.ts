// Types matching SCOUT D1 API responses (/api/scout/*).
//
// Endpoints documented in /home/trevor/scout/scout/api/server.py.

export interface SignalScores {
  // Engine A factor scores (Position):
  eps_accel?: number;
  cagr_25?: number;
  vcp?: number;
  vol_breakout?: number;
  insider?: number;
  inst_flow?: number;
  sector_rank?: number;
  squeeze?: number;
  stake?: number;
  "8k"?: number;
  // Engine B sub-signal scores (Swing):
  pead?: number;
  momentum?: number;
  insider_cluster?: number;
}

export interface SignalDetails {
  insider?: string | null;
  filing?: string | null;
  stake?: string | null;
  pead?: string | null;
  vcp?: string | null;
  squeeze?: string | null;
}

export interface SignalComponents {
  rs_pct?: number | null;
  eps_yoy?: number | null;
  rev_yoy?: number | null;
  mom_pct?: number | null;
  mcap?: number | null;
  mcap_label?: "micro" | "small" | "mid" | "large" | "mega" | string | null;
  sector?: string | null;
  pattern?: string | null;
  pct_from_high?: number | null;
  scores: SignalScores;
  details: SignalDetails;
  active?: string[];
}

export interface Signal {
  ticker: string;
  run_date: string;
  run_time: string;
  raw_score: number;
  size_multiplier: number;
  final_score: number;
  components: SignalComponents | null;
  is_new: boolean;
  market_cap: number | null;
  sector: string | null;
  name: string | null;
}

export interface SignalsResponse {
  signals: Signal[];
  run_date: string | null;
  count: number;
}

export interface HistoryRow {
  ticker: string;
  run_date: string;
  final_score: number;
  raw_score: number;
  size_multiplier: number;
  is_new: boolean;
  components: SignalComponents | null;
}

export interface HistoryResponse {
  history: HistoryRow[];
  count: number;
}

export interface WatchlistRow {
  ticker: string;
  added_date: string;
  source_engine: string;
  entry_score: number;
  status: string;
  notes: string | null;
  name: string | null;
  market_cap: number | null;
  sector: string | null;
}

export interface WatchlistResponse {
  watchlist: WatchlistRow[];
  count: number;
}

export interface ScoutSizeMultipliers {
  micro: number;
  small: number;
  mid: number;
  large: number;
  mega: number;
}

export interface ScoutConfig {
  rs_threshold: number;
  eps_yoy_threshold: number;
  revenue_yoy_threshold: number;
  universe_min_mcap: number;
  universe_min_volume: number;
  size_multipliers: ScoutSizeMultipliers;
  premarket_time: string;
  eod_scan_time: string;
  daily_report_time: string;
}

export interface HealthResponse {
  status: string;
  tables: Record<string, number>;
  last_scan: string | null;
  db_path: string;
}

export type Engine = "position" | "swing";

// D3 — additional endpoint types ----------------------------------------------

export interface Filing8K {
  filing_date: string;
  ticker: string;
  /** JSON-encoded array string like "[\"5.02\"]" — must JSON.parse client-side. */
  item_codes: string;
  accession_no: string;
  summary: string | null;
}

export interface InsiderTrade {
  filing_date: string;
  trade_date: string;
  ticker: string;
  insider_name: string;
  insider_role: string;
  /** "P" = open-market purchase, "S" = sale */
  transaction_code: string;
  shares: number;
  price: number | null;
  value: number | null;
}

export interface StakeAlert {
  filing_date: string;
  ticker: string;
  filer_name: string;
  /** e.g. "SCHEDULE 13D" or "SCHEDULE 13G" */
  form_type: string;
  pct_ownership: number | null;
  shares: number | null;
}

export interface FilingsResponse {
  filings_8k?: Filing8K[];
  insider_trades?: InsiderTrade[];
  stake_alerts?: StakeAlert[];
}

export interface InsiderHeatmapRow {
  ticker: string;
  insider_role: string;
  /** "P" or "S" */
  transaction_code: string;
  total_value: number;
  trade_count: number;
  earliest: string;
  latest: string;
}

export interface InsiderHeatmapResponse {
  heatmap_data: InsiderHeatmapRow[];
}

export interface SectorsResponse {
  date: string | null;
  /** Map of ETF ticker → 1-11 rank. e.g. {XLK: 1, XLRE: 2, ...} */
  sector_rotation: Record<string, number> | null;
  regime_label: string | null;
  yield_curve: number | null;
  financial_stress: number | null;
}

export interface MacroRow {
  date: string;
  yield_curve_10y3m: number | null;
  financial_stress_index: number | null;
  regime_label: string | null;
}

export interface MacroResponse {
  macro_history: MacroRow[];
}

export interface OutcomeRow {
  signal_date: string;
  ticker: string;
  engine: Engine | string;
  entry_price: number | null;
  signal_score: number | null;
  fwd_return_5d: number | null;
  fwd_return_20d: number | null;
  fwd_return_60d: number | null;
  components: SignalComponents | null;
}

export interface OutcomesEngineSummary {
  count: number;
  avg_5d: number | null;
  avg_20d: number | null;
  avg_60d: number | null;
  win_rate_20d: number | null;
}

export interface OutcomesResponse {
  outcomes: OutcomeRow[];
  summary: Partial<Record<Engine, OutcomesEngineSummary>>;
}
