/**
 * cost-alert.ts — the Discord budget-alert check (B5).
 *
 * Called by the cost-refresh route (POST /api/cost/refresh) AFTER a successful cache
 * write. It REUSES B4's month-end forecast — runs the read-path roll-up
 * (scripts/db/query_cost.py → `projected_month_end_usd` + `breakdown[0]`) and NEVER
 * recomputes the forecast differently. If the projection exceeds the configured ceiling
 * it hands off to scripts/db/cost_alert_notify.py, which enforces one-alert-per-UTC-day
 * and posts an embed to #downloads.
 *
 * EARLY-WARNING by design: the trigger is the month-end FORECAST, not month-to-date — a
 * $60 MTD with a $250 projection fires; a $200 MTD already-spent doesn't get a second
 * (the daily cadence + the once-per-day latch bound it).
 *
 * BEST-EFFORT: this module NEVER throws. Every failure path (no data, Python error,
 * webhook down, bad JSON) resolves to a CostAlertResult — so an alert failure can never
 * break the daily refresh or the Hub. The route still wraps the call in its own try/catch.
 *
 * Threshold: COST_ALERT_THRESHOLD_USD (env, default 80) — one line in .env.local.
 */
import { runPython } from "@/lib/api-helpers";

export const DEFAULT_COST_ALERT_THRESHOLD_USD = 80;

export interface CostAlertResult {
  alerted: boolean;
  reason: string;
  projected?: number;
  threshold?: number;
  top_service?: string | null;
  message_id?: string | null;
  error?: string;
}

interface CostRollup {
  status: string;
  projected_month_end_usd?: number;
  mtd_total_usd?: number;
  month_label?: string | null;
  breakdown?: { service: string; net_usd: number }[];
}

/** Read the alert ceiling from env. Falls back to the default on unset/invalid/≤0. */
export function readCostAlertThreshold(): number {
  const raw = (process.env.COST_ALERT_THRESHOLD_USD || "").trim();
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_COST_ALERT_THRESHOLD_USD;
}

/**
 * Run the budget-alert check end-to-end. ALWAYS resolves with a CostAlertResult —
 * never throws. `alerted:true` only when an embed was actually posted to Discord.
 */
export async function maybeSendCostAlert(): Promise<CostAlertResult> {
  try {
    // 1. Reuse B4's forecast — the read-path roll-up (NEVER recomputed here).
    const raw = await runPython("scripts/db/query_cost.py", [], { timeout: 8_000 });
    const cost = JSON.parse(raw) as CostRollup;
    if (cost.status !== "ok") {
      // no_data_yet / empty_cache / error → no forecast to alert on (honest no-op).
      return { alerted: false, reason: `no_forecast:${cost.status || "unknown"}` };
    }

    const threshold = readCostAlertThreshold();
    const projected = Number(cost.projected_month_end_usd ?? 0);
    if (!(projected > threshold)) {
      return { alerted: false, reason: "under_threshold", projected, threshold };
    }

    // 2. Top cost driver = first breakdown row (query_cost.py sorts net DESC).
    const top = cost.breakdown && cost.breakdown.length ? cost.breakdown[0] : null;

    // 3. Hand off to the notifier (anti-spam latch + Discord post). Best-effort.
    const payload = JSON.stringify({
      projected,
      threshold,
      top_service: top ? { service: top.service, net_usd: top.net_usd } : null,
      mtd_total_usd: Number(cost.mtd_total_usd ?? 0),
      month_label: cost.month_label ?? null,
    });
    const out = await runPython("scripts/db/cost_alert_notify.py", [], {
      input: payload,
      timeout: 25_000,
    });
    return JSON.parse(out) as CostAlertResult;
  } catch (e) {
    // An alert failure must NEVER break the refresh — swallow + report.
    return { alerted: false, reason: "exception", error: String((e as Error)?.message || e) };
  }
}
