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
  LivePulse,
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
    <Card padding="md" glow={enabled ? "green" : "amber"}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Power
              size={18}
              className={enabled ? "text-accent-green" : "text-accent-amber"}
              aria-hidden
            />
            <CardTitle>AutoTrader Control</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {enabled ? (
              <LivePulse tone="green" label="RUNNING" />
            ) : (
              <Pill tone="amber" size="sm">PAUSED</Pill>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Last change line */}
      {data?.audit && data.audit.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-micro text-fg-muted">
          <Clock size={12} />
          Last change: {data.audit[0].action} · {data.audit[0].timestamp} · {data.audit[0].source}
        </div>
      )}

      {/* Killswitch advisory (informational; does NOT block the toggle) */}
      {killswitchOn && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-caption text-accent-amber">
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
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-caption text-accent-amber">
          <Lock size={16} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Toggle locked</div>
            <div className="text-micro text-fg-muted">
              Set{" "}
              <code className="rounded bg-bg-elevated px-1 text-accent-cyan">
                HUB_AUTOTRADER_TOGGLE_ENABLED=true
              </code>{" "}
              in <code>auto_config</code> to unlock.
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

      <p className="mt-3 text-micro text-fg-muted">
        Pausing stops NEW AutoTrader entries only. Open positions stay
        monitored — exits run on their own merits. Manual signal cards in
        #scalp-signals are not affected.
      </p>

      {result && (
        <div
          className={
            "mt-3 flex items-start gap-2 rounded-md border p-3 text-caption " +
            (result.tone === "ok"
              ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
              : "border-accent-red/40 bg-accent-red/10 text-accent-red")
          }
        >
          <span className="break-words">{result.message}</span>
        </div>
      )}

      {/* Recent toggles */}
      {data?.audit && data.audit.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-caption uppercase tracking-wider text-fg-muted">
            Recent Toggles
          </div>
          <ul className="space-y-2">
            {data.audit.map((row) => {
              const isStart = row.action === "start";
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-micro"
                >
                  <Pill tone={isStart ? "green" : "amber"} size="sm">
                    {row.action}
                  </Pill>
                  <span className="text-fg-muted">
                    {row.prev_value} → {row.new_value}
                  </span>
                  <span className="text-fg-muted ml-auto">{row.timestamp}</span>
                  <span className="basis-full text-micro text-fg-muted">
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
          <div className="flex items-start gap-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-caption text-accent-amber">
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
          <div className="text-micro text-fg-muted">
            Author: <span className="text-fg-primary">ghost</span> · Audit row
            will be written to <code>autotrader_state_audit</code>.
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
