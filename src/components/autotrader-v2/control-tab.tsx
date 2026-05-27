"use client";
import * as React from "react";

export function ControlTab() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="font-sans text-label-ui text-fg-faint">Control Center</div>
      <div className="text-caption text-fg-muted">
        Coming in Wave D2 — 89 boolean toggles across Execution / Signal Gates /
        Critic Stack / Calibration / Risk / Experimental.
      </div>
    </div>
  );
}
