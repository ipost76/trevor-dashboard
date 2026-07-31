"use client";
import * as React from "react";
import { Pill } from "@/components/ui";
import { fmtAge } from "@/components/watcher/watcher-format";
import { cn } from "@/lib/utils";

// TrainerPauseControl — the trainer PAUSE control on the TRAINER page.
//
// 🚨 THE HONESTY CONTRACT. This reports a durable pause REQUEST and NOTHING ELSE.
// The Hub reads the replica; it has NO input describing the trainer daemon — not
// its unit state, not its process, not a heartbeat. So this control must never
// make a claim about the daemon.
//
// It used to render `paused ? "PAUSE REQUESTED" : "RUNNING"` — a pure binary on a
// single flag — under the heading "Trainer pause", where a green RUNNING pill read
// as "the trainer is running". Measured 2026-07-31: the unit is installed but
// disabled and has never started, no process exists, and there is no trainer unit
// on the VM at all. The badge was vouching for a daemon it cannot see.
//
// It compounded: trainer_pause_state does not exist in the replica, and the reader
// fail-softed that absence straight to paused:false — so the TOTAL ABSENCE of any
// pause record was rendered as positive evidence of health. The reader now returns
// three states and this renders three, none of them green, none of them naming the
// daemon.
//
// Gated by the Hub's pause-control flag (default OFF): when off the control renders
// NOTHING (returns null). The pause covers the trainer only — it writes ONLY the
// trainer_pause_state row (VM-side), never a watcher flag. THE WATCHER STAYS ON.

type Phase = "idle" | "pending" | "error";

// "unknown" = the pause table is absent, the read failed, or no record has ever
// existed. It is NEVER folded into "not_paused"; that collapse was the bug.
type PauseDiscriminator = "paused" | "not_paused" | "unknown";

interface PauseState {
  enabled: boolean;
  pause_state: PauseDiscriminator;
  paused: boolean | null;
  scope: string | null;
  requested_at: string | null;
  requested_by: string | null;
  reason: string | null;
  replica_age_seconds: number | null;
  error?: string | null;
}

// Map an HTTP status → a fixed, plain sentence. The status code and the response
// body never reach the screen: a number and a server's error string tell the
// reader nothing they can act on.
function messageForStatus(
  status: number,
  action: "pause" | "resume",
): { text: string; tone: "ok" | "warn" | "err" } {
  const what = action === "pause" ? "pause" : "resume";
  switch (status) {
    case 200:
      return {
        text:
          action === "pause"
            ? "Pause requested. It takes effect within about 30 seconds."
            : "Resume requested. It takes effect within about 30 seconds.",
        tone: "ok",
      };
    case 400:
      return { text: `That request wasn't valid — the ${what} was not recorded.`, tone: "err" };
    case 401:
      return { text: "Your session expired. Reload the page and try again.", tone: "err" };
    case 423:
      return { text: "Pausing is switched off right now.", tone: "warn" };
    case 500:
      return { text: "Couldn't send the request — the connection to the bot isn't set up.", tone: "err" };
    case 502:
    case 504:
      return { text: `Couldn't reach the bot — the ${what} was not recorded. Try again.`, tone: "warn" };
    default:
      return { text: `Something went wrong — the ${what} was not recorded.`, tone: "err" };
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
      // Fail-soft: keep the last good read; otherwise the control stays hidden
      // rather than erroring. The fallback state is UNKNOWN — a failed read is
      // not a reading of "not paused".
      setData(
        (prev) =>
          prev ?? {
            enabled: false,
            pause_state: "unknown",
            paused: null,
            scope: null,
            requested_at: null,
            requested_by: null,
            reason: null,
            replica_age_seconds: null,
          },
      );
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
        let result: { paused?: unknown } | undefined;
        try {
          result = (await res.json()) as { paused?: unknown };
        } catch {
          /* body may be empty / non-JSON */
        }
        setMsg(messageForStatus(res.status, action));
        if (res.status === 200) {
          // Optimistic: the gateway 200 unwraps the helper result (carries `paused`).
          // The GET reads the ~15-30min-lagging replica, so trust the write here.
          //
          // 🚨 A successful write is a KNOWN state — it must move `pause_state` off
          // "unknown" as well as setting `paused`. Updating only `paused` would
          // leave the badge reading "Pause state unknown" straight after the user
          // watched their own request succeed.
          setData((prev) => {
            if (!prev) return prev;
            const nowPaused =
              typeof result?.paused === "number" ? result.paused === 1 : action === "pause";
            return {
              ...prev,
              paused: nowPaused,
              pause_state: nowPaused ? "paused" : "not_paused",
            };
          });
          setPhase("idle");
          setReason("");
        } else {
          setPhase("error");
        }
      } catch {
        setMsg({
          text: "Couldn't reach the Hub. Check your connection and try again.",
          tone: "err",
        });
        setPhase("error");
      }
    },
    [phase, reason],
  );

  // Flag OFF (default) → render NOTHING. Also hidden while the first GET is in
  // flight (data === null) to avoid a flash.
  if (!data || !data.enabled) return null;

  const busy = phase === "pending";
  const state = data.pause_state;
  const paused = state === "paused";

  // 🚨 Three badges, and NONE of them is green. This reports the pause request,
  // never the trainer — the Hub has no way to know whether the trainer is running.
  const badge =
    state === "paused" ? (
      <Pill intent="warn" size="sm">
        Pause requested
      </Pill>
    ) : state === "not_paused" ? (
      <Pill tone="neutral" size="sm">
        No pause requested
      </Pill>
    ) : (
      <Pill intent="warn" size="sm">
        Pause state unknown
      </Pill>
    );

  return (
    <div className="rounded-lg border border-accent-plum-subtle bg-bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-sans text-caption font-semibold text-fg-primary">Trainer pause</h3>
          {badge}
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

      {/* Three states, three explanations — and not one of them claims the
          trainer is running. */}
      <p className="mt-2 font-sans text-micro leading-relaxed text-fg-muted">
        {state === "paused"
          ? "Pause requested. The trainer stops within about 30 seconds. Monitoring keeps running."
          : state === "not_paused"
            ? "Nobody has asked the trainer to pause. Asking it to pause takes up to 30 seconds to take effect. This says nothing about whether the trainer is running."
            : "There is no pause record to read, so nobody can tell from here whether a pause has been asked for. This is expected before the trainer is switched on for the first time."}
      </p>

      {paused && (data.requested_by || data.reason || data.requested_at) && (
        <p className="mt-1 font-sans text-micro leading-tight text-fg-faint">
          {data.requested_by ? `by ${data.requested_by}` : ""}
          {data.reason ? ` · ${data.reason}` : ""}
          {data.requested_at ? ` · ${fmtAge(data.requested_at)} ago` : ""}
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
