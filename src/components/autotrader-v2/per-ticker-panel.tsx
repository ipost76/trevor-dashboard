"use client";
import * as React from "react";
import {
  Pill,
  EditableField,
  CollapsibleSection,
  FilterChips,
  HapticButton,
} from "@/components/ui";
import { Lock, FileCode, Database, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfigRow {
  key: string;
  value: string | null;
  updated_at: string | null;
  category: string;
  type: "int" | "float" | "json" | "str" | "bool";
  immutable: boolean;
  immutable_reason: string | null;
}

export interface PerTickerPanelProps {
  configs: ConfigRow[];
  liveEditEnabled: boolean;
  onSave: (key: string, newValue: string) => Promise<void>;
}

const SACRED_TICKERS = [
  "BTC", "ETH", "SOL", "HYPE", "FARTCOIN",
  "XRP", "DOGE", "NEAR", "SUI", "kPEPE",
] as const;
type SacredTicker = (typeof SACRED_TICKERS)[number];

// Source-of-truth mirrors from /home/trevor/trevor/ — surfaced read-only.
// These dicts live in Python source, not auto_config, so the Hub cannot
// edit them. Values verified against the bot repo on 2026-05-27 (sacred 5)
// and 2026-05-28 (RM-07 P02 sacred-ticker expansion 5 -> 10).
//
// SOURCES:
//   ticker_thresholds.py:47  → TICKER_THRESHOLDS          (all 10)
//   ticker_thresholds.py:138 → RECALIBRATED_THRESHOLDS_V2 (orig 5 only)
//   ticker_thresholds.py:178 → DIRECTION_PENALTIES        (orig 5 only)
//   auto_trader/config.py:748 → TICKER_LEVERAGE  (all 10; IMMUTABLE per Ghost ruling 4)
//   auto_trader/monitor.py:630    → MOMENTUM_FLOOR_BY_TICKER (orig 5 only)
//   auto_trader/exit_helpers.py:69 → TICKER_TRAIL_FLOORS     (orig 5 only)
//
// P02 note: the 5 new tickers (XRP/DOGE/NEAR/SUI/kPEPE) have explicit
// per-ticker entries only in TICKER_THRESHOLDS + TICKER_LEVERAGE. In the
// other four dicts they are NOT individually tuned — the bot applies a
// documented fallback (get_direction_penalty → FARTCOIN's 8.0;
// get_momentum_floor → default 50; get_trail_floor → default 0.015;
// RECALIBRATED_THRESHOLDS_V2 → not calibrated). Those dicts are Partial<>
// here and the UI renders the fallback with a "(default)" marker rather
// than inventing a per-ticker value (honesty protocol — no source drift).

interface ThresholdSet {
  quiet: number;
  normal: number;
  active: number;
}

const TICKER_THRESHOLDS: Record<SacredTicker, ThresholdSet> = {
  BTC:      { quiet: 34, normal: 37, active: 40 },
  ETH:      { quiet: 36, normal: 39, active: 42 },
  SOL:      { quiet: 38, normal: 41, active: 44 },
  HYPE:     { quiet: 39, normal: 42, active: 45 },
  FARTCOIN: { quiet: 42, normal: 45, active: 48 },
  XRP:      { quiet: 38, normal: 41, active: 44 },
  DOGE:     { quiet: 42, normal: 45, active: 48 },
  NEAR:     { quiet: 39, normal: 42, active: 45 },
  SUI:      { quiet: 39, normal: 42, active: 45 },
  kPEPE:    { quiet: 42, normal: 45, active: 48 },
};

// V2 shadow recalibration (RM-03 P07) covers only the original sacred 5.
// New tickers are not V2-calibrated → no entry (UI shows "Not calibrated").
const RECALIBRATED_THRESHOLDS_V2: Partial<Record<SacredTicker, ThresholdSet>> = {
  BTC:      { quiet: 51, normal: 54, active: 57 },
  ETH:      { quiet: 53, normal: 56, active: 59 },
  SOL:      { quiet: 53, normal: 56, active: 59 },
  HYPE:     { quiet: 39, normal: 42, active: 45 },
  FARTCOIN: { quiet: 42, normal: 45, active: 48 },
};

// Bot fallbacks for tickers without a bespoke entry (mirror the get_* helpers).
const DIRECTION_PENALTY_FALLBACK = 8;   // get_direction_penalty → DIRECTION_PENALTIES['FARTCOIN']
const MOMENTUM_FLOOR_DEFAULT = 50;      // get_momentum_floor default (MOMENTUM_EXIT_FLOOR)
const TRAIL_FLOOR_DEFAULT = 0.015;      // get_trail_floor default (TRAIL_MIN_PCT)

const DIRECTION_PENALTIES: Partial<Record<SacredTicker, number>> = {
  BTC: 3, ETH: 4, SOL: 5, HYPE: 6, FARTCOIN: 8,
};

const TICKER_LEVERAGE: Record<SacredTicker, number> = {
  BTC: 25, ETH: 15, SOL: 12, HYPE: 10, FARTCOIN: 8,
  XRP: 10, DOGE: 8, NEAR: 8, SUI: 8, kPEPE: 8,
};

const MOMENTUM_FLOOR_BY_TICKER: Partial<Record<SacredTicker, number>> = {
  BTC: 50, ETH: 50, SOL: 52, HYPE: 50, FARTCOIN: 50,
};

const TICKER_TRAIL_FLOORS: Partial<Record<SacredTicker, number>> = {
  BTC: 0.015, ETH: 0.015, SOL: 0.015, HYPE: 0.020, FARTCOIN: 0.025,
};

const SOURCE_TOOLTIP = "Source-code config — edit via CC prompt";

// Read-only row: label + mono value + optional lock icon. Mirrors the
// EditableField visual layout but with no edit affordance.
interface ReadOnlyRowProps {
  label: string;
  value: string;
  immutable?: boolean;
  sourceFile?: string;
  immutableReason?: string;
}
function ReadOnlyRow({
  label,
  value,
  immutable = false,
  sourceFile,
  immutableReason,
}: ReadOnlyRowProps) {
  const tip = immutable && immutableReason
    ? `IMMUTABLE — ${immutableReason}`
    : sourceFile
      ? `${SOURCE_TOOLTIP} — ${sourceFile}`
      : SOURCE_TOOLTIP;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0">
      <span className="font-sans text-label-ui text-fg-muted">{label}</span>
      <span
        className="flex items-center gap-2 px-2 py-1 font-mono text-caption tabular-nums text-fg-faint"
        title={tip}
      >
        <span className="truncate">{value === "" ? "—" : value}</span>
        {immutable ? (
          <Lock size={12} className="shrink-0" aria-hidden />
        ) : (
          <FileCode size={12} className="shrink-0 opacity-60" aria-hidden />
        )}
      </span>
    </div>
  );
}

// Triple-cell threshold row — quiet / normal / active in one line.
function ThresholdsRow({ set }: { set: ThresholdSet }) {
  const Cell = ({ k, v }: { k: string; v: number }) => (
    <div className="flex flex-col items-start gap-0.5">
      <span className="font-sans text-micro uppercase tracking-wider text-fg-faint">
        {k}
      </span>
      <span
        className="font-mono text-caption tabular-nums text-fg-primary"
        title={SOURCE_TOOLTIP}
      >
        {v}
      </span>
    </div>
  );
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-2 py-2">
      <Cell k="Quiet" v={set.quiet} />
      <Cell k="Normal" v={set.normal} />
      <Cell k="Active" v={set.active} />
    </div>
  );
}

function findConfig(configs: ConfigRow[], key: string): ConfigRow | undefined {
  return configs.find((c) => c.key === key);
}

// Parse a JSON dict from a config row value. Returns {} on any error or
// empty input. Caller is responsible for validating the resulting shape.
function parseJsonDict(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}

export function PerTickerPanel({
  configs,
  liveEditEnabled,
  onSave,
}: PerTickerPanelProps) {
  const [ticker, setTicker] = React.useState<SacredTicker>("BTC");

  // Editable per-ticker dict configs sourced from auto_config (D1 editable).
  // DISCOVERED_TICKERS lookup removed 2026-05-28 (DEGEN-REMOVE — auto_config row gone).
  const aloDisabledConfig = findConfig(configs, "ALO_DISABLED_TICKERS");
  const hardStopConfig = findConfig(configs, "TICKER_HARD_STOP_PCT_JSON");
  const leverageV2Config = findConfig(
    configs,
    "LEVERAGE_V2_INTERMEDIATE_JSON",
  );

  const aloDisabledList = parseJsonArray(aloDisabledConfig?.value ?? null);
  const hardStopDict = parseJsonDict(hardStopConfig?.value ?? null);
  const leverageV2Dict = parseJsonDict(leverageV2Config?.value ?? null);

  const aloDisabled = aloDisabledList.includes(ticker);
  const hardStopValue = (() => {
    const v = hardStopDict[ticker];
    return v == null ? "" : String(v);
  })();
  const leverageV2Value = (() => {
    const v = leverageV2Dict[ticker];
    return v == null ? "" : String(v);
  })();

  const [aloPending, setAloPending] = React.useState(false);
  const [aloError, setAloError] = React.useState<string | null>(null);

  const toggleAlo = React.useCallback(async () => {
    if (!aloDisabledConfig) {
      setAloError("ALO_DISABLED_TICKERS not in payload");
      return;
    }
    setAloPending(true);
    setAloError(null);
    try {
      const next = aloDisabled
        ? aloDisabledList.filter((t) => t !== ticker)
        : [...aloDisabledList, ticker];
      // Stable sort so the JSON round-trip is deterministic.
      next.sort();
      await onSave("ALO_DISABLED_TICKERS", JSON.stringify(next));
    } catch (e) {
      setAloError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setAloPending(false);
    }
  }, [aloDisabled, aloDisabledList, aloDisabledConfig, onSave, ticker]);

  // Per-ticker dict save: rewrites the full JSON with just the selected
  // ticker mutated. Empty string clears the ticker out of the dict.
  const saveDictEntry = React.useCallback(
    async (key: string, currentDict: Record<string, unknown>, newValue: string) => {
      const next: Record<string, unknown> = { ...currentDict };
      const trimmed = newValue.trim();
      if (trimmed === "") {
        delete next[ticker];
      } else {
        const num = Number(trimmed);
        if (!Number.isFinite(num)) {
          throw new Error("Number required");
        }
        next[ticker] = num;
      }
      await onSave(key, JSON.stringify(next));
    },
    [onSave, ticker],
  );

  const tickerThresholds = TICKER_THRESHOLDS[ticker];
  const recalibratedThresholds = RECALIBRATED_THRESHOLDS_V2[ticker];

  // Scalars below cover only the original sacred 5; new tickers fall back to
  // the bot's documented defaults (see get_* helpers). Show the fallback with
  // a "(default)" marker rather than a fabricated per-ticker value.
  const dirPenalty = DIRECTION_PENALTIES[ticker];
  const dirPenaltyDisplay =
    dirPenalty == null ? `${DIRECTION_PENALTY_FALLBACK} (default)` : String(dirPenalty);
  const momentumFloor = MOMENTUM_FLOOR_BY_TICKER[ticker];
  const momentumFloorDisplay =
    momentumFloor == null ? `${MOMENTUM_FLOOR_DEFAULT} (default)` : String(momentumFloor);
  const trailFloor = TICKER_TRAIL_FLOORS[ticker];
  const trailFloorDisplay =
    trailFloor == null ? `${TRAIL_FLOOR_DEFAULT.toFixed(3)} (default)` : trailFloor.toFixed(3);

  return (
    <CollapsibleSection
      title="Per-Ticker"
      defaultOpen={true}
      rightSlot={<Pill size="sm">{configs.length}</Pill>}
    >
      <div className="space-y-4 px-4 py-3">
        <FilterChips
          options={SACRED_TICKERS as unknown as readonly string[]}
          selected={ticker}
          onChange={(v) => setTicker(v as SacredTicker)}
          ariaLabel="Select ticker"
        />

        {/* Source-code thresholds (read-only) */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 font-sans text-label-ui text-fg-muted">
            <FileCode size={12} className="text-fg-faint" aria-hidden />
            <span>{ticker} Thresholds</span>
            <span className="font-sans text-micro normal-case text-fg-faint">
              · ticker_thresholds.py
            </span>
          </div>
          <ThresholdsRow set={tickerThresholds} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 font-sans text-label-ui text-fg-muted">
            <FileCode size={12} className="text-fg-faint" aria-hidden />
            <span>{ticker} Shadow Thresholds (V2)</span>
            <span className="font-sans text-micro normal-case text-fg-faint">
              · RECALIBRATED_THRESHOLDS_V2
            </span>
          </div>
          {recalibratedThresholds ? (
            <ThresholdsRow set={recalibratedThresholds} />
          ) : (
            <div
              className="px-2 py-2 font-mono text-caption text-fg-faint"
              title="No V2 shadow recalibration for this ticker (orig sacred 5 only)"
            >
              Not calibrated (V2)
            </div>
          )}
        </div>

        {/* Source-code per-ticker scalars (read-only) */}
        <div className="space-y-0">
          <div className="px-2 pb-1 font-sans text-label-ui text-fg-muted">
            Risk Controls
          </div>
          <ReadOnlyRow
            label="Direction Penalty"
            value={dirPenaltyDisplay}
            sourceFile="ticker_thresholds.py"
          />
          <ReadOnlyRow
            label="Momentum Floor"
            value={momentumFloorDisplay}
            sourceFile="auto_trader/monitor.py"
          />
          <ReadOnlyRow
            label="Trail Floor"
            value={trailFloorDisplay}
            sourceFile="auto_trader/exit_helpers.py"
          />
          <ReadOnlyRow
            label="Leverage (max)"
            value={`${TICKER_LEVERAGE[ticker]}x`}
            immutable
            immutableReason="Ghost ruling 4 — frozen until P20 V2 promotion"
          />
        </div>

        {/* DB-side overrides (editable when LIVE_EDIT_ENABLED) */}
        <div className="space-y-0">
          <div className="flex items-center gap-2 px-2 pb-1 font-sans text-label-ui text-fg-muted">
            <Database size={12} className="text-accent-cyan-soft" aria-hidden />
            <span>Auto-Config Overrides</span>
            {!liveEditEnabled && (
              <span className="font-sans text-micro normal-case text-fg-faint">
                · read-only
              </span>
            )}
          </div>

          {/* ALO disabled toggle — writes back the full JSON array */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle py-2">
            <span className="font-sans text-label-ui text-fg-muted">
              ALO Disabled
            </span>
            <div className="flex items-center gap-2">
              {aloDisabled ? (
                <Pill intent="warn" size="sm">DISABLED</Pill>
              ) : (
                <Pill intent="active" size="sm">ENABLED</Pill>
              )}
              <HapticButton
                variant="secondary"
                size="sm"
                onClick={() => void toggleAlo()}
                disabled={aloPending || !aloDisabledConfig}
                aria-label={
                  aloDisabled
                    ? `Re-enable ALO for ${ticker}`
                    : `Disable ALO for ${ticker}`
                }
              >
                {aloPending ? "Saving…" : aloDisabled ? "Re-enable" : "Disable"}
              </HapticButton>
            </div>
          </div>
          {aloError && (
            <div className="flex items-center gap-1 px-2 py-1 font-sans text-micro text-accent-red">
              <AlertCircle size={12} className="shrink-0" aria-hidden />
              <span>{aloError}</span>
            </div>
          )}

          {/* Per-ticker hard-stop pct override (float, JSON dict round-trip) */}
          {hardStopConfig ? (
            <EditableField
              label={`Hard Stop PCT (${ticker})`}
              value={hardStopValue}
              type="float"
              immutable={hardStopConfig.immutable}
              onSave={(v) =>
                saveDictEntry("TICKER_HARD_STOP_PCT_JSON", hardStopDict, v)
              }
            />
          ) : null}

          {/* Per-ticker V2 leverage seed (JSON dict round-trip) */}
          {leverageV2Config ? (
            <EditableField
              label={`Leverage V2 Seed (${ticker})`}
              value={leverageV2Value}
              type="float"
              immutable={leverageV2Config.immutable}
              onSave={(v) =>
                saveDictEntry(
                  "LEVERAGE_V2_INTERMEDIATE_JSON",
                  leverageV2Dict,
                  v,
                )
              }
            />
          ) : null}
        </div>

        {/* Discovered Tickers card removed 2026-05-28 (DEGEN-REMOVE) */}
      </div>
    </CollapsibleSection>
  );
}
