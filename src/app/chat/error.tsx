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
        <div
          className="flex h-16 w-16 items-center justify-center rounded"
          style={{
            background: "rgba(255,51,102,0.08)",
            border: "1px solid var(--color-accent-red-subtle)",
          }}
        >
          <AlertTriangle className="h-8 w-8 text-accent-red" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-label-ui text-accent-red mb-1" style={{ fontSize: "13px", letterSpacing: "0.1em" }}>
            SYSTEM ERROR
          </h2>
          <p className="text-caption-ui text-fg-muted">
            A component failed to render. This is usually caused by a temporary API issue.
          </p>
        </div>
        <button
          onClick={reset}
          className="text-label-ui flex items-center gap-2 rounded px-4 py-2 transition-all duration-fast"
          style={{
            background: "rgba(95,180,204,0.1)",
            border: "1px solid var(--color-accent-cyan-soft)",
            color: "var(--color-accent-cyan-soft-strong)",
          }}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
          <span>Retry</span>
        </button>
      </div>
    </div>
  );
}
