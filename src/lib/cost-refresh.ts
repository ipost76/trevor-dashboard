/**
 * cost-refresh.ts — the daily-refresh WORKER for the Hub GCP cost tracker (B4).
 *
 * Queries the GCP Detailed Billing BigQuery export for per-service daily NET cost
 * over a trailing 35-day window (a month + headroom for the month-end forecast),
 * then UPSERTs the rows into the Hub-owned cache `data/hub.db` (table
 * cost_snapshots, C1). The cost CARD reads that cache via GET /api/cost — it never
 * touches BigQuery on page load (querying per view costs money + is slow).
 *
 * AUTH: ADC (Application Default Credentials). The @google-cloud/bigquery client
 * auto-detects ADC from `~/.config/gcloud/application_default_credentials.json` —
 * there is NO service-account key file (org policy blocks SA keys).
 *
 * WRITE PATH: BigQuery is a Node-only client so the query runs here, but the
 * sqlite write is handed to a python helper (scripts/db/cost_upsert.py) via
 * runPython — keeping hub.db single-technology (python stdlib sqlite3), matching
 * C1's apply_hub_migration.py and the rest of the Hub DB layer.
 *
 * GRACEFUL EMPTY STATE (mandatory): GCP creates the export table only once the
 * first data lands, so until the export backfills the query throws
 * `Not found: Table …`. That — and a genuinely empty result — is treated as
 * `no_data_yet`, never a hard error. Auth/network/quota failures are caught,
 * logged, and returned as `error` status: this module NEVER throws, so a refresh
 * can never crash the Hub.
 */
import { BigQuery } from "@google-cloud/bigquery";
import { runPython } from "@/lib/api-helpers";

export type RefreshStatus = "ok" | "no_data_yet" | "error";

export interface RefreshResult {
  status: RefreshStatus;
  written?: number;
  snapshot_dates?: number;
  reason?: string;
  error?: string;
  fetched_at?: string;
}

// Identifier shapes. Project IDs allow dashes; dataset/table are word-chars only.
// These come from server env (config, not user input) but are validated anyway
// since they are interpolated into the (un-parameterizable) table reference.
const PROJECT_ID_RE = /^[A-Za-z0-9-]+$/;
const DATASET_ID_RE = /^[A-Za-z0-9_]+$/;
const TABLE_ID_RE = /^[A-Za-z0-9_]+$/;

const TRAILING_DAYS = 35;
const QUERY_TIMEOUT_MS = 25_000;
const UPSERT_TIMEOUT_MS = 15_000;

interface BqRow {
  snapshot_date: unknown; // BigQueryDate ({ value: 'YYYY-MM-DD' }) or string
  service: string | null;
  gross_cost_usd: number | null;
  net_cost_usd: number | null;
}

function billingTableRef(): { project: string; ref: string } {
  const project = (process.env.GCP_BILLING_PROJECT || "").trim();
  const dataset = (process.env.GCP_BILLING_DATASET || "").trim();
  const table = (process.env.GCP_BILLING_TABLE || "").trim();
  if (!PROJECT_ID_RE.test(project)) throw new Error("GCP_BILLING_PROJECT unset/invalid");
  if (!DATASET_ID_RE.test(dataset)) throw new Error("GCP_BILLING_DATASET unset/invalid");
  if (!TABLE_ID_RE.test(table)) throw new Error("GCP_BILLING_TABLE unset/invalid");
  return { project, ref: `\`${project}.${dataset}.${table}\`` };
}

/** BigQueryDate → 'YYYY-MM-DD' string. */
function bqDateToISO(d: unknown): string {
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (typeof d === "object" && "value" in (d as Record<string, unknown>)) {
    return String((d as { value: unknown }).value);
  }
  return String(d);
}

/** True when the failure means the export table/dataset does not exist yet. */
function isNotFound(e: unknown, msg: string): boolean {
  const code = (e as { code?: number })?.code;
  if (code === 404) return true;
  return /not found:?\s*(table|dataset)/i.test(msg) || /\bdoes not exist\b/i.test(msg);
}

/** Coarse bucket so the timer log / card can tell auth from network from query. */
function classifyError(msg: string): string {
  if (/permission|denied|forbidden|unauthor|credential|reauth|invalid_grant|ADC/i.test(msg)) {
    return "auth";
  }
  if (/timeout|deadline|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(msg)) {
    return "network";
  }
  return "query";
}

/**
 * The net-cost query. gross = Σ(cost); net = Σ(cost) + Σ(credits) (credits are
 * negative), grouped per service per usage day. Raw SUM(cost) would overstate by
 * ignoring credits — the net formula matches GCP's own invoice math.
 */
function buildQuery(ref: string): string {
  return `
    SELECT DATE(usage_start_time) AS snapshot_date,
           service.description AS service,
           ROUND(SUM(cost), 4) AS gross_cost_usd,
           ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) AS net_cost_usd
    FROM ${ref}
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${TRAILING_DAYS} DAY)
    GROUP BY snapshot_date, service
    ORDER BY snapshot_date, service
  `;
}

/**
 * Run the refresh end-to-end. ALWAYS resolves with a RefreshResult — never throws.
 *   ok          → rows written to cost_snapshots
 *   no_data_yet → export still backfilling (table missing) or empty result
 *   error       → auth / network / quota / upsert failure (logged, non-fatal)
 */
export async function refreshCostSnapshots(): Promise<RefreshResult> {
  let project: string;
  let ref: string;
  try {
    ({ project, ref } = billingTableRef());
  } catch (e) {
    return { status: "error", reason: "config", error: String((e as Error)?.message || e) };
  }

  let rows: BqRow[];
  try {
    const bq = new BigQuery({ projectId: project });
    const [result] = await bq.query({
      query: buildQuery(ref),
      location: (process.env.GCP_BILLING_LOCATION || "US").trim(),
      jobTimeoutMs: QUERY_TIMEOUT_MS,
    });
    rows = (result || []) as BqRow[];
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    // Table/dataset not found = export still backfilling → graceful no_data_yet.
    if (isNotFound(e, msg)) {
      return { status: "no_data_yet", reason: "table_not_found" };
    }
    console.error("[cost-refresh] BigQuery query failed:", msg);
    return { status: "error", reason: classifyError(msg), error: msg.slice(0, 300) };
  }

  if (!rows.length) {
    return { status: "no_data_yet", reason: "empty_result" };
  }

  const payload = rows
    .map((r) => ({
      snapshot_date: bqDateToISO(r.snapshot_date),
      service: r.service ?? "(unknown)",
      gross_cost_usd: Number(r.gross_cost_usd ?? 0),
      net_cost_usd: Number(r.net_cost_usd ?? 0),
    }))
    .filter((r) => r.snapshot_date);

  if (!payload.length) {
    return { status: "no_data_yet", reason: "empty_result" };
  }

  try {
    const raw = await runPython("scripts/db/cost_upsert.py", [], {
      input: JSON.stringify(payload),
      timeout: UPSERT_TIMEOUT_MS,
    });
    const parsed = JSON.parse(raw) as {
      written: number;
      snapshot_dates: number;
      fetched_at: string;
    };
    return {
      status: "ok",
      written: parsed.written,
      snapshot_dates: parsed.snapshot_dates,
      fetched_at: parsed.fetched_at,
    };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("[cost-refresh] upsert failed:", msg);
    return { status: "error", reason: "upsert", error: msg.slice(0, 300) };
  }
}
