"use client";

import type { BotConfig, BotMode } from "@/lib/bots";

const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";

type StatusBadge = {
  label: string;
  color: string;
  variant?: "outline" | "solid";
};

interface Props {
  bot: BotConfig;
  // SCALPER passes the live-fetched mode here (overrides bot.mode default).
  dynamicMode?: BotMode;
  // DEGEN-style override — when set, shows this badge instead of mode pill.
  statusBadge?: StatusBadge;
}

export function BotSectionHeader({ bot, dynamicMode, statusBadge }: Props) {
  const accent = bot.accentColor;
  const mode = dynamicMode ?? bot.mode;
  const isLive = mode === "live";
  const tickerLine = bot.tickers.join(" · ");

  return (
    <div>
      {/* Top accent line — 30% accent color (rgba via hex8) */}
      <div
        aria-hidden
        style={{
          height: 1,
          background: `${accent}4d`,
          marginBottom: 10,
        }}
      />

      <div
        className="rounded-lg"
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
        }}
      >
        {/* Identity row: icon + name + badge */}
        <div
          className="flex items-center gap-2 flex-wrap px-3 sm:px-4 py-2"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[14px] sm:text-[15px] font-bold leading-none"
            style={{
              color: accent,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              letterSpacing: "0.1em",
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>
              {bot.icon}
            </span>
            <span>{bot.name}</span>
          </span>

          {statusBadge ? (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold flex-shrink-0"
              style={{
                background:
                  statusBadge.variant === "solid"
                    ? statusBadge.color
                    : `${statusBadge.color}1a`,
                color:
                  statusBadge.variant === "solid" ? "#0a0a0f" : statusBadge.color,
                border: `1px solid ${statusBadge.color}55`,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                letterSpacing: "0.12em",
              }}
            >
              {statusBadge.label}
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold flex-shrink-0"
              style={{
                background: isLive ? accent : `${accent}1a`,
                color: isLive ? "#0a0a0f" : accent,
                border: `1px solid ${accent}55`,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                letterSpacing: "0.12em",
              }}
              title={isLive ? "Real money trading" : "Simulated paper trading"}
            >
              {isLive ? "LIVE" : "PAPER"}
            </span>
          )}

          <span className="flex-1" />
        </div>

        {/* Detail rows: tickers, exchange + capital */}
        <div
          className="px-3 sm:px-4 py-2 flex flex-col gap-0.5 text-[11px] sm:text-[12px]"
          style={{
            color: MUTED,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
          }}
        >
          <div
            className="truncate"
            style={{ color: TEXT, opacity: 0.85, letterSpacing: "0.02em" }}
          >
            {tickerLine}
          </div>
          <div className="truncate" style={{ opacity: 0.8 }}>
            <span>{bot.exchange}</span>
            <span style={{ opacity: 0.4 }}> · </span>
            <span>${bot.capital} Capital</span>
            {bot.description && (
              <>
                <span style={{ opacity: 0.4 }}> · </span>
                <span>{bot.description}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
