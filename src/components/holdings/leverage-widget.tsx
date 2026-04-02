"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Shield } from "lucide-react";
import type { Position } from "@/app/trading/panels/HoldingsPanel";

type LeverageWidgetProps = {
  positions: Position[];
};

function leverageColor(lev: number): string {
  if (lev >= 10) return "neon-red";
  if (lev >= 3) return "neon-amber";
  return "neon-green";
}

function leverageBarColor(lev: number): string {
  if (lev >= 10) return "var(--neon-red)";
  if (lev >= 3) return "var(--neon-amber)";
  return "var(--neon-green)";
}

function leverageBarGlow(lev: number): string {
  if (lev >= 10) return "rgba(255, 51, 102, 0.3)";
  if (lev >= 3) return "rgba(255, 170, 0, 0.3)";
  return "rgba(0, 255, 136, 0.3)";
}

function leverageRiskLabel(lev: number): string {
  if (lev >= 10) return "HIGH";
  if (lev >= 3) return "MEDIUM";
  return "LOW";
}

export function LeverageWidget({ positions }: LeverageWidgetProps) {
  const leveragedPositions = useMemo(
    () =>
      positions
        .filter((p) => p.leverage > 1 && p.status !== "closed")
        .sort((a, b) => b.leverage - a.leverage),
    [positions]
  );

  const summary = useMemo(() => {
    if (leveragedPositions.length === 0) return null;

    const maxLev = Math.max(...leveragedPositions.map((p) => p.leverage));
    const avgLev =
      leveragedPositions.reduce((s, p) => s + p.leverage, 0) /
      leveragedPositions.length;
    const weightedLev =
      leveragedPositions.reduce((s, p) => s + p.leverage * p.quantity, 0) /
      leveragedPositions.reduce((s, p) => s + p.quantity, 0);

    return { maxLev, avgLev, weightedLev, count: leveragedPositions.length };
  }, [leveragedPositions]);

  if (leveragedPositions.length === 0) {
    return (
      <EmptyState
        icon={Shield}
        message="No leveraged positions"
        sub="All positions at 1x"
      />
    );
  }

  // Determine the max leverage for bar scaling
  const maxScale = Math.max(
    ...leveragedPositions.map((p) => p.leverage),
    10 // minimum scale of 10x for context
  );

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Position bars */}
      <div className="flex-1 overflow-auto space-y-1.5">
        {leveragedPositions.map((p) => {
          const barWidth = (p.leverage / maxScale) * 100;
          const color = leverageBarColor(p.leverage);
          const glow = leverageBarGlow(p.leverage);

          return (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-foreground w-20 truncate shrink-0">
                {p.ticker}
              </span>
              <div className="flex-1 h-3.5 rounded-sm bg-[rgba(255,255,255,0.03)] overflow-hidden relative">
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{
                    width: `${Math.max(barWidth, 4)}%`,
                    backgroundColor: color,
                    opacity: 0.7,
                    boxShadow: `0 0 8px ${glow}`,
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold font-mono w-10 text-right shrink-0",
                  leverageColor(p.leverage)
                )}
              >
                {p.leverage}x
              </span>
              <span
                className={cn(
                  "text-[8px] font-bold uppercase w-12 text-right shrink-0",
                  leverageColor(p.leverage)
                )}
              >
                {leverageRiskLabel(p.leverage)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {summary && (
        <div className="border-t border-[var(--border)] pt-2 mt-auto">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-3">
              <div>
                <span className="text-muted-foreground">Leveraged: </span>
                <span className="font-bold neon-text">{summary.count}</span>
                <span className="text-muted-foreground">
                  /{positions.filter((p) => p.status !== "closed").length}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg: </span>
                <span
                  className={cn("font-bold font-mono", leverageColor(summary.avgLev))}
                >
                  {summary.avgLev.toFixed(1)}x
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Max: </span>
                <span
                  className={cn("font-bold font-mono", leverageColor(summary.maxLev))}
                >
                  {summary.maxLev}x
                </span>
              </div>
            </div>
            <div
              className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded border",
                summary.maxLev >= 10
                  ? "bg-[rgba(255,51,102,0.1)] text-[var(--neon-red)] border-[rgba(255,51,102,0.2)]"
                  : summary.maxLev >= 3
                  ? "bg-[rgba(255,170,0,0.1)] text-[var(--neon-amber)] border-[rgba(255,170,0,0.2)]"
                  : "bg-[rgba(0,255,136,0.1)] text-[var(--neon-green)] border-[rgba(0,255,136,0.2)]"
              )}
            >
              {summary.maxLev >= 10 ? "HIGH RISK" : summary.maxLev >= 3 ? "MODERATE" : "LOW RISK"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
