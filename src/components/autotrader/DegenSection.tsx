"use client";

import { Rocket, Activity } from "lucide-react";
import { BotSectionHeader } from "@/components/autotrader/BotSectionHeader";
import { DEGEN_CONFIG } from "@/lib/bots";

const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const INPUT_BG = "#0a0a0f";

const ACCENT = DEGEN_CONFIG.accentColor; // #ff00ff (magenta)
const STATUS_AMBER = "#ffa502";

const STATIC_CONFIG: Array<{ label: string; value: string; isRiskBar?: boolean }> = [
  { label: "Capital", value: "$50.00" },
  { label: "Mode", value: "Paper" },
  { label: "Max Concurrent", value: "5" },
  { label: "Strategy", value: "YOLO Moonshot" },
  { label: "Risk Level", value: "MAX", isRiskBar: true },
  { label: "Tickers", value: "ALL (auto-scan)" },
];

const DEGEN_TRAITS: string[] = [
  "Same signal architecture",
  "Same confidence scoring",
  "Tuned for max aggression",
  "Separate $50 account",
];

export function DegenSection() {
  return (
    <>
      <BotSectionHeader
        bot={DEGEN_CONFIG}
        statusBadge={{ label: "NOT CONNECTED", color: STATUS_AMBER }}
      />

      {/* ── Awaiting Connection card ── */}
      <div
        className="rounded-lg p-5 sm:p-6"
        style={{
          background: `${INPUT_BG}cc`,
          border: `1px dashed ${ACCENT}4d`,
        }}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div
            className="inline-flex items-center justify-center rounded-full"
            style={{
              width: 56,
              height: 56,
              background: `${ACCENT}1a`,
              border: `1px solid ${ACCENT}55`,
              boxShadow: `0 0 24px ${ACCENT}22`,
            }}
          >
            <Rocket size={26} style={{ color: ACCENT }} aria-hidden />
          </div>

          <div
            className="text-[14px] sm:text-[15px] font-bold"
            style={{
              color: ACCENT,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              letterSpacing: "0.14em",
            }}
          >
            AWAITING CONNECTION
          </div>

          <p
            className="text-[12px] sm:text-[13px] max-w-md leading-relaxed"
            style={{
              color: TEXT,
              opacity: 0.85,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            }}
          >
            Aggressive meme/micro-cap perp scanner and trader. Scans ALL
            Hyperliquid tickers for moonshot opportunities.
          </p>

          <ul
            className="text-left text-[11px] sm:text-[12px] flex flex-col gap-1 mt-1"
            style={{
              color: MUTED,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            }}
          >
            {DEGEN_TRAITS.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block flex-shrink-0"
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 999,
                    background: ACCENT,
                  }}
                />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <div
            className="mt-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
            style={{
              color: MUTED,
              opacity: 0.7,
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            }}
          >
            <span
              aria-hidden
              className="inline-block"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: STATUS_AMBER,
                opacity: 0.8,
              }}
            />
            <span>Status: Bot not deployed</span>
          </div>
        </div>
      </div>

      {/* ── Static config display (read-only) ── */}
      <div
        className="rounded-lg"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <div
          className="flex items-center gap-2 border-b px-3 sm:px-4 py-2"
          style={{ borderColor: BORDER }}
        >
          <span
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: MUTED,
            }}
          >
            Configuration
          </span>
          <span
            className="ml-auto text-[10px]"
            style={{ color: MUTED, opacity: 0.7 }}
          >
            planned · uneditable
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            style={{
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {STATIC_CONFIG.map((row) => (
              <div
                key={row.label}
                className="rounded border px-3 py-2"
                style={{
                  background: INPUT_BG,
                  borderColor: BORDER,
                  opacity: 0.92,
                }}
              >
                <div
                  className="text-[10px] uppercase tracking-[0.1em] flex items-center gap-1.5"
                  style={{ color: MUTED, opacity: 0.85 }}
                >
                  <span aria-hidden>🔒</span>
                  <span>{row.label}</span>
                </div>
                {row.isRiskBar ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: `${ACCENT}1a` }}
                      aria-label="Risk level: MAX"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "100%",
                          background: ACCENT,
                          boxShadow: `0 0 8px ${ACCENT}66`,
                        }}
                      />
                    </div>
                    <span
                      className="text-[12px] font-bold"
                      style={{
                        color: ACCENT,
                        fontFamily:
                          "var(--font-display, 'Orbitron', sans-serif)",
                        letterSpacing: "0.1em",
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ) : (
                  <div
                    className="text-[13px] font-semibold mt-0.5"
                    style={{ color: TEXT, opacity: 0.95 }}
                  >
                    {row.value}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div
            className="mt-3 text-[10px] text-center"
            style={{ color: MUTED, opacity: 0.6 }}
          >
            Settings will become editable once the DEGEN bot is deployed.
          </div>
        </div>
      </div>

      {/* ── Empty Recent Activity feed ── */}
      <div
        className="rounded-lg"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <div
          className="flex items-center gap-2 border-b px-3 sm:px-4 py-2"
          style={{ borderColor: BORDER }}
        >
          <Activity size={14} style={{ color: MUTED }} aria-hidden />
          <span
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: MUTED,
            }}
          >
            Recent Activity
          </span>
        </div>
        <div className="px-3 sm:px-4 py-10 text-center">
          <div
            className="text-[12px]"
            style={{
              color: MUTED,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            }}
          >
            No activity yet
          </div>
          <div
            className="text-[10px] mt-1"
            style={{
              color: MUTED,
              opacity: 0.6,
              fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            }}
          >
            Bot will appear here once deployed
          </div>
        </div>
      </div>
    </>
  );
}
