"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, ShieldAlert, ShieldCheck } from "lucide-react";

// Two-tap kill switch with 3s confirmation window.
// Tap 1 → "Confirm Kill?" + 3s timer. Tap 2 within window → POST activate.
// If kill switch already active → button shows "DEACTIVATE" instead.

const RED = "#ff4757";
const AMBER = "#ffa502";
const DARK = "#0a0a0f";

type KillState = {
  active: boolean;
  activated_at?: string;
  reason?: string;
};

type Stage = "idle" | "confirm" | "submitting";

export function KillSwitch({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<KillState>({ active: false });
  const [stage, setStage] = useState<Stage>("idle");
  const [err, setErr] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/kill-switch", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as KillState;
      setState({
        active: !!data.active,
        activated_at: data.activated_at,
        reason: data.reason,
      });
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      clearInterval(id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [refresh]);

  const cancelConfirm = useCallback(() => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setStage("idle");
  }, []);

  const startConfirm = useCallback(() => {
    setErr(null);
    setStage("confirm");
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setStage("idle");
      confirmTimer.current = null;
    }, 3000);
  }, []);

  const submit = useCallback(
    async (action: "activate" | "deactivate") => {
      setStage("submitting");
      setErr(null);
      try {
        const res = await fetch("/api/kill-switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason: action === "activate" ? "Hub KILL ALL button" : undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await refresh();
        setStage("idle");
      } catch (e) {
        setErr(String(e));
        setStage("idle");
      }
    },
    [refresh]
  );

  const onClick = useCallback(() => {
    if (stage === "submitting") return;
    if (state.active) {
      submit("deactivate");
      return;
    }
    if (stage === "idle") {
      startConfirm();
    } else if (stage === "confirm") {
      cancelConfirm();
      submit("activate");
    }
  }, [stage, state.active, startConfirm, cancelConfirm, submit]);

  // Visual state
  const active = state.active;
  const confirming = stage === "confirm";
  const submitting = stage === "submitting";

  let label: string;
  let bg: string;
  let fg: string;
  let Icon = Zap;
  if (submitting) {
    label = "WORKING…";
    bg = "transparent";
    fg = AMBER;
    Icon = Zap;
  } else if (active) {
    label = "DEACTIVATE";
    bg = AMBER;
    fg = DARK;
    Icon = ShieldCheck;
  } else if (confirming) {
    label = "CONFIRM KILL?";
    bg = RED;
    fg = DARK;
    Icon = ShieldAlert;
  } else {
    label = "KILL ALL";
    bg = RED;
    fg = DARK;
    Icon = Zap;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        aria-label={active ? "Deactivate kill switch" : "Trigger kill all"}
        className={`group inline-flex items-center justify-center gap-1.5 rounded-md font-semibold uppercase tracking-[0.1em] transition ${
          confirming ? "kill-pulse" : ""
        }`}
        style={{
          fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
          background: bg,
          color: fg,
          minHeight: compact ? 36 : 44,
          minWidth: compact ? 116 : 132,
          padding: compact ? "0.25rem 0.7rem" : "0.45rem 0.9rem",
          fontSize: compact ? 11 : 12,
          letterSpacing: "0.1em",
          boxShadow: active
            ? `0 0 12px ${AMBER}55`
            : confirming
            ? `0 0 18px ${RED}88`
            : `0 0 8px ${RED}33`,
          border: `1px solid ${active ? AMBER : RED}`,
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        <Icon size={compact ? 13 : 15} aria-hidden />
        <span>{label}</span>
      </button>
      <span
        className="text-[9px] uppercase tracking-[0.1em]"
        style={{
          color: active ? AMBER : confirming ? RED : "#5a5a6a",
          fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
          minHeight: 12,
        }}
      >
        {err
          ? <span style={{ color: RED }}>{err}</span>
          : active
          ? "kill-switch ENGAGED"
          : confirming
          ? "tap again — 3s window"
          : "two-tap to engage"}
      </span>
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes kill-pulse-kf{0%,100%{transform:scale(1);box-shadow:0 0 18px " +
            RED +
            "88}50%{transform:scale(1.04);box-shadow:0 0 26px " +
            RED +
            "}}.kill-pulse{animation:kill-pulse-kf .9s ease-in-out infinite}",
        }}
      />
    </div>
  );
}
