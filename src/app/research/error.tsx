"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded bg-[rgba(255,51,102,0.08)] border border-[rgba(255,51,102,0.2)]">
          <AlertTriangle className="h-8 w-8 text-[var(--neon-red)]" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-[0.1em] uppercase text-[var(--neon-red)] mb-1">
            SYSTEM ERROR
          </h2>
          <p className="text-[11px] text-muted-foreground">
            A component failed to render. This is usually caused by a temporary API issue.
          </p>
        </div>
        <button
          onClick={reset}
          className="btn-primary flex items-center gap-2 px-4 py-2"
        >
          <RefreshCw className="h-3 w-3" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Retry</span>
        </button>
      </div>
    </div>
  );
}
