"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Zap } from "lucide-react";

export default function AutoTraderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AutoTrader] Page error:", error);
  }, [error]);

  const message = error.message?.includes("fetch")
    ? "AutoTrader API is unreachable. The backend may be restarting."
    : error.message?.includes("hook")
    ? "A rendering error occurred. This is a bug — report to Ghost."
    : "AutoTrader failed to load data. This may be a temporary issue.";

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded bg-[rgba(255,170,0,0.08)] border border-[rgba(255,170,0,0.2)]">
          <Zap className="h-8 w-8 text-[var(--neon-amber)]" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-[0.1em] uppercase text-[var(--neon-amber)] mb-1">
            AUTOTRADER ERROR
          </h2>
          <p className="text-[11px] text-muted-foreground">{message}</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">
            {error.message?.slice(0, 120)}
          </p>
        </div>
        <button
          onClick={() => {
            reset();
            window.location.reload();
          }}
          className="btn-primary flex items-center gap-2 px-4 py-2"
        >
          <RefreshCw className="h-3 w-3" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Retry</span>
        </button>
      </div>
    </div>
  );
}
