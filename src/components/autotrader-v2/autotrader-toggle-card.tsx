"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  HapticButton,
  BottomSheet,
} from "@/components/ui";
import { Power, PauseCircle, PlayCircle, Lock, AlertTriangle, Clock, ShieldOff } from "lucide-react";

interface AuditEntry {
  id: number;
  action: string;
  prev_value: string | null;
  new_value: string;
  source: string;
  timestamp: string;
}
interface ToggleResponse {
  enabled: boolean;
  toggle_enabled: boolean;
  killswitch_enabled: boolean;
  audit: ReadonlyArray<AuditEntry>;
  error?: string;
}
interface SetResponse {
  ok: boolean;
  no_change?: boolean;
  prev_value?: string;
  new_value?: string;
  action?: string;
  audit_id?: number;
  note?: string;
  gate_locked?: boolean;
  error?: string;
}

const POLL_MS = 30_000;
const ENDPOINT = "/api/memory/autotrader-toggle";

// Human-readable explanations of each audit action. Keys are matched
// case-insensitively against `audit.action`. Verified 2026-05-23 against
// the bot codebase:
//   - start/pause            → set_autotrader_enabled.py (Rule 32 carve-out)
//   - devil_advocate_enabled → devil_advocate.py (DEVIL_ADVOCATE_ENABLED env)
//   - swarm_judgment_*       → auto_trader/judgment.py (AI_SWARM_JUDGMENT_ENABLED)
//   - partial_thresholds_*   → auto_trader/ticker_exit_profiles.py partial_schedule
//   - calibrator_v2_live_*   → discord_bot.py CALIBRATOR_LIVE confidence pipeline
const TOGGLE_DESCRIPTIONS: Record<string, string> = {
  start: "Resumes AutoTrader — new entries will execute on the next signal",
  pause:
    "Pauses new AutoTrader entries; open positions keep being monitored",
  devil_advocate_enabled:
    "Devil's Advocate critic challenges signals before execution",
  swarm_judgment_disabled:
    "Swarm consensus voting on signals before execution",
  partial_thresholds_lowered:
    "Partial-take-profit thresholds (R-multiples for exits)",
  calibrator_v2_live_verified:
    "Confidence calibrator v2 running in live (non-shadow) mode",
};

function describeToggle(action: string): string {
  return TOGGLE_DESCRIPTIONS[action.toLowerCase()] ?? "Configuration toggle";
}

/**
 * AutoTrader Pause / Resume toggle (Rule 32 carve-out, 2026-05-02).
 *
 * Single Hub write surface for `auto_config.AUTO_TRADER_ENABLED`. Mirrors
 * the G2 aggressive toggle pattern: 2-tap BottomSheet confirmation,
 * gate-locked behind `HUB_AUTOTRADER_TOGGLE_ENABLED` (defense in depth),
 * audit row on every change.
 *
 * Pausing OFF only blocks NEW AutoTrader entries (per `cfg_bool` check at
 * `auto_trader/config.py:133`). It does NOT close any open position,
 * cancel any HL order, or restart any service (Rule 1 + Rule 31). Manual
 * signal cards in `#scalp-signals` continue firing — killswitch is the
 * only mechanism that blocks both.
 */
export function AutoTraderToggleCard() {
  const [data, setData] = React.useState<ToggleResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirmTarget, setConfirmTarget] = React.useState<"start" | "pause" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as ToggleResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchState();
    const id = setInterval(() => void fetchState(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  const submit = async (target: "start" | "pause") => {
    setSubmitting(true);
    setResult(null);
    try {
      const value = target === "start" ? "true" : "false";
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, author: "ghost" }),
      });
      const payload = (await res.json()) as SetResponse;
      if (res.status === 423) {
        setResult({ tone: "err", message: "Locked — HUB_AUTOTRADER_TOGGLE_ENABLED is false." });
      } else if (res.ok && payload.ok) {
        if (payload.no_change) {
          setResult({
            tone: "ok",
            message: `Already ${payload.new_value?.toUpperCase()} — no change.`,
          });
        } else {
          setResult({
            tone: "ok",
            message: `${target === "start" ? "Resumed" : "Paused"} (audit #${payload.audit_id}). Bot picks up at next signal.`,
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

  if (loading && !data) {
    return <Skeleton className="h-48 w-full" />;
  }

  const enabled = !!data?.enabled;
  const toggleEnabled = !!data?.toggle_enabled;
  const killswitchOn = !!data?.killswitch_enabled;

  return (
    <Card padding="md" className="card-elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Power
              size={18}
              className={enabled ? "text-accent-mint" : "text-accent-gold"}
              aria-hidden
            />
            <CardTitle>AutoTrader Control</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {enabled ? (
              <Pill intent="running" size="sm">RUNNING</Pill>
            ) : (
              <Pill intent="warn" size="sm">PAUSED</Pill>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Last change line */}
      {data?.audit && data.audit.length > 0 && (
        <div className="mb-3 flex items-center gap-2 font-sans text-micro text-fg-muted">
          <Clock size={12} />
          Last change: {data.audit[0].action} ·{" "}
          <span className="font-mono">{data.audit[0].timestamp}</span> ·{" "}
          {data.audit[0].source}
        </div>
      )}

      {/* Killswitch advisory (informational; does NOT block the toggle) */}
      {killswitchOn && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
          <ShieldOff size={16} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Killswitch is ENGAGED</div>
            <div className="text-micro text-fg-muted">
              You can still toggle AutoTrader here, but no entries will execute
              while the killswitch is on.
            </div>
          </div>
        </div>
      )}

      {/* Gate-locked notice */}
      {!toggleEnabled && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
          <Lock size={16} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Toggle locked</div>
            <div className="text-micro text-fg-muted">
              Set{" "}
              <code className="rounded bg-bg-elevated px-1 font-mono text-accent-cyan-soft">
                HUB_AUTOTRADER_TOGGLE_ENABLED=true
              </code>{" "}
              in <code className="font-mono">auto_config</code> to unlock.
            </div>
          </div>
        </div>
      )}

      {/* Toggle controls */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <HapticButton
          variant="primary"
          size="md"
          fullWidth
          onClick={() => setConfirmTarget("start")}
          disabled={!toggleEnabled || enabled || submitting}
          aria-label="Resume AutoTrader"
        >
          <PlayCircle size={16} className="mr-2" aria-hidden />
          Resume Trading
        </HapticButton>
        <HapticButton
          variant="secondary"
          size="md"
          fullWidth
          onClick={() => setConfirmTarget("pause")}
          disabled={!toggleEnabled || !enabled || submitting}
          aria-label="Pause AutoTrader"
        >
          <PauseCircle size={16} className="mr-2" aria-hidden />
          Pause Trading
        </HapticButton>
      </div>

      <p className="mt-3 font-sans text-micro text-fg-muted">
        Pausing stops NEW AutoTrader entries only. Open positions stay
        monitored — exits run on their own merits. Manual signal cards in
        #scalp-signals are not affected.
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

      {/* Recent toggles */}
      {data?.audit && data.audit.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-sans text-caption uppercase tracking-wider text-fg-muted">
            Recent Toggles
          </div>
          <ul className="divide-y divide-border-subtle">
            {data.audit.map((row) => {
              const isStart = row.action === "start";
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 px-1 py-2 text-micro"
                >
                  <Pill intent={isStart ? "running" : "warn"} size="sm">
                    {row.action}
                  </Pill>
                  <span className="font-sans text-fg-muted">
                    {row.prev_value} → {row.new_value}
                  </span>
                  <span className="font-mono text-fg-muted ml-auto">{row.timestamp}</span>
                  <span className="basis-full font-sans text-micro text-fg-muted">
                    {describeToggle(row.action)}
                  </span>
                  <span className="basis-full font-sans text-micro text-fg-faint">
                    {row.source}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data?.audit && data.audit.length === 0 && (
        <div className="mt-4">
          <EmptyState
            icon={<Clock size={28} />}
            title="No history"
            body="No toggle events recorded yet."
          />
        </div>
      )}

      {/* 2-tap confirm sheet */}
      <BottomSheet
        open={confirmTarget !== null}
        onClose={() => (submitting ? undefined : setConfirmTarget(null))}
        title={`Confirm ${confirmTarget === "start" ? "Resume" : "Pause"} AutoTrader`}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-1">
              <div className="font-semibold">
                {confirmTarget === "start"
                  ? "Resume AutoTrader entries"
                  : "Pause AutoTrader entries"}
              </div>
              <div className="text-micro text-fg-muted">
                {confirmTarget === "start"
                  ? "AutoTrader will accept new entries on the next signal. Per-ticker thresholds + killswitch + $50 cap still apply."
                  : "AutoTrader will stop accepting NEW entries. Open positions stay monitored. Exits and manual signal cards are NOT affected."}
              </div>
            </div>
          </div>
          <div className="font-sans text-micro text-fg-muted">
            Author: <span className="text-fg-primary">ghost</span> · Audit row
            will be written to <code className="font-mono">autotrader_state_audit</code>.
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
              variant={confirmTarget === "start" ? "primary" : "destructive"}
              size="md"
              fullWidth
              onClick={() => confirmTarget && void submit(confirmTarget)}
              disabled={submitting}
            >
              {submitting
                ? "Saving…"
                : `Confirm ${confirmTarget === "start" ? "Resume" : "Pause"}`}
            </HapticButton>
          </div>
        </div>
      </BottomSheet>
    </Card>
  );
}
