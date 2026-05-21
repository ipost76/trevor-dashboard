"use client";
import * as React from "react";
import {
  Card,
  Pill,
  HapticButton,
  BottomSheet,
  Skeleton,
} from "@/components/ui";
import { ShieldOff, ShieldCheck, AlertTriangle, Clock } from "lucide-react";

interface KillswitchState {
  enabled: boolean;
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
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (res.ok) setState((await res.json()) as KillswitchState);
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
      void fetchState();
    }
  };

  if (loading && !state) {
    return <Skeleton className="h-32 w-full" />;
  }

  const enabled = !!state?.enabled;

  return (
    <Card padding="md" className={enabled ? "card-warn" : "card-base"}>
      {/* Identity row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldOff size={20} className="text-accent-red" aria-hidden />
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
                (enabled ? "text-accent-red" : "text-fg-primary")
              }
            >
              {enabled ? "ENGAGED" : "Off"}
            </div>
          </div>
        </div>
        <Pill
          tone={enabled ? "red" : "neutral"}
          size="sm"
          pulse={enabled}
        >
          EMERGENCY_KILLSWITCH
        </Pill>
      </div>

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

      <p className="mt-3 font-sans text-micro text-fg-muted">
        Killswitch ON blocks ALL new signal cards + AutoTrader entries.
        Open positions stay monitored — exits run on their own merits. Does
        NOT close, cancel, or restart anything.
      </p>

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
        onClose={() => (submitting ? undefined : setConfirmTarget(null))}
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
                  ? "Blocks ALL new signal cards + AutoTrader entries immediately. Open positions stay monitored. Does NOT close, cancel, or restart anything (Rule 1)."
                  : "Signal cards + AutoTrader entries resume on the bot's next 5s cache-bust. No effect on existing trades."}
              </div>
            </div>
          </div>
          <div className="font-sans text-micro text-fg-muted">
            Author: <span className="text-fg-primary">ghost</span> · Audit recorded
            in <code className="font-mono">auto_config.EMERGENCY_KILLSWITCH_LAST_*</code> · WARNING
            sentinel <code className="font-mono">[KILLSWITCH-{confirmTarget?.toUpperCase()}]</code> emitted.
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <HapticButton
              variant="ghost"
              size="md"
              fullWidth
              onClick={() => setConfirmTarget(null)}
              disabled={submitting}
            >
              Cancel
            </HapticButton>
            <HapticButton
              variant={confirmTarget === "on" ? "destructive" : "primary"}
              size="md"
              fullWidth
              onClick={() => confirmTarget && void submit(confirmTarget)}
              disabled={submitting}
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
