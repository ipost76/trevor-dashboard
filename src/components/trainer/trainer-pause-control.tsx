"use client";
import * as React from "react";
import { Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

// TrainerPauseControl — R12-B3 (H5), the trainer PAUSE control on the TRAINER page.
//
// 🚨 THE HONESTY CONTRACT. This records a durable pause REQUEST; it does NOT stop
// a running loop. trainer_loop.run_trainer_loop() reads TRAINER_LOOP_ENABLED once
// at entry — its while-body never re-reads it — so the daemon must POLL the pause
// state per-iteration (that wiring lands in R13). Until then this records INTENT
// only. The copy below NEVER renders "trainer paused" as an asserted daemon state
// — it says "pause requested / recorded / takes effect once the daemon polls".
//
// Gated by HUB_PAUSE_CONTROL_ENABLED (default OFF): when off the control renders
// NOTHING (returns null). The pause covers the trainer + R8 loop only — it writes
// ONLY the trainer_pause_state row (VM-side), never a WATCHER_* flag. THE WATCHER
// STAYS ON.

type Phase = "idle" | "pending" | "error";

interface PauseState {
  enabled: boolean;
  paused: boolean;
  scope: string | null;
  requested_at: string | null;
  requested_by: string | null;
  reason: string | null;
  replica_age_seconds: number | null;
  error?: string | null;
}

// Map an HTTP status (+ optional body error) → a clear, honest inline message.
function messageForStatus(
  status: number,
  action: "pause" | "resume",
  bodyError?: string,
): { text: string; tone: "ok" | "warn" | "err" } {
  switch (status) {
    case 200:
      return {
        text:
          action === "pause"
            ? "Pause requested — recorded. The trainer stops once the daemon polls (R13)."
            : "Resume requested — recorded. The loop restarts once the daemon polls (R13).",
        tone: "ok",
      };
    case 400:
      return { text: bodyError ? `Rejected: ${bodyError}` : "Invalid request.", tone: "err" };
    case 401:
      return { text: "Session expired — reload the page.", tone: "err" };
    case 423:
      return { text: "Pause control is disabled — HUB_PAUSE_CONTROL_ENABLED is off on the VM.", tone: "warn" };
    case 500:
      return { text: bodyError ? `Server error: ${bodyError}` : "Gateway not configured.", tone: "err" };
    case 502:
      return { text: "VM gateway unreachable — pause not recorded.", tone: "warn" };
    case 504:
      return { text: "VM gateway timed out — pause not recorded.", tone: "warn" };
    default:
      return { text: bodyError ? `Error (${status}): ${bodyError}` : `Error (${status}).`, tone: "err" };
  }
}

export function TrainerPauseControl() {
  const [data, setData] = React.useState<PauseState | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [reason, setReason] = React.useState("");
  const [msg, setMsg] = React.useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/trainer/pause", { cache: "no-store" });
      const b = (await res.json()) as PauseState;
      setData(b);
    } catch {
      // fail-soft: leave data null → the control stays hidden rather than erroring
      setData((prev) => prev ?? { enabled: false, paused: false, scope: null, requested_at: null, requested_by: null, reason: null, replica_age_seconds: null });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submit = React.useCallback(
    async (action: "pause" | "resume") => {
      if (phase === "pending") return;
      setPhase("pending");
      setMsg(null);
      try {
        const res = await fetch("/api/trainer/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
        });
        let bodyError: string | undefined;
        let result: { paused?: unknown } | undefined;
        try {
          result = (await res.json()) as { paused?: unknown; error?: unknown };
          if (typeof (result as { error?: unknown })?.error === "string") {
            bodyError = (result as { error?: string }).error;
          }
        } catch {
          /* body may be empty / non-JSON */
        }
        setMsg(messageForStatus(res.status, action, bodyError));
        if (res.status === 200) {
          // Optimistic: the gateway 200 unwraps the helper result (carries `paused`).
          // The GET reads the ~15-30min-lagging replica, so trust the write here.
          setData((prev) =>
            prev
              ? { ...prev, paused: typeof result?.paused === "number" ? result.paused === 1 : action === "pause" }
              : prev,
          );
          setPhase("idle");
          setReason("");
        } else {
          setPhase("error");
        }
      } catch (e) {
        setMsg({ text: `Couldn't reach the Hub: ${String(e)}`, tone: "err" });
        setPhase("error");
      }
    },
    [phase, reason],
  );

  // Flag OFF (default) → render NOTHING. Also hidden while the first GET is in
  // flight (data === null) to avoid a flash.
  if (!data || !data.enabled) return null;

  const busy = phase === "pending";
  const paused = data.paused;

  return (
    <div className="rounded-lg border border-accent-plum-subtle bg-bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-sans text-caption font-semibold text-fg-primary">Trainer pause</h3>
          {paused ? (
            <Pill intent="warn" size="sm">
              PAUSE REQUESTED
            </Pill>
          ) : (
            <Pill intent="running" size="sm">
              RUNNING
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!paused && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="reason (optional)"
              disabled={busy}
              className={cn(
                "w-40 rounded border border-border-subtle bg-bg-elevated px-2 py-1 font-sans text-micro text-fg-primary",
                "placeholder:text-fg-faint focus:border-accent-plum focus:outline-none disabled:opacity-50",
              )}
            />
          )}
          <button
            type="button"
            onClick={() => submit(paused ? "resume" : "pause")}
            disabled={busy}
            className={cn(
              "rounded border px-3 py-1 font-sans text-micro font-medium uppercase tracking-wider transition-colors duration-fast disabled:opacity-50",
              paused
                ? "border-accent-mint-strong/40 text-accent-mint-strong hover:bg-accent-mint/10"
                : "border-accent-gold-strong/40 text-accent-gold-strong hover:bg-accent-gold/10",
            )}
          >
            {busy ? "…" : paused ? "Request resume" : "Request pause"}
          </button>
        </div>
      </div>

      <p className="mt-2 font-sans text-micro leading-relaxed text-fg-muted">
        {paused
          ? "Pause requested — recorded, not yet enforced. The trainer + R8 loop stop once the daemon polls (R13). The watcher stays on."
          : "Running — no pause requested. Requesting a pause records intent; the trainer daemon enforces it once wired (R13). This never stops an already-running loop by itself."}
      </p>

      {paused && (data.requested_by || data.reason || data.requested_at) && (
        <p className="mt-1 font-sans text-micro leading-tight text-fg-faint">
          {data.requested_by ? `by ${data.requested_by}` : ""}
          {data.reason ? ` · ${data.reason}` : ""}
          {data.requested_at ? ` · ${data.requested_at}` : ""}
        </p>
      )}

      {msg && (
        <p
          className={cn(
            "mt-2 font-sans text-micro leading-tight",
            msg.tone === "ok" && "text-accent-mint-strong",
            msg.tone === "warn" && "text-accent-gold-strong",
            msg.tone === "err" && "text-accent-red",
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
