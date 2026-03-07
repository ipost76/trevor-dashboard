"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function PageError({
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
        <div className="flex h-12 w-12 items-center justify-center rounded bg-[rgba(255,71,87,0.08)] border border-[rgba(255,71,87,0.2)]">
          <AlertTriangle className="h-6 w-6 text-[var(--neon-red)]" />
        </div>
        <div>
          <h2 className="text-xs font-bold tracking-[0.1em] uppercase text-[var(--neon-red)] mb-1" style={{ fontFamily: "var(--font-display)" }}>
            MODULE ERROR
          </h2>
          <p className="text-[11px] text-muted-foreground font-mono">
            {error.message || "This section failed to load."}
          </p>
        </div>
        <button
          onClick={reset}
          className="btn-primary flex items-center gap-2"
        >
          <RefreshCw className="h-3 w-3" />
          RETRY
        </button>
      </div>
    </div>
  );
}
