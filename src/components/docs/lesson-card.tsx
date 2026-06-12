"use client";
import * as React from "react";
import { Card, MetricTile, MoneyText, Pill } from "@/components/ui";
import { CheckCircle2, AlertCircle, Repeat, Hourglass, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Category = "PRIORITIZE" | "AVOID" | "REGIME_DEPENDENT" | "ACTIVE_LEARNING";

type CategoryIntent = "active" | "error" | "warn" | "meme";

type CategoryMeta = {
  /** Verdict pill text (kept short for the glance row). */
  shortLabel: string;
  pillIntent: CategoryIntent;
  /** Colored left edge that reinforces the verdict at a glance. */
  borderClass: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const META: Record<Category, CategoryMeta> = {
  PRIORITIZE: {
    shortLabel: "PRIORITIZE",
    pillIntent: "active",
    borderClass: "border-l-accent-mint",
    icon: CheckCircle2,
  },
  AVOID: {
    shortLabel: "AVOID",
    pillIntent: "error",
    borderClass: "border-l-accent-red",
    icon: AlertCircle,
  },
  REGIME_DEPENDENT: {
    shortLabel: "REGIME",
    pillIntent: "warn",
    borderClass: "border-l-accent-gold",
    icon: Repeat,
  },
  ACTIVE_LEARNING: {
    shortLabel: "LEARNING",
    pillIntent: "meme",
    borderClass: "border-l-accent-plum",
    icon: Hourglass,
  },
};

interface LessonMetric {
  trades: number;
  win_rate_pct: number;
  avg_pnl_pct: number;
  expectancy_pct: number;
  best_pct: number;
  worst_pct: number;
  avg_win_pct?: number;
  avg_loss_pct?: number;
}

interface LessonCohort {
  ticker?: string | null;
  direction?: string | null;
  conf_bucket?: string | null;
  regime?: string | null;
  aggressive_mode?: boolean | null;
}

export interface LessonCardData {
  id: string;
  category: Category;
  title: string;
  cohort: LessonCohort;
  metric: LessonMetric;
  conclusion: string;
  recommendation: string;
  confidence_level: "high" | "medium" | "low";
  sample_size: number;
  note?: string | null;
}

/** MetricTile tone for the expanded win-rate tile. */
function wrToneEnum(wr: number): "positive" | "neutral" | "negative" {
  return wr >= 55 ? "positive" : wr >= 40 ? "neutral" : "negative";
}

/** Inline text color for the collapsed-row win rate. */
function wrColorClass(wr: number): string {
  return wr >= 55 ? "text-accent-mint" : wr >= 40 ? "text-fg-primary" : "text-accent-red";
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/**
 * Compact, glance-readable cohort row. Collapsed: verdict pill + identity +
 * inline win-rate & expectancy + trades + chevron. Tap expands to the full
 * 4-metric breakdown + best/worst + cohort chips + conclusion/recommendation.
 */
export function LessonCard({ data }: { data: LessonCardData }) {
  const [open, setOpen] = React.useState(false);
  const meta = META[data.category];
  const Icon = meta.icon;
  const m = data.metric;
  const cohortChips = buildCohortChips(data.cohort);

  return (
    <Card padding="sm" className={cn("card-base border-l-2", meta.borderClass)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <Pill intent={meta.pillIntent} size="sm" className="shrink-0">
          <Icon size={11} />
          {meta.shortLabel}
        </Pill>

        <span className="min-w-0 flex-1 truncate font-sans text-caption font-medium text-fg-primary">
          {data.title}
        </span>

        <span className="flex shrink-0 items-center gap-2 font-mono text-caption tabular-nums">
          <span className={wrColorClass(m.win_rate_pct)}>{m.win_rate_pct.toFixed(0)}%</span>
          <MoneyText value={m.expectancy_pct} unit="%" size="sm" decimals={2} showSign />
        </span>

        <span className="shrink-0 font-sans text-micro text-fg-muted">{m.trades}t</span>

        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-fg-muted transition-transform duration-fast",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricTile label="Trades" value={String(m.trades)} size="sm" />
            <MetricTile
              label="Win Rate"
              value={`${m.win_rate_pct.toFixed(1)}%`}
              tone={wrToneEnum(m.win_rate_pct)}
              size="sm"
            />
            <MetricTile
              label="Avg P&L"
              value={<MoneyText value={m.avg_pnl_pct} unit="%" size="sm" decimals={2} showSign />}
              size="sm"
            />
            <MetricTile
              label="Expectancy"
              value={
                <MoneyText value={m.expectancy_pct} unit="%" size="sm" decimals={2} showSign />
              }
              size="sm"
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-micro text-fg-muted">
            <span>
              best <span className="font-mono text-accent-mint">{fmtPct(m.best_pct)}</span>
            </span>
            <span>
              worst <span className="font-mono text-accent-red">{fmtPct(m.worst_pct)}</span>
            </span>
            {typeof m.avg_win_pct === "number" && (
              <span>
                avg win <span className="font-mono text-accent-mint">{fmtPct(m.avg_win_pct)}</span>
              </span>
            )}
            {typeof m.avg_loss_pct === "number" && (
              <span>
                avg loss <span className="font-mono text-accent-red">{fmtPct(m.avg_loss_pct)}</span>
              </span>
            )}
          </div>

          <div className="font-sans text-micro text-fg-muted">
            {data.confidence_level} confidence · sample {data.sample_size}
          </div>

          {cohortChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cohortChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-pill border border-border-subtle bg-bg-elevated px-2 py-0.5 font-sans text-micro text-fg-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div className="font-sans text-caption text-fg-primary">{data.conclusion}</div>
            <div className="font-sans text-micro text-fg-muted">→ {data.recommendation}</div>
          </div>

          {data.note && (
            <div className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 font-sans text-micro text-fg-muted">
              {data.note}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function buildCohortChips(c: LessonCohort): string[] {
  const out: string[] = [];
  if (c.ticker) out.push(c.ticker);
  if (c.direction) out.push(c.direction);
  if (c.conf_bucket) out.push(`conf ${c.conf_bucket}`);
  if (c.regime) out.push(`regime ${c.regime}`);
  if (typeof c.aggressive_mode === "boolean") {
    out.push(c.aggressive_mode ? "aggressive ON" : "aggressive OFF");
  }
  return out;
}
