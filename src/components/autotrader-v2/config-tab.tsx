"use client";
import * as React from "react";

export function ConfigTab() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="font-sans text-label-ui text-fg-faint">Config Editor</div>
      <div className="text-caption text-fg-muted">
        Coming in Wave D1 — inline editing of 60 non-boolean{" "}
        <code className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-accent-cyan-soft-strong">
          auto_config
        </code>{" "}
        rows.
      </div>
    </div>
  );
}
