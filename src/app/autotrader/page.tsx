"use client";

import AutoTraderPage from "@/components/autotrader/AutoTraderPage";

export default function AutoTraderRoute() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="shrink-0"
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 16,
          fontWeight: 700,
          color: "#00ff88",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(0,255,136,0.18)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--sidebar, #080d09)",
        }}
      >
        AUTO TRADER
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <AutoTraderPage />
      </div>
    </div>
  );
}
