// ─────────────────────────────────────────────────────────────────────────────
// W4a (2026-07-30) — THE SINGLE AUTHORITY ON "WHAT MODE IS THE BOT IN".
//
// Every mode-rendering surface on the Hub derives from THIS module. It exists
// because the defect it closes was one of duplication-by-omission: three
// surfaces each answered "live or paper?" from whatever field was nearest, and
// the nearest field (`AUTO_LIVE_ENABLED`) gates nothing on the bot. The badge
// read LIVE for the entire v5 paper window, over 1,524 [PAPER-BLOCK] lines and
// zero delivered orders.
//
// 🚨 THE LOAD-BEARING GATE IS `PAPER_WINDOW_ENABLED`, and nothing else.
// VM auto_trader/config.py:398 calls it "the load-bearing boundary gate for the
// v5 cutover"; live_executor._paper_window_on() branches on it. `TRADING_MODE`
// and `AUTO_LIVE_ENABLED` are CONFIGURED values that gate nothing — a badge
// sourced from either reports something both misleading and not load-bearing.
// (RP-V2 found the identical shape on the VM: discord_bot.py renders
// `Mode: {config.TRADING_MODE}` with no paper-window consult. Two boxes, one
// root cause — neither codebase distinguished CONFIGURED from EFFECTIVE.)
//
// 🚨 THERE IS NO TOGGLE, DELIBERATELY. Because every label derives from the
// gate, closing the paper window flips the whole Hub by itself. A manual switch
// would be one more surface that can disagree with reality — and the entire
// point of this change is to remove surfaces that can lie.
//
// 🚨 NEVER HARDCODE A MODE STRING against this. Derive it (RP-C13's precedent).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The EFFECTIVE trading mode, three-valued plus an explicit failure state.
 *
 * The distinction between "off" and "absent" is the one that matters most and
 * is the easiest to collapse by accident:
 *
 *   "on"     the PAPER_WINDOW_ENABLED row is present and true. The bot is
 *            paper-gated: signals are evaluated, no order reaches the exchange.
 *   "off"    the row is present and false. The bot is executing for real. This
 *            is the ONLY state that may render a confident LIVE.
 *   "absent" NO USABLE VALUE in auto_config — the row is missing, empty, or
 *            holds something that is neither literal. UNCONFIRMABLE, and NOT
 *            the same as "off": the VM's DEFAULTS (auto_trader/config.py:410)
 *            map an absent key to 'false', so the bot would be executing LIVE.
 *            Rendering a confident PAPER here would claim a safety we cannot
 *            prove while real money moves; rendering LIVE would assert a fact
 *            we do not have. It renders as unconfirmed — the only honest answer.
 *            🚨 The producer recognises ONLY the exact literals 'true'/'false';
 *            everything else lands here. An earlier draft mapped "not 'true'"
 *            to "off", which would have rendered a confident LIVE off a value
 *            nobody could parse.
 *   "error"  the read itself failed (exception, DB unreadable, route threw,
 *            field missing from the payload). Renders PAPER — a broken read
 *            must never present as LIVE.
 */
export type PaperWindowState = "on" | "off" | "absent" | "error";

export const PAPER_WINDOW_STATES: ReadonlyArray<PaperWindowState> = [
  "on",
  "off",
  "absent",
  "error",
];

/**
 * Coerce an untrusted value to a PaperWindowState.
 *
 * 🚨 THE FAIL DIRECTION LIVES HERE. Anything unrecognised — undefined from an
 * older payload, null, a typo, a truncated response — becomes "error", which
 * renders PAPER. It must never fall through to "off". A surface that treats
 * "I don't know" as "live" is the bug this module exists to prevent, and the
 * only way to guarantee that is to make the unknown case explicit rather than
 * letting a falsy check decide it.
 */
export function normalizePaperWindowState(raw: unknown): PaperWindowState {
  return (PAPER_WINDOW_STATES as ReadonlyArray<unknown>).includes(raw)
    ? (raw as PaperWindowState)
    : "error";
}

/**
 * Is this state one where money is NOT actually moving — i.e. should the
 * surface carry a paper marker?
 *
 * True for everything except a confirmed "off". Note this deliberately returns
 * true for "absent"/"error" as well: those carry a marker, but callers render
 * that marker as UNCONFIRMED (see resolveModeBadge), not as a flat PAPER.
 */
export function isPaperMode(state: PaperWindowState): boolean {
  return state !== "off";
}

/** Is the mode known at all, or merely un-disproven? */
export function isModeConfirmed(state: PaperWindowState): boolean {
  return state === "on" || state === "off";
}

export interface ModeBadge {
  label: "LIVE" | "PAPER" | "PAPER?" | "DISABLED" | "LOADING";
  intent: "live" | "warn" | "error";
  /** One short clause explaining what the label means, for the sub-line. */
  detail: string;
}

/**
 * Resolve the AUTOTRADER header badge.
 *
 * Precedence, and why:
 *   1. no data yet          -> LOADING. Not an assertion about anything.
 *   2. autotrader disabled  -> DISABLED. Outranks the mode: there is nothing to
 *                              be in a mode about, and "PAPER" over a switched-
 *                              off trader would imply it is running.
 *   3. otherwise            -> the effective mode, per PaperWindowState.
 */
export function resolveModeBadge(input: {
  hasData: boolean;
  autoEnabled: boolean;
  state: PaperWindowState;
}): ModeBadge {
  if (!input.hasData) {
    return { label: "LOADING", intent: "warn", detail: "reading mode…" };
  }
  if (!input.autoEnabled) {
    return { label: "DISABLED", intent: "error", detail: "autotrader off" };
  }
  switch (input.state) {
    case "off":
      // The ONLY path to a confident LIVE badge in the entire Hub.
      return { label: "LIVE", intent: "live", detail: "real orders · real money" };
    case "on":
      return {
        label: "PAPER",
        intent: "warn",
        detail: "paper window · no orders sent",
      };
    case "absent":
      return {
        label: "PAPER?",
        intent: "warn",
        // Covers both a missing row and an unparseable one — in either case
        // auto_config is not telling us the mode.
        detail: "Mode unconfirmed — the bot didn't report whether it's on paper",
      };
    case "error":
    default:
      return {
        label: "PAPER",
        intent: "warn",
        detail: "mode could not be read",
      };
  }
}

/**
 * Should the configured-vs-effective disagreement line be shown?
 *
 * Only when the CONFIGURED flag says live while the EFFECTIVE mode does not
 * agree — which is precisely the state that shipped the false badge
 * (AUTO_LIVE_ENABLED=true throughout a paper window). Shown always it would be
 * noise; shown on disagreement it is the one line that explains why the badge
 * is not what the reader expected.
 */
export function configuredDisagrees(input: {
  liveEnabled: boolean;
  state: PaperWindowState;
}): boolean {
  return input.liveEnabled && (input.state === "on" || input.state === "absent");
}
