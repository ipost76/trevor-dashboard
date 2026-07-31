"use client";
import * as React from "react";
import { Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

// ApproveRejectControl — H4, the approve/reject write control on a promotion
// CANDIDATE (R12-B1). Calls POST /api/trainer/promotion-approve → the gateway →
// a RECORD-ONLY write (one promotion_approvals row, applied=0). The Hub records;
// CC applies later.
//
// 🚨 GATED by writeEnabled (HUB_PROMOTION_WRITE_ENABLED, default OFF): when off,
// the row renders READ-ONLY (a muted "approvals disabled" pill, no buttons) —
// byte-identical intent to today. When on, Approve (mint) + Reject (red) fire the
// write; the control disables after a recorded decision (no double-submit) and
// surfaces EVERY documented gateway code as a clear inline message (the fetch
// never throws — a network error is caught and shown, never an uncaught reject).

type Decision = "approve" | "reject";
type Phase = "idle" | "pending" | "done" | "error";

// 🚨 THE ONE SHARED SENTENCE. The promotion list shows this too — it lived as two
// separately-worded copies, which is how two surfaces drift into saying different
// things about the same rule. Exported so there is exactly one to change.
// It deliberately does NOT say a level will be minted: nothing here mints one.
export const APPROVAL_RECORDING_NOTE =
  "Approving here records your decision. Nothing changes on the bot until it is applied separately.";

// Map an HTTP status → a fixed, plain sentence. Neither the status code nor the
// response body reaches the screen — a number and a server's error string tell
// the reader nothing they can act on.
function messageForStatus(status: number): { text: string; tone: "ok" | "warn" | "err" } {
  switch (status) {
    case 200:
      return { text: "Recorded. It gets applied to the bot separately.", tone: "ok" };
    case 400:
      return { text: "That request wasn't valid — nothing was recorded.", tone: "err" };
    case 401:
      return { text: "Your session expired. Reload the page and try again.", tone: "err" };
    case 423:
      return { text: "Approving is switched off right now.", tone: "warn" };
    case 500:
      return { text: "Something went wrong — nothing was recorded.", tone: "err" };
    case 502:
    case 504:
      return { text: "Couldn't reach the bot — nothing was recorded. Try again.", tone: "warn" };
    default:
      return { text: "Something went wrong — nothing was recorded.", tone: "err" };
  }
}

export function ApproveRejectControl({
  candidateId,
  writeEnabled,
}: {
  candidateId: string | null;
  writeEnabled: boolean;
}) {
  // No onRecorded callback: the candidate list reads the ~15-30min-lagging
  // replica, so an immediate refetch wouldn't reflect the just-recorded approval
  // (the write lands on the VM's promotion_approvals; the candidate stays until
  // R8/CC removes it post-cutover). The local APPROVED/REJECTED pill is the
  // immediate feedback; the parent's 60s poll picks up any real change.
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [decided, setDecided] = React.useState<Decision | null>(null);
  const [note, setNote] = React.useState("");
  const [msg, setMsg] = React.useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);

  // Read-only when the flag is off OR the candidate has no id to key the write.
  if (!writeEnabled || !candidateId) {
    return (
      <div className="flex shrink-0 items-center">
        <Pill tone="neutral" size="sm" title={APPROVAL_RECORDING_NOTE}>
          {writeEnabled ? "Can't be approved" : "Approving is off"}
        </Pill>
      </div>
    );
  }

  const submit = React.useCallback(
    async (decision: Decision) => {
      if (phase === "pending" || phase === "done") return;
      setPhase("pending");
      setDecided(decision);
      setMsg(null);
      try {
        const res = await fetch("/api/trainer/promotion-approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            candidate_id: candidateId,
            decision,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        });
        setMsg(messageForStatus(res.status));
        if (res.status === 200) {
          setPhase("done");
        } else {
          setPhase("error");
        }
      } catch {
        // fetch/network failure — never an uncaught reject, and never an
        // exception object stringified into the UI.
        setMsg({
          text: "Couldn't reach the Hub. Check your connection and try again.",
          tone: "err",
        });
        setPhase("error");
      }
    },
    [candidateId, note, phase],
  );

  const busy = phase === "pending";
  const done = phase === "done";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {!done && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          disabled={busy}
          className={cn(
            "w-40 rounded border border-border-subtle bg-bg-card px-2 py-1 font-sans text-micro text-fg-primary",
            "placeholder:text-fg-faint focus:border-accent-cyan-soft focus:outline-none disabled:opacity-50",
          )}
        />
      )}
      <div className="flex items-center gap-1.5">
        {done ? (
          <Pill intent={decided === "approve" ? "active" : "error"} size="sm">
            {decided === "approve" ? "APPROVED" : "REJECTED"}
          </Pill>
        ) : (
          <>
            <button
              type="button"
              onClick={() => submit("approve")}
              disabled={busy}
              className={cn(
                "rounded border px-2.5 py-1 font-sans text-micro font-medium uppercase tracking-wider transition-colors duration-fast",
                "border-accent-mint-strong/40 text-accent-mint-strong hover:bg-accent-mint/10 disabled:opacity-50",
              )}
            >
              {busy && decided === "approve" ? "…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => submit("reject")}
              disabled={busy}
              className={cn(
                "rounded border px-2.5 py-1 font-sans text-micro font-medium uppercase tracking-wider transition-colors duration-fast",
                "border-accent-red/40 text-accent-red hover:bg-accent-red/10 disabled:opacity-50",
              )}
            >
              {busy && decided === "reject" ? "…" : "Reject"}
            </button>
          </>
        )}
      </div>
      {msg && (
        <span
          className={cn(
            "max-w-[16rem] text-right font-sans text-micro leading-tight",
            msg.tone === "ok" && "text-accent-mint-strong",
            msg.tone === "warn" && "text-accent-gold-strong",
            msg.tone === "err" && "text-accent-red",
          )}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
