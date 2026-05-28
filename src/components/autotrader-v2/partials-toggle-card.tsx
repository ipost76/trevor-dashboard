"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  HapticButton,
  BottomSheet,
} from "@/components/ui";
import { Scissors, Lock, AlertTriangle, Clock, ShieldOff } from "lucide-react";

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
const ENDPOINT = "/api/auto/partials-toggle";

/**
 * Live Partial Exits toggle (B4, 2026-05-27).
 *
 * Hub write surface for `auto_config.LIVE_PARTIALS_ENABLED`. Defaults OFF
 * (shadow-only). When ON, Layer 5 partial exits execute live via
 * `execute_partial_live()` (reduce-only IOC); the eval-side shadow log
 * (partial_trigger_shadow) accumulates rows regardless.
 *
 * 2-tap BottomSheet confirmation per Rule 32, audit row in
 * autotrader_state_audit. Flipping ON does NOT close any open position
 * or restart any service — it changes the next monitor cycle's behavior
 * only when Layer 5 fires.
 */
export function PartialsToggleCard() {
  const [data, setData] = React.useState<ToggleResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [confirmTarget, setConfirmTarget] = React.useState<"on" | "off" | null>(null);
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
        setResult({ tone: "err", message: "Locked — HUB_LIVE_PARTIALS_TOGGLE_ENABLED is false." });
      } else if (res.ok && payload.ok) {
        if (payload.no_change) {
          setResult({
            tone: "ok",
            message: `Already ${payload.new_value?.toUpperCase()} — no change.`,
          });
        } else {
          setResult({
            tone: "ok",
            message: `${target === "on" ? "Enabled" : "Disabled"} (audit #${payload.audit_id}). Applies at next monitor cycle.`,
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
  const lastChange = data?.audit && data.audit.length > 0 ? data.audit[0] : null;

  return (
    <Card padding="md" className="card-elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scissors
              size={18}
              className={enabled ? "text-accent-mint" : "text-accent-gold"}
              aria-hidden
            />
            <CardTitle>Live Partial Exits</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {enabled ? (
              <Pill intent="running" size="sm">LIVE</Pill>
            ) : (
              <Pill intent="warn" size="sm">SHADOW</Pill>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Last change line */}
      {lastChange && (
        <div className="mb-3 flex items-center gap-2 font-sans text-micro text-fg-muted">
          <Clock size={12} />
          Last change: {lastChange.action} ·{" "}
          <span className="font-mono">{lastChange.timestamp}</span> ·{" "}
          {lastChange.source}
        </div>
      )}

      {/* Killswitch advisory (informational; does NOT block the toggle) */}
      {killswitchOn && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
          <ShieldOff size={16} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Killswitch is ENGAGED</div>
            <div className="text-micro text-fg-muted">
              No new entries will execute while the killswitch is on. Partial
              exits run only on positions already open.
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
                HUB_LIVE_PARTIALS_TOGGLE_ENABLED=true
              </code>{" "}
              in <code className="font-mono">auto_config</code> to unlock.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 font-sans">
          <div>
            <div className="text-sm font-semibold text-fg-primary">
              {enabled ? "Executing live" : "Shadow-only"}
            </div>
            <div className="text-micro text-fg-muted">
              Schedule:{" "}
              <span className="font-mono text-fg-primary">0.75R / 33%</span>{" "}·{" "}
              <span className="font-mono text-fg-primary">1.5R / 50%</span>
            </div>
          </div>
          <HapticButton
            variant={enabled ? "secondary" : "primary"}
            size="md"
            onClick={() => setConfirmTarget(enabled ? "off" : "on")}
            disabled={!toggleEnabled || submitting}
            aria-label={enabled ? "Disable Live Partials" : "Enable Live Partials"}
          >
            {submitting ? "Saving…" : enabled ? "Disable" : "Enable"}
          </HapticButton>
        </div>

        <p className="font-sans text-micro text-fg-muted">
          When ON, partial exits execute live via reduce-only IOC at +0.75R
          (33%) and +1.5R (50%). When OFF, the eval still runs every monitor
          cycle and writes to <code className="font-mono">partial_trigger_shadow</code>{" "}
          — shadow data only.
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

      {/* 2-tap confirm sheet */}
      <BottomSheet
        open={confirmTarget !== null}
        onClose={() => (submitting ? undefined : setConfirmTarget(null))}
        title={`Confirm ${confirmTarget === "on" ? "Enable" : "Disable"} Live Partials`}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 p-3 font-sans text-caption text-accent-gold-strong">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-1">
              <div className="font-semibold">
                {confirmTarget === "on"
                  ? "Promote partials from shadow to live"
                  : "Demote partials back to shadow-only"}
              </div>
              <div className="text-micro text-fg-muted">
                {confirmTarget === "on"
                  ? "Layer 5 PARTIAL_EXIT will start executing reduce-only IOC orders on live trades when r_multiple crosses 0.75R / 1.5R. Killswitch + per-ticker stop still apply. Capital cap removed per RM-07 P00 — live HL balance is the only limit."
                  : "Layer 5 PARTIAL_EXIT will stop executing on live trades. Shadow eval continues; paper-mode partials are unaffected."}
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
              variant={confirmTarget === "on" ? "primary" : "destructive"}
              size="md"
              fullWidth
              onClick={() => confirmTarget && void submit(confirmTarget)}
              disabled={submitting}
            >
              {submitting
                ? "Saving…"
                : `Confirm ${confirmTarget === "on" ? "Enable" : "Disable"}`}
            </HapticButton>
          </div>
        </div>
      </BottomSheet>
    </Card>
  );
}
