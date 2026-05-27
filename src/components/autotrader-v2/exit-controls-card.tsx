"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  HapticButton,
} from "@/components/ui";
import { Sliders, Lock, Clock } from "lucide-react";

interface AuditEntry {
  id: number;
  action: string;
  prev_value: string | null;
  new_value: string;
  source: string;
  timestamp: string;
}
interface ExitControlsResponse {
  promoted: boolean;
  confirm_cycles: number;
  toggle_enabled: boolean;
  shadow_enabled: boolean;
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
const ENDPOINT = "/api/auto/exit-controls";

/**
 * Exit Engine Controls — Momentum Confirm Cycles production gate (B3,
 * 2026-05-27).
 *
 * Single-tap toggle for `auto_config.CONFIRM_CYCLES_PROMOTED`. When ON,
 * Layer 6 momentum EXIT requires N consecutive sub-threshold readings
 * (N from MOMENTUM_EXIT_CONFIRM_CYCLES, default 2) before firing — gives
 * other exit layers time to activate instead of bailing on the first
 * sub-55 cycle after warmup. Production behavior is byte-identical to
 * pre-B3 when the flag is OFF (default).
 *
 * NOT destructive (no Rule 1 implication). Single-tap is intentional —
 * `cfg_bool` has no cache on the bot side, so changes apply at the next
 * monitor cycle (~30s) with no service restart. Flip back to OFF the same
 * way if you want to roll back.
 */
export function ExitControlsCard() {
  const [data, setData] = React.useState<ExitControlsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as ExitControlsResponse);
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
      const value = target === "on" ? "true" : "false";
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, author: "ghost" }),
      });
      const payload = (await res.json()) as SetResponse;
      if (res.status === 423) {
        setResult({ tone: "err", message: "Locked — HUB_CONFIRM_CYCLES_TOGGLE_ENABLED is false." });
      } else if (res.ok && payload.ok) {
        if (payload.no_change) {
          setResult({
            tone: "ok",
            message: `Already ${payload.new_value?.toUpperCase()} — no change.`,
          });
        } else {
          setResult({
            tone: "ok",
            message: `${target === "on" ? "Enabled" : "Disabled"} (audit #${payload.audit_id}). Applies at next monitor cycle (~30s).`,
          });
        }
      } else {
        setResult({ tone: "err", message: payload.error || "Toggle failed." });
      }
    } catch (err) {
      setResult({ tone: "err", message: String(err) });
    } finally {
      setSubmitting(false);
      void fetchState();
    }
  };

  if (loading && !data) {
    return <Skeleton className="h-44 w-full" />;
  }

  const promoted = !!data?.promoted;
  const toggleEnabled = !!data?.toggle_enabled;
  const cycles = data?.confirm_cycles ?? 0;
  const lastChange = data?.audit && data.audit.length > 0 ? data.audit[0] : null;

  return (
    <Card padding="md" className="card-elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders
              size={18}
              className={promoted ? "text-accent-mint" : "text-accent-gold"}
              aria-hidden
            />
            <CardTitle>Exit Engine Controls</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {promoted ? (
              <Pill intent="active" size="sm">ARMED</Pill>
            ) : (
              <Pill intent="warn" size="sm">OFF</Pill>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Last change line — confirm_cycles_* events only */}
      {lastChange && (
        <div className="mb-3 flex items-center gap-2 font-sans text-micro text-fg-muted">
          <Clock size={12} />
          Last change: {lastChange.action} ·{" "}
          <span className="font-mono">{lastChange.timestamp}</span> ·{" "}
          {lastChange.source}
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
                HUB_CONFIRM_CYCLES_TOGGLE_ENABLED=true
              </code>{" "}
              in <code className="font-mono">auto_config</code> to unlock.
            </div>
          </div>
        </div>
      )}

      {/* Toggle row — single-tap (not destructive; flag flip with hot-reload) */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 font-sans">
          <div>
            <div className="text-sm font-semibold text-fg-primary">Momentum Confirm Cycles</div>
            <div className="text-micro text-fg-muted">
              Window N ={" "}
              <span className="font-mono text-fg-primary">{cycles}</span>{" "}
              (from <code className="font-mono">MOMENTUM_EXIT_CONFIRM_CYCLES</code>)
            </div>
          </div>
          <HapticButton
            variant={promoted ? "secondary" : "primary"}
            size="md"
            onClick={() => void submit(promoted ? "off" : "on")}
            disabled={!toggleEnabled || submitting}
            aria-label={promoted ? "Disable Confirm Cycles" : "Enable Confirm Cycles"}
          >
            {submitting ? "Saving…" : promoted ? "Disable" : "Enable"}
          </HapticButton>
        </div>

        <p className="font-sans text-micro text-fg-muted">
          When ARMED, Layer 6 momentum EXIT requires {cycles || "N"} consecutive
          sub-threshold readings before firing — gives other exit layers
          (stale, timeout) time to activate. Changes apply at the next
          monitor cycle (~30s, hot-reload, no service restart). Shadow
          logging runs regardless of this setting.
        </p>
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
    </Card>
  );
}
