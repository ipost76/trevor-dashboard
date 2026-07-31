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
