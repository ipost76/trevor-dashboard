"use client";
import * as React from "react";

export function ActivityTab() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="font-sans text-label-ui text-fg-faint">Activity Log</div>
      <div className="text-caption text-fg-muted">
        Coming in Wave D3 — paginated{" "}
        <code className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-accent-cyan-soft-strong">
          change_log
        </code>{" "}
        readout with actor / source / key filters.
      </div>
    </div>
  );
}
