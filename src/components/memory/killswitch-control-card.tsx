"use client";
import * as React from "react";
import {
  Card,
  Pill,
  HapticButton,
  BottomSheet,
  Skeleton,
} from "@/components/ui";
import { ShieldOff, ShieldCheck, AlertTriangle, Clock, Info } from "lucide-react";

interface KillswitchState {
  /** 🚨 null is the UNKNOWN value, never false. See killswitch_state. */
  enabled: boolean | null;
  /** C3: the three-state discriminator. Absent on a pre-fix cached payload. */
  killswitch_state?: "engaged" | "disengaged" | "unknown";
  lastToggle?: string;
  lastAuthor?: string;
  lastReason?: string;
  error?: string;
}
interface SetResponse {
  ok: boolean;
  no_change?: boolean;
  action?: string;
  EMERGENCY_KILLSWITCH?: string;
  new_state?: { enabled: boolean; last_toggle?: string; last_author?: string; last_reason?: string };
  prev_enabled?: boolean;
  note?: string;
  error?: string;
}

const POLL_MS = 30_000;
const ENDPOINT = "/api/killswitch";

/**
 * Emergency Killswitch write toggle (Hub-Only Control Doctrine, Rule 32
 * rewritten 2026-05-02). Replaces the read-only "Killswitch banner" that
 * previously sat at the top of the System Health page.
 *
 * Mirrors the G2 aggressive toggle pattern: 2-tap BottomSheet
 * confirmation, audit trail (via auto_trader.killswitch.set_killswitch
 * which writes EMERGENCY_KILLSWITCH_LAST_* rows + emits
 * [KILLSWITCH-ON]/[KILLSWITCH-OFF] WARN sentinels).
 *
 * Toggling ON does NOT close any open position, cancel any HL order, or
 * restart any service (Rule 1 + Rule 31 still binding). It only blocks
 * NEW signal posts and new AutoTrader entries.
 *
 * Topbar `KillswitchPill` is the read-only mirror — same `/api/killswitch`
 * GET, 5s poll, visible only when ON.
 */
export function KillswitchControlCard() {
  const [state, setState] = React.useState<KillswitchState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirmTarget, setConfirmTarget] = React.useState<"on" | "off" | null>(null);
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [result, setResult] = React.useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (res.ok) {
        setState((await res.json()) as KillswitchState);
      } else {
        // 🚨 C3: a non-2xx used to leave `state` at null, which the render
        // collapsed to "Off · New trades allowed". An unreadable killswitch is
        // NAMED, never rendered as the disengaged state.
        setState({ killswitch_state: "unknown", enabled: null, error: `HTTP ${res.status}` });
      }
    } catch {
      // Network failure / no response at all — same rule: say UNKNOWN.
      setState({ killswitch_state: "unknown", enabled: null, error: "unreachable" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchState();
    const id = setInterval(() => void fetchState(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  const submit = async (target: "on" | "off") => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: target,
          reason: target === "on" ? "Hub: engaged via System Health" : "Hub: released via System Health",
          author: "ghost",
          // B5: server-verified password re-confirm. Wrong/empty → 401, killswitch
          // does NOT fire (gateway never called); the error surfaces below.
          password,
        }),
      });
      const payload = (await res.json()) as SetResponse;
      if (res.ok && payload.ok) {
        if (payload.no_change) {
          setResult({
            tone: "ok",
            message: `Already ${target.toUpperCase()} — no change.`,
          });
        } else {
          setResult({
            tone: "ok",
            message: `Killswitch ${target === "on" ? "ENGAGED" : "released"}. Bot pickup ≤5s.`,
          });
        }
      } else {
        setResult({ tone: "err", message: payload.error || "Toggle failed." });
      }
    } catch (err) {
      setResult({ tone: "err", message: String(err) });
    } finally {
      setSubmitting(false);
      setConfirmTarget(null);
      setPassword(""); // never persist the secret in state after an attempt
      void fetchState();
    }
  };

  if (loading && !state) {
    return <Skeleton className="h-32 w-full" />;
  }

  // 🚨 C3-FALSE-SUCCESS-SWEEP: THREE states, not two. This was
  // `const enabled = !!state?.enabled`, which coerced BOTH "no data yet" and
  // "the read failed" into false and rendered them as "Off · New trades
  // allowed" — a confident all-clear about the emergency stop, sourced from no
  // reading at all. A producer-side fix alone could not have closed it: this
  // line would have flattened `enabled: null` right back to false.
  const unknown =
    state == null || state.killswitch_state === "unknown" || state.enabled == null;
  const enabled = state?.enabled === true;

  return (
    <Card padding="md" className={enabled || unknown ? "card-warn" : "card-base"}>
      {/* Identity row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldOff size={20} className="text-accent-red" aria-hidden />
          ) : unknown ? (
            <AlertTriangle size={20} className="text-accent-gold" aria-hidden />
          ) : (
            <ShieldCheck size={20} className="text-accent-mint" aria-hidden />
          )}
          <div>
            <div className="font-sans text-caption uppercase tracking-wider text-fg-muted">
              Emergency Killswitch
            </div>
            <div
              className={
                "font-sans text-h3 font-semibold " +
                (enabled ? "text-accent-red" : unknown ? "text-accent-gold" : "text-fg-primary")
              }
            >
              {enabled ? "ENGAGED" : unknown ? "UNKNOWN" : "Off"}
            </div>
          </div>
        </div>
        {/* C2: this pill's text was the raw flag name EMERGENCY_KILLSWITCH,
            which restated the heading beside it in identifier form and told a
            reader nothing extra. It now says what the state MEANS.
            C3: and when it cannot be read, it says THAT — never "allowed". */}
        <Pill
          tone={enabled ? "red" : "neutral"}
          intent={unknown ? "warn" : undefined}
          size="sm"
          pulse={enabled}
        >
          {enabled ? "New trades blocked" : unknown ? "State unreadable" : "New trades allowed"}
        </Pill>
      </div>
      {unknown && (
        // The reason is deliberately NOT interpolated here: the helper's `error`
        // carries a raw exception string, and a Python reader emits STRUCTURE
        // while the renderer decides the English. The console keeps the detail.
        <div className="mt-2 font-sans text-micro text-accent-gold">
          Could not read the killswitch state. This is NOT an all-clear — the emergency stop
          may be engaged or disengaged. Check the bot directly before acting.
        </div>
      )}

      {/* Audit metadata */}
      {state && (state.lastToggle || state.lastAuthor) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 font-sans text-micro text-fg-muted">
          <Clock size={12} aria-hidden />
          <span>
            Last toggle: <span className="font-mono">{state.lastToggle || "(unknown)"}</span> · by {state.lastAuthor || "(unknown)"}
          </span>
          {state.lastReason && (
            <span className="basis-full font-sans text-micro text-fg-muted">
              Reason: {state.lastReason}
            </span>
          )}
        </div>
      )}

      {/* Toggle controls */}
      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <HapticButton
          variant="destructive"
          size="md"
          fullWidth
          onClick={() => setConfirmTarget("on")}
          disabled={enabled || submitting}
          aria-label="Activate Killswitch"
        >
          <ShieldOff size={16} className="mr-2" aria-hidden />
          Activate Killswitch
        </HapticButton>
        <HapticButton
          variant="primary"
          size="md"
          fullWidth
          onClick={() => setConfirmTarget("off")}
          disabled={!enabled || submitting}
          aria-label="Release Killswitch"
        >
          <ShieldCheck size={16} className="mr-2" aria-hidden />
          Release Killswitch
        </HapticButton>
      </div>

      {/* Collapsed help — one line + info-tap reveal (B8) */}
      <div className="mt-3">
        <p className="flex items-start gap-1.5 font-sans text-micro text-fg-muted">
          <span className="min-w-0">
            Killswitch ON blocks ALL new signal cards + AutoTrader entries.
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
            aria-label={helpOpen ? "Hide killswitch details" : "Show killswitch details"}
            className="tap-target -m-2 shrink-0 p-2 text-fg-muted transition-colors duration-fast hover:text-fg-primary"
          >
            <Info size={13} aria-hidden />
          </button>
        </p>
        {helpOpen && (
          <p className="mt-1 font-sans text-micro text-fg-muted">
            Open positions stay monitored — exits run on their own merits. Does
            NOT close, cancel, or restart anything.
          </p>
        )}
      </div>

      {result && (
        <div
          className={
            "mt-3 flex items-start gap-2 rounded-md border p-3 font-sans text-caption " +
            (result.tone === "ok"
              ? "border-accent-mint/40 bg-accent-mint/10 text-accent-mint-strong"
              : "border-accent-red/40 bg-accent-red/10 text-accent-red")
          }
        >
          <span className="break-words">{result.message}</span>
        </div>
      )}

      {/* 2-tap confirm sheet */}
      <BottomSheet
        open={confirmTarget !== null}
        onClose={() => {
          if (!submitting) {
            setConfirmTarget(null);
            setPassword("");
          }
        }}
        title={`Confirm ${confirmTarget === "on" ? "Activate" : "Release"} Killswitch`}
      >
        <div className="space-y-4 p-4">
          <div
            className={
              "flex items-start gap-2 rounded-md border p-3 font-sans text-caption " +
              (confirmTarget === "on"
                ? "border-accent-red/40 bg-accent-red/10 text-accent-red"
                : "border-accent-gold/40 bg-accent-gold/10 text-accent-gold-strong")
            }
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-1">
              <div className="font-semibold">
                {confirmTarget === "on"
                  ? "Engage Emergency Killswitch"
                  : "Release Emergency Killswitch"}
              </div>
              <div className="text-micro text-fg-muted">
                {confirmTarget === "on"
                  ? "Blocks ALL new signal cards + AutoTrader entries immediately. Open positions stay monitored. Does NOT close, cancel, or restart anything."
                  : "Signal cards + AutoTrader entries resume on the bot's next 5s cache-bust. No effect on existing trades."}
              </div>
            </div>
          </div>
          <div className="font-sans text-micro text-fg-muted">
            Author: <span className="text-fg-primary">ghost</span> · This change
            is recorded in the audit trail, and the bot logs a warning when it
            takes effect.
          </div>
          {/* B5: server-verified password re-confirm before the killswitch fires */}
          <div className="space-y-1.5">
            <label
              htmlFor="killswitch-password"
              className="block font-sans text-micro uppercase tracking-wider text-fg-muted"
            >
              Re-enter dashboard password
            </label>
            <input
              id="killswitch-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password.trim() && !submitting && confirmTarget) {
                  void submit(confirmTarget);
                }
              }}
              disabled={submitting}
              placeholder="Password required to fire"
              className="w-full rounded-md border border-accent-cyan-soft/40 bg-bg-elevated px-3 py-2 font-mono text-caption text-fg-primary outline-none transition-colors duration-fast focus:border-accent-cyan-soft focus:shadow-glow-focus"
            />
            <p className="font-sans text-micro text-fg-muted">
              Verified server-side — a wrong or empty password will NOT fire the killswitch.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <HapticButton
              variant="ghost"
              size="md"
              fullWidth
              onClick={() => {
                setConfirmTarget(null);
                setPassword("");
              }}
              disabled={submitting}
            >
              Cancel
            </HapticButton>
            <HapticButton
              variant={confirmTarget === "on" ? "destructive" : "primary"}
              size="md"
              fullWidth
              onClick={() => confirmTarget && void submit(confirmTarget)}
              disabled={submitting || !password.trim()}
            >
              {submitting
                ? "Saving…"
                : `Confirm ${confirmTarget === "on" ? "Activate" : "Release"}`}
            </HapticButton>
          </div>
        </div>
      </BottomSheet>
    </Card>
  );
}
