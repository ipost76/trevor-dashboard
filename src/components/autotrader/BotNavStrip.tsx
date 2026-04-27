"use client";

import type { BotConfig } from "@/lib/bots";

const BORDER = "#1e2030";
const BG = "var(--sidebar, #080d09)";

function statusLabel(status: BotConfig["status"]): string {
  switch (status) {
    case "active":
      return "● active";
    case "not_connected":
      return "○ coming soon";
    case "offline":
      return "○ offline";
    case "error":
      return "⚠ error";
  }
}

export function BotNavStrip({ bots }: { bots: BotConfig[] }) {
  const handleClick = (anchorId: string) => {
    const el = document.getElementById(anchorId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 overflow-x-auto"
      style={{
        background: BG,
        borderBottom: `1px solid ${BORDER}`,
        scrollbarWidth: "none",
      }}
      aria-label="Bot selector"
    >
      {bots.map((b) => {
        const accent = b.accentColor;
        const inactive = b.status !== "active";
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => handleClick(b.scrollAnchorId)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold flex-shrink-0 transition-all active:scale-[0.96] hover:opacity-90"
            style={{
              background: `${accent}1a`,
              color: accent,
              border: `1px solid ${accent}55`,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              letterSpacing: "0.1em",
              opacity: inactive ? 0.85 : 1,
            }}
            aria-label={`Jump to ${b.name} section`}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              {b.icon}
            </span>
            <span>{b.name}</span>
            <span
              className="ml-0.5 text-[9px]"
              style={{ opacity: 0.7, letterSpacing: "0.04em" }}
            >
              {statusLabel(b.status)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
