/**
 * plain-labels.ts — the Hub's shared machine-identifier → plain-English layer.
 *
 * WHAT IT IS FOR: every Hub surface that would otherwise render a raw column
 * value, a snake_case key, a systemd unit name or a status code as visible
 * copy. Import a map when you need the whole table; import the matching
 * `plain*()` helper when you need one label.
 *
 * FALLBACKS ARE NEUTRAL BY DESIGN. Every helper returns a generic English
 * phrase for an unmapped key — never the key, and never a de-underscored key
 * (a de-underscored identifier is still an identifier). This is deliberate:
 * the older idiom used `?? raw` and leaked the identifier the moment the map
 * missed. Do not reintroduce that pattern.
 *
 * SHARED SURFACE: RM-HUB-CLEAN Wave C imports CATEGORY_PLAIN / plainCategory.
 * Extend these maps only with keys OBSERVED in live data — never invent a key,
 * and never add one whose English name you had to guess.
 */

// ── watcher self-checks (watcher_health.check_name) ──────────────────────────
export const CHECK_PLAIN: Record<string, string> = {
  watcher_loop: "Watcher itself",
  cron_liveness: "Scheduled jobs",
  critical_units: "Background services",
  alerting_canary: "Alert delivery",
  stuck_testing: "Stuck tests",
  loop_freshness: "Loop freshness",
  // integrity-store check names (watcher_integrity._record_integrity_finding)
  run_all_integrity: "Full integrity check",
  apply_oversight: "Oversight review",
  // per-check names nested in an integrity finding
  level_matches: "Level matches the record",
  prompt_id_present: "Change is attributed",
  config_snapshot_cross_check: "Settings match the snapshot",
};

// ── health status (watcher_health.status) ────────────────────────────────────
export const STATUS_PLAIN: Record<string, string> = {
  ok: "OK",
  degraded: "Needs a look",
  unknown: "Couldn't check",
};

// ── live detection kinds (watcher_errors.source) ─────────────────────────────
export const SOURCE_PLAIN: Record<string, string> = {
  loop_stall: "Background loop stopped",
  cron_dead: "Scheduled job failed",
  systemctl_failed: "Service stopped",
  swallowed_canary: "Alert never arrived",
};

// ── critique severity (watcher_critiques.severity) + AI-findings severity ────
export const SEVERITY_PLAIN: Record<string, string> = {
  note: "Note",
  concern: "Worth watching",
  problem: "Problem",
  info: "Note",
};

// ── mismatch kinds (reconciliation_log.kind) ─────────────────────────────────
export const KIND_PLAIN: Record<string, string> = {
  undeclared_trading_change: "Trading code changed without being declared",
  declared_not_detected: "Declared a change, but none was found",
};

/**
 * Trade-reconciliation mismatch kinds — the heartbeat's `reconcile` category,
 * `open_mismatches[].kind`. A DIFFERENT domain from KIND_PLAIN above, which maps
 * the watcher's `reconciliation_log.kind`; the two must not be conflated.
 *
 * 🚨 DELIBERATELY EMPTY. C2 could not observe this domain: the Observatory
 * collector that publishes the category was decommissioned (RM-DECOM) and the
 * category has never been published, so there is no live data to read the keys
 * from. Per this module's contract we add only keys OBSERVED in live data, and
 * inventing plausible ones would be the guess the header forbids. The helper
 * below still does its job — an unmapped kind reads "Mismatch", never the raw
 * key. Add real keys here when the category actually starts publishing.
 */
export const MISMATCH_KIND_PLAIN: Record<string, string> = {};

// ── reconciliation result (reconciliation_log.outcome) ───────────────────────
export const OUTCOME_PLAIN: Record<string, string> = {
  mismatch: "Mismatch found",
  match: "Matched",
};

// ── what kind of decision was critiqued (watcher_critiques.decision_kind) ────
export const DECISION_KIND_PLAIN: Record<string, string> = {
  verdict: "A trade decision",
  promotion: "A promotion decision",
  level_change: "A level change",
};

/**
 * AI-findings categories. The live domain is currently a single observed value
 * ("cost"); Wave C extends this map as new categories actually appear in the
 * data. Unmapped keys fall through to "Uncategorised" rather than leaking.
 */
export const CATEGORY_PLAIN: Record<string, string> = {
  cost: "Cost",
};

// ── helpers — every fallback is a neutral phrase, never the raw key ──────────

export function plainCheck(raw: string | null | undefined): string {
  if (!raw) return "Unnamed check";
  return CHECK_PLAIN[raw] ?? "Other check";
}

export function plainStatus(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return STATUS_PLAIN[raw] ?? "Unknown";
}

export function plainSource(raw: string | null | undefined): string {
  if (!raw) return "Problem";
  return SOURCE_PLAIN[raw] ?? "Problem";
}

export function plainSeverity(raw: string | null | undefined): string {
  if (!raw) return "Flagged";
  return SEVERITY_PLAIN[raw] ?? "Flagged";
}

export function plainKind(raw: string | null | undefined): string {
  if (!raw) return "Check";
  return KIND_PLAIN[raw] ?? "Check";
}

/**
 * A trade-reconciliation mismatch kind, for the pill on the reconcile card.
 *
 * Separate from plainKind() on purpose: that helper's neutral fallback is
 * "Check", which reads wrong on a mismatch pill ("Check 3" implies a check ran,
 * not that three records disagree). Adding a helper rather than changing an
 * existing fallback — other prompts read this module live.
 */
export function plainMismatchKind(raw: string | null | undefined): string {
  if (!raw) return "Mismatch";
  return MISMATCH_KIND_PLAIN[raw] ?? "Mismatch";
}

export function plainOutcome(raw: string | null | undefined): string {
  if (!raw) return "Result not recorded";
  return OUTCOME_PLAIN[raw] ?? "Result not recorded";
}

export function plainDecisionKind(raw: string | null | undefined): string {
  if (!raw) return "A decision";
  return DECISION_KIND_PLAIN[raw] ?? "A decision";
}

export function plainCategory(raw: string | null | undefined): string {
  if (!raw) return "Uncategorised";
  return CATEGORY_PLAIN[raw] ?? "Uncategorised";
}

/**
 * Belt-and-braces floor for stored free-text that reaches the screen.
 *
 * The watcher's health store holds rows written BEFORE the writer was taught to
 * speak English, and nothing rewrites them. So the renderer needs its own
 * floor: show stored text only when it reads as a sentence, and otherwise say
 * something neutral keyed off the status.
 *
 * "Reads as a sentence" is all three of: starts with a capital, ends with
 * terminal punctuation, and contains none of the shapes machine text actually
 * takes here — a serialized dict, a `key=value` pair, a snake_case identifier,
 * a unit name, a shell glob, or an "(s)" plural. The first two conditions are
 * load-bearing: stored details like "1 stale of 21 loops" and "0 stuck TESTING
 * of 0 testing rows" contain none of the machine-text markers, and a
 * markers-only sniff let both through verbatim.
 */
const MACHINE_TEXT = /[{}]|=|_|\.service\b|trevor-|\(s\)/;

function readsAsSentence(text: string): boolean {
  return /^[A-Z]/.test(text) && /[.!?]$/.test(text) && !MACHINE_TEXT.test(text);
}

export function plainHealthDetail(
  detail: string | null | undefined,
  status?: string | null,
): string {
  const text = (detail ?? "").trim();
  if (readsAsSentence(text)) return text;
  if (status === "ok") return "Checked — nothing wrong found.";
  if (status === "degraded") return "This check found a problem.";
  return "No readable detail was recorded for this check.";
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ALLOWLISTS (F1) — for the generic dict-serializer shape.
 *
 * 🚨 WHY THESE RETURN `null` AND NOT A FALLBACK STRING. The maps above answer
 * "what is the English for this key?" and lean on a neutral fallback so a miss
 * degrades instead of leaking. That is right for a single labelled field. It is
 * NOT enough for a serializer that walks an UNKNOWN key set: five separate
 * prompts have now found the same `${k}=${v}` shape, twice written deliberately
 * generic ("future-proof against the loop's DDL"), so every future schema
 * migration ships new raw column names to the screen.
 *
 * These helpers return `null` for an unmapped key, and callers MUST drop it and
 * count it. An unmapped key is therefore structurally unrenderable — it does not
 * depend on a fallback string staying neutral. The caller renders the tally as
 * "+N more", so the information loss an allowlist causes is VISIBLE, never
 * silent.
 *
 * Adding a key here can only ever ADD a plain-English label; it can never cause
 * a leak. Omitting one costs a row, not a disclosure. When in doubt, omit.
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * Shadow / promotion metric keys.
 *
 * The 29 shadow keys are the COMPLETE set emitted by `query_shadow_status.py`'s
 * `_ks_*` functions (extracted from that source, not sampled from live data, so
 * it cannot miss a rarely-populated table). The promotion-stat keys come from
 * `query_promotion_candidates.py`'s own documented contract — that table does
 * not exist pre-cutover, so its columns are documented rather than observed.
 */
export const METRIC_PLAIN: Record<string, string> = {
  // ── query_shadow_status.py `_ks_*` returns ────────────────────────────────
  alerts: "Alerts",
  all_gates_pass: "All gates passed",
  avg_bps: "Average basis points",
  avg_delta: "Average difference",
  avg_v1_size: "Average size (v1)",
  avg_v2_size: "Average size (v2)",
  block: "Blocked",
  block_pct: "Blocked share",
  blocked: "Blocked",
  confirm_exit: "Confirmed exits",
  cycles: "Cycles",
  divergence_pct: "Divergence rate",
  divergent: "Divergent rows",
  fills: "Fills",
  gap_cycles: "Gap cycles",
  gate_progress: "Gate progress",
  max_delta: "Largest difference",
  min_delta: "Smallest difference",
  pass: "Passed",
  pass_pct: "Passed share",
  rejects: "Rejects",
  rows_24h: "Rows (24h)",
  shadow_blocks: "Shadow blocks",
  timeouts: "Timeouts",
  total: "Total rows",
  total_48h: "Total (48h)",
  total_funding_usd: "Total funding",
  v2_exit: "Exits (v2)",
  v2_hold: "Holds (v2)",
  // ── shadow-lab-card's one observed `extraMetrics` key ─────────────────────
  candidate: "Candidate",
  // ── query_promotion_candidates.py documented stats ────────────────────────
  n: "Sample size",
  n_distinct: "Distinct trades",
  expectancy_usd: "Expectancy per trade",
  net_usd: "Net profit",
  win_rate: "Win rate",
  exact_or_bound: "Exact or bounded",
};

/**
 * Own-property lookup for the allowlists.
 *
 * 🚨 A bare `MAP[k]` is NOT safe for a key set you do not control: `"__proto__"`
 * resolves to `Object.prototype` and `"constructor"` to the `Object` function.
 * Neither is null or undefined, so `?? null` never fires and a non-string
 * reaches the renderer — React throws on an object child, blanking the panel.
 * These helpers exist precisely to walk untrusted key sets, so they must use an
 * own-property check. (Found by this change's own negative control, not by
 * reasoning — which is the argument for writing the control first.)
 */
function ownLabel(map: Record<string, string>, raw: string): string | null {
  return Object.prototype.hasOwnProperty.call(map, raw) ? map[raw] : null;
}

export function plainMetric(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ownLabel(METRIC_PLAIN, raw);
}

/**
 * Append the dropped-key tally to an allowlisted bit list.
 *
 * This is the counterpart that makes an allowlist honest: it keeps the
 * information loss VISIBLE without ever naming the key that was dropped. Every
 * allowlisted serializer renders through this, so the "+N more" wording cannot
 * drift between surfaces.
 */
export function bitsWithDropped(bits: string[], dropped: number): string[] {
  return dropped > 0 ? [...bits, `+${dropped} more`] : bits;
}

/**
 * Trainer config axes — the 12-value closed vocabulary in `lib/memory_db.py`
 * (`CONFIG_AXES`), plus the capability-request fields `query_capability_queue.py`
 * documents. That table is also absent pre-cutover.
 */
export const AXIS_PLAIN: Record<string, string> = {
  tickers: "Tickers",
  size: "Position size",
  leverage: "Leverage",
  timeframe: "Timeframe",
  direction: "Direction",
  hedge: "Hedging",
  exit: "Exit rules",
  portfolio: "Portfolio shape",
  timing_context: "Timing context",
  cost: "Trading costs",
  signal: "Signal rules",
  entry: "Entry rules",
  // standing_hypotheses domains (trainer_hypotheses.SEED_HYPOTHESES)
  sizing: "Position sizing",
  // capability_requests documented fields
  axes: "Requested axes",
  requested_axes: "Requested axes",
  reason: "Reason",
  level_id: "Level",
  created_at: "Created",
};

export function plainAxis(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ownLabel(AXIS_PLAIN, raw);
}

/**
 * API-budget buckets (`heartbeat.categories.budget.budget_breakdown`). C2 fixed
 * the raw `${k} $${v}` serialization here by capitalising the key, on the
 * grounds that the four buckets are a closed set of ordinary words. That held
 * for those four — but it is still the generic shape, so a fifth bucket would
 * arrive raw. Allowlisted for the same reason as the others.
 */
export const BUDGET_BUCKET_PLAIN: Record<string, string> = {
  briefing: "Briefing",
  learning: "Learning",
  swarm: "Swarm",
  other: "Other",
};

export function plainBudgetBucket(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ownLabel(BUDGET_BUCKET_PLAIN, raw);
}

/**
 * Trainer gate names, from `compass_metrics.py` + `trainer_validation.py`.
 * A gate may arrive with a parenthesised reason (`dd_ceiling(insufficient_curve)`);
 * the suffix is stripped before lookup so the variant maps to the same label,
 * and an unmapped base name still returns null rather than leaking the suffix.
 */
export const GATE_PLAIN: Record<string, string> = {
  dd_ceiling: "Drawdown limit",
  cvar_floor: "Tail-risk floor",
  sample_floor_n: "Sample-size floor",
  n_trials: "Trials budget",
  leakage_reject: "Data-leakage check",
};

export function plainGate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return ownLabel(GATE_PLAIN, base);
}

/**
 * Allowlist form of plainCheck(), for walking an UNKNOWN key set.
 *
 * plainCheck() keeps its neutral "Other check" fallback — that is right for a
 * single named field and other surfaces rely on it, so it is not changed here.
 * A dict walk needs the stricter contract: null, so the caller drops and counts.
 */
export function plainCheckStrict(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ownLabel(CHECK_PLAIN, raw);
}

/**
 * Authored per-check sentences for the watcher self-check panel, keyed
 * `"<check_name>:<status>"`.
 *
 * 🚨 AUTHORED, NOT DERIVED. Each sentence is written from what the check in
 * `watcher_surface.py` actually DOES, never reconstructed from the stored
 * detail — reconstructing meaning from the stored machine text is precisely the
 * leak `plainHealthDetail`'s floor exists to prevent. Naming which check flagged
 * a problem is the whole payload; the numbers stay out.
 *
 * TENSE. Five of the six live rows were written 2026-07-22 and nothing rewrites
 * them, so they are a snapshot and read in the past tense. `watcher_loop` is the
 * self-refreshing bookkeeping row (it updates every cycle), so its sentences are
 * present tense — a past-tense sentence there would go stale the other way.
 */
export const CHECK_SENTENCE: Record<string, string> = {
  "loop_freshness:degraded":
    "Loop freshness was flagged — at least one background loop had gone quiet for longer than its expected interval.",
  "loop_freshness:ok":
    "Every background loop had written within its expected interval.",
  "loop_freshness:unknown":
    "Loop freshness could not be read when this ran.",

  "stuck_testing:degraded":
    "Stuck tests were flagged — at least one shadow had sat in a testing state for over a day.",
  "stuck_testing:ok":
    "No shadow had been left sitting in a testing state.",
  "stuck_testing:unknown":
    "Stuck tests could not be read when this ran.",

  "alerting_canary:degraded":
    "Alert delivery was flagged — the canary that proves alerts still fire had not been seen recently enough.",
  "alerting_canary:ok":
    "The canary that proves alerts still fire had been seen recently.",
  "alerting_canary:unknown":
    "Alert delivery could not be read when this ran.",

  "critical_units:degraded":
    "Background services were flagged — at least one service that should always be running was not.",
  "critical_units:ok":
    "Every service that should always be running was up.",
  "critical_units:unknown":
    "Background services could not be read when this ran.",

  "cron_liveness:degraded":
    "Scheduled jobs were flagged — at least one scheduled job had ended in failure.",
  "cron_liveness:ok":
    "No scheduled job had ended in failure.",
  "cron_liveness:unknown":
    "Scheduled jobs could not be read when this ran.",

  "watcher_loop:degraded":
    "The watcher is reporting a problem with its own cycle.",
  "watcher_loop:ok":
    "The watcher is completing its own cycle normally.",
  "watcher_loop:unknown":
    "The watcher cannot currently report on its own cycle.",
};

/**
 * The self-check panel's detail line.
 *
 * Order, and why: stored text wins ONLY if it passes the same sentence sniff the
 * floor already uses (so a writer that learns to speak English is rendered as
 * written); otherwise the authored sentence for this exact check+status; and
 * failing both, the original generic floor. An unmapped `check_name` therefore
 * lands on the generic sentence — NEVER on the raw detail.
 */
export function plainCheckDetail(
  checkName: string | null | undefined,
  detail: string | null | undefined,
  status?: string | null,
): string {
  const text = (detail ?? "").trim();
  if (readsAsSentence(text)) return text;
  const authored =
    CHECK_SENTENCE[`${(checkName ?? "").trim()}:${(status ?? "").trim()}`];
  if (authored) return authored;
  return plainHealthDetail(detail, status);
}

/* ------------------------------------------------------------------------- *
 * Write-gateway failure codes  [B12]
 * ------------------------------------------------------------------------- */

/**
 * The write gateway's failure identifiers → what happened AND what to do.
 *
 * 🚨 WHY THIS MAP EXISTS WHERE IT DOES. 11 of the 14 known codes are minted in
 * `gateway/server.js` — Node.js, outside `src/`. That is a third language layer
 * no sweep of this campaign covered: a TSX sweep misses it (wrong extension), a
 * Python sweep misses it (wrong language), and a whole-`src/` sweep misses it
 * (wrong directory). The remaining 3 are minted by `callGateway` in
 * `gateway-client.ts`. Neither producer can be glossed from here — one is
 * another process, the other runs before this layer — so the gloss is applied at
 * the ONE point both converge on: `gatewayResponse()`.
 *
 * 🚨 THE CODE SET IS NOT CLOSED AT 14. `server.js` passes the VM gateway's body
 * through VERBATIM for 200/400/401/423/504, so a VM-minted code this file has
 * never seen can arrive. That is why this is an ALLOWLIST returning `null` and
 * not a map with a raw-key fallback: an unrecognised code is structurally
 * unrenderable rather than dependent on a fallback string staying neutral.
 *
 * Messages are OP-AGNOSTIC — one `gatewayResponse()` serves 18 routes, so
 * nothing here may assume the killswitch. Every one opens "Not applied —":
 * these render into an emergency-stop result banner, and a failed emergency stop
 * must read unmistakably as failed.
 */
export const GATEWAY_ERROR_PLAIN: Record<string, string> = {
  // --- minted in gateway-client.ts (Hub process, before the gateway is reached)
  gateway_token_missing:
    "Not applied — the Hub has no gateway credentials configured, so the request was never sent. Set GATEWAY_TOKEN in .env.local and restart the Hub.",
  gateway_unreachable:
    "Not applied — the Hub could not reach the local write gateway. Check that the gateway service is running, then retry.",
  gateway_timeout:
    "Not applied — the local write gateway did not respond in time. Retry; if it keeps timing out the gateway is wedged and needs attention.",

  // --- minted in gateway/server.js (the local Node gateway)
  unauthorized:
    "Not applied — the write gateway rejected the Hub's credentials. The Hub and the gateway hold different tokens; re-sync GATEWAY_TOKEN and restart both.",
  not_found:
    "Not applied — the write gateway has no such endpoint. The Hub and the gateway are running different versions; redeploy the gateway.",
  unknown_op:
    "Not applied — the write gateway does not allow this operation. It is not on the gateway's allowlist, so nothing was changed and retrying will not help.",
  validation:
    "Not applied — the write gateway rejected the request as invalid. Correct the input and retry.",
  invalid_json:
    "Not applied — the write gateway could not read the request. Retry; if it repeats, the Hub is sending a malformed request and needs a fix.",
  payload_too_large:
    "Not applied — the request was too large for the write gateway. Reduce the size of the input and retry.",
  vm_gateway_not_configured:
    "Not applied — the VM write gateway is not configured, so writes are disabled. This needs the VM gateway deployed and its address set; it will not clear on its own.",
  vm_gateway_unreachable:
    "Not applied — the Hub could not reach the VM over the tailnet. Check the VM and the Tailscale link, then retry.",
  // 🚨 A forward timeout is genuinely AMBIGUOUS — the VM may have applied the
  // write before the Hub gave up. "Retry" is the wrong advice here and is
  // exactly what a single generic message would have produced.
  vm_gateway_timeout:
    "Not applied by the Hub — the VM did not respond in time. The write may or may not have landed on the VM; check the VM's audit log before retrying.",
  vm_gateway_error:
    "Not applied — the VM write gateway failed while handling the request. Check the VM gateway's log; retrying is unlikely to help until it is fixed.",
  internal_error:
    "Not applied — the write gateway hit an internal fault. Check the gateway's log, retry once, then escalate.",
};

/**
 * Status-code fallback, used ONLY when the body carries no recognised code.
 *
 * This tier exists because of the VM pass-through above: a 423 arrives as
 * `{gate: …}` with no `error` key at all, and "locked by a flag" has a real
 * remedy worth stating. The key here is an HTTP status — an integer the Hub
 * chose or read off the response, never caller-controlled text — so this tier
 * is as incapable of emitting a raw identifier as the allowlist is.
 */
const GATEWAY_STATUS_PLAIN: Record<number, string> = {
  400: "Not applied — the write gateway rejected the request. Correct the input and retry.",
  401: "Not applied — the write gateway rejected the Hub's credentials. Re-sync the gateway token and restart both.",
  403: "Not applied — the write gateway refused this request. It is not permitted; nothing was changed.",
  423: "Not applied — this write is locked by a gateway flag. It stays blocked until the flag is enabled; retrying now will not help.",
  500: "Not applied — the write gateway hit an internal fault. Check the gateway's log, retry once, then escalate.",
  502: "Not applied — the write gateway could not be reached. Check that the gateway and the VM are up, then retry.",
  504: "Not applied by the Hub — the write gateway did not respond in time. The write may or may not have landed; check the audit log before retrying.",
};

/**
 * The last-resort phrase. Neutral, names nothing, and — the load-bearing part —
 * cannot be mistaken for success.
 */
export const GATEWAY_ERROR_FALLBACK =
  "Not applied — the write gateway reported a failure the Hub does not recognise.";

/**
 * Gloss a write-gateway failure into plain English.
 *
 * 🚨 Own-property lookup via `ownLabel`: a bare `MAP[raw]` returns
 * `Object.prototype` for `"__proto__"` and the `Object` function for
 * `"constructor"`, neither of which is null, so `?? null` never fires and a
 * non-string reaches React — which throws on an object child and blanks the
 * panel. That crash is live in the older `plain*()` helpers; it is not
 * reproduced here.
 *
 * ALWAYS returns a string, and that string is ALWAYS a failure sentence. There
 * is no input — unmapped code, prototype key, empty, null, undefined, or a
 * non-string of any shape — for which the raw value can be echoed back.
 */
export function plainGatewayError(
  raw: string | null | undefined,
  status?: number | null,
): string {
  if (typeof raw === "string" && raw) {
    const mapped = ownLabel(GATEWAY_ERROR_PLAIN, raw);
    if (mapped) return mapped;
  }
  if (typeof status === "number" && Number.isFinite(status)) {
    const byStatus = Object.prototype.hasOwnProperty.call(
      GATEWAY_STATUS_PLAIN,
      status,
    )
      ? GATEWAY_STATUS_PLAIN[status]
      : null;
    if (byStatus) return byStatus;
  }
  return GATEWAY_ERROR_FALLBACK;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * READ-PATH failures (B13) — the gloss for a Python reader that could not answer.
 *
 * 🚨 WHY A CODE AND NOT A MESSAGE. The routes used to put `String(err)` into the
 * payload, so `runPython`'s own throw — `python exit=N: <500 chars of stderr>` —
 * and a bare `OperationalError: no such table: promotion_ready` both landed in
 * an <EmptyState body>. The reader now emits a STABLE CODE; the English lives
 * here. `runPython`'s message is DELIBERATELY UNCHANGED (65 consumers, and that
 * message is the server-log detail) — the ROUTE decides what the client sees.
 *
 * Every phrase NAMES A FAILURE and points at the server log. None can be read as
 * success, and none echoes a path, a table name, an exception class or stderr.
 * ────────────────────────────────────────────────────────────────────────────*/

export const READER_ERROR_PLAIN: Record<string, string> = {
  db_unavailable:
    "Couldn't load this — the Hub could not open its copy of the trading database. This is a read-only view, so nothing was changed. The detail is in the Hub's server log; try again in a few minutes.",
  no_table:
    "Couldn't load this — the table this view reads has not been created yet. Nothing is wrong with your account or your trades; the job that builds it may not have run. The detail is in the Hub's server log.",
  query_failed:
    "Couldn't load this — the Hub reached its copy of the trading database but the read failed. This is a read-only view, so nothing was changed. The detail is in the Hub's server log.",
  reader_failed:
    "Couldn't load this — the reader that supplies this view did not return a usable answer. This is a read-only view, so nothing was changed. The detail is in the Hub's server log; try again in a few minutes.",
};

/**
 * The last-resort read-path phrase. Neutral, names nothing, and — the
 * load-bearing part — cannot be mistaken for an empty-but-healthy view.
 */
export const READER_ERROR_FALLBACK =
  "Couldn't load this — the Hub hit a failure it does not recognise. This is a read-only view, so nothing was changed. The detail is in the Hub's server log.";

/**
 * Gloss a read-path failure into plain English.
 *
 * 🚨 Own-property lookup via `ownLabel` — see `plainGatewayError` for why a bare
 * `MAP[raw]` is unsafe on a key set this file does not control.
 *
 * ALWAYS returns a string, and that string ALWAYS names a failure. There is no
 * input — unmapped code, prototype key, empty, null, undefined, or a non-string
 * of any shape — for which a raw value can be echoed back.
 */
export function plainReaderError(raw: unknown): string {
  if (typeof raw === "string" && raw) {
    const mapped = ownLabel(READER_ERROR_PLAIN, raw);
    if (mapped) return mapped;
  }
  return READER_ERROR_FALLBACK;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ACTIVITY-FEED note keys (B13, UO-4) — the `k=v` serializer's replacement.
 *
 * 🚨 THE LIVE LEAK WAS NOT THE HUB'S OWN SERIALIZERS. `query_activity.py` welds
 * four `k=v` strings of its own, and all four produce ZERO live rows. What is on
 * screen today is `change_log.notes` PASSED THROUGH RAW from the VM writer:
 * 1,592 of 1,764 non-null notes carry `=`, and 1,573 of them read
 * `caller=models:close_trade:1723 via=db_writer:_run:189 status=ALLOWED`.
 * The producer is on the VM and out of scope, so the reader parses the inbound
 * string into structure and the renderer decides the English.
 *
 * 🚨 WHY `caller`, `via` AND `idem` ARE DELIBERATELY ABSENT. This is an
 * ALLOWLIST (returns `null`; the caller drops and counts, rendering "+N more").
 * A mapped key still ships its VALUE to the screen, and those three carry a
 * source location, a call path and an idempotency hash — bot internals that are
 * not the thing the user asked to see. Omitting them costs a counted row; the
 * durable record is untouched in `change_log`. When in doubt, omit.
 * ────────────────────────────────────────────────────────────────────────────*/

export const NOTE_KEY_PLAIN: Record<string, string> = {
  // ── observed in change_log.notes (VM writers) ─────────────────────────────
  status: "Write guard",
  reason: "Reason",
  op: "Operation",
  money_path: "Touches the money path",
  equity: "Equity",
  // ── minted by query_activity.py's own readers ─────────────────────────────
  source: "Source",
  changed_by: "Changed by",
  trade_id: "Trade",
  delta: "Threshold change",
  duration: "Duration",
  signals: "Signals fired",
  // ── circuit_breaker_trips.details (JSON blob, 7 keys) ─────────────────────
  winrate: "Win rate",
  baseline_winrate: "Baseline win rate",
  threshold: "Threshold",
  sigma_threshold: "Sigma threshold",
  window: "Window",
  wins: "Wins",
  losses: "Losses",
};

/**
 * An activity-note key, for the expanded row's detail list.
 *
 * ALLOWLIST semantics: `null` means the caller MUST drop the pair and count it,
 * rendering the tally through `bitsWithDropped()`. An unmapped key is therefore
 * structurally unrenderable — it does not depend on a fallback staying neutral.
 */
export function plainNoteKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ownLabel(NOTE_KEY_PLAIN, raw);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CHANGE-PASSWORD failures (B13, UO-3).
 *
 * 🚨 WHAT THIS REPLACES. `api/auth/route.ts` returned
 * `Failed to write password: Error: EACCES: permission denied, open
 * '/home/ghost/…/.env.local'` — a raw Node exception carrying an ABSOLUTE
 * FILESYSTEM PATH, rendered verbatim by `change-password-modal.tsx`. That is an
 * information disclosure on a Tailscale-Funnel-exposed surface, and the modal is
 * the ONLY place a user learns the change failed.
 *
 * So every phrase below does three things: it says the password was NOT changed,
 * it says the OLD password still works (so nobody is locked out wondering), and
 * it says whether retrying helps. None can be read as success.
 *
 * ⚠️ SCOPE: change-password only. The LOGIN branches of that route keep their
 * own plain `error` strings and are untouched — the login page renders those.
 * ────────────────────────────────────────────────────────────────────────────*/

export const AUTH_ERROR_PLAIN: Record<string, string> = {
  wrong_current_password:
    "That current password is not correct. Your password was not changed — check it and try again.",
  new_password_too_short:
    "Your new password must be at least 6 characters. Your password was not changed — choose a longer one and try again.",
  config_not_found:
    "Your password was NOT changed — the Hub could not find the file it stores the password in. Your existing password still works. The detail is in the Hub's server log; retrying will not help until that is fixed.",
  write_failed:
    "Your password was NOT changed — the Hub could not save the new one. Your existing password still works. The detail is in the Hub's server log; retrying will not help until that is fixed.",
};

/** Neutral last resort. Names the failure, and says the old password still works. */
export const AUTH_ERROR_FALLBACK =
  "Your password was NOT changed — the Hub hit a failure it does not recognise. Your existing password still works. The detail is in the Hub's server log.";

/**
 * Gloss a change-password failure into plain English.
 *
 * 🚨 Own-property lookup, and ALWAYS a failure sentence — there is no input for
 * which a raw server string, a path, or an exception can be echoed back.
 */
export function plainAuthError(raw: unknown): string {
  if (typeof raw === "string" && raw) {
    const mapped = ownLabel(AUTH_ERROR_PLAIN, raw);
    if (mapped) return mapped;
  }
  return AUTH_ERROR_FALLBACK;
}
