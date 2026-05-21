"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, MetricTile, MoneyText, Pill } from "@/components/ui";
import { CheckCircle2, AlertCircle, Repeat, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

type Category = "PRIORITIZE" | "AVOID" | "REGIME_DEPENDENT" | "ACTIVE_LEARNING";

type CategoryIntent = "active" | "error" | "warn" | "meme";

type CategoryMeta = {
  label: string;
  pillIntent: CategoryIntent;
  cardClass: "card-elevated" | "card-warn";
  iconClass: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const META: Record<Category, CategoryMeta> = {
  PRIORITIZE: {
    label: "PRIORITIZE",
    pillIntent: "active",
    cardClass: "card-elevated",
    iconClass: "text-accent-mint",
    icon: CheckCircle2,
  },
  AVOID: {
    label: "AVOID",
    pillIntent: "error",
    cardClass: "card-warn",
    iconClass: "text-accent-red",
    icon: AlertCircle,
  },
  REGIME_DEPENDENT: {
    label: "REGIME-DEPENDENT",
    pillIntent: "warn",
    cardClass: "card-elevated",
    iconClass: "text-accent-gold",
    icon: Repeat,
  },
  ACTIVE_LEARNING: {
    label: "ACTIVE LEARNING",
    pillIntent: "meme",
    cardClass: "card-elevated",
    iconClass: "text-accent-plum",
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

export function LessonCard({ data }: { data: LessonCardData }) {
  const meta = META[data.category];
  const Icon = meta.icon;
  const cohortChips = buildCohortChips(data.cohort);
  const wrTone =
    data.metric.win_rate_pct >= 55
      ? "positive"
      : data.metric.win_rate_pct >= 40
        ? "neutral"
        : "negative";

  return (
    <Card padding="md" className={cn(meta.cardClass, "space-y-3")}>
      <CardHeader>
        <CardTitle>
          <span className={cn("flex items-center gap-2", meta.iconClass)}>
            <Icon size={14} />
            {meta.label}
          </span>
        </CardTitle>
        <Pill intent={meta.pillIntent} size="sm">
          {data.confidence_level === "high"
            ? "high conf"
            : data.confidence_level === "medium"
              ? "medium"
              : "low"}
        </Pill>
      </CardHeader>

      <h3 className="font-sans text-h3 font-semibold text-fg-primary">{data.title}</h3>

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Trades" value={String(data.metric.trades)} size="sm" />
        <MetricTile
          label="Win Rate"
          value={`${data.metric.win_rate_pct.toFixed(1)}%`}
          tone={wrTone}
          size="sm"
        />
        <MetricTile
          label="Avg P&L"
          value={<MoneyText value={data.metric.avg_pnl_pct} unit="%" size="sm" decimals={2} showSign />}
          size="sm"
        />
        <MetricTile
          label="Expectancy"
          value={<MoneyText value={data.metric.expectancy_pct} unit="%" size="sm" decimals={2} showSign />}
          size="sm"
        />
      </div>

      <div className="space-y-1 pt-1">
        <div className="font-sans text-caption text-fg-primary">{data.conclusion}</div>
        <div className="font-sans text-micro text-fg-muted">→ {data.recommendation}</div>
      </div>

      {data.note && (
        <div className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 font-sans text-micro text-fg-muted">
          {data.note}
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
