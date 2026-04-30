"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  SegmentedToggle,
  Pill,
} from "@/components/ui";
import type { SegmentedToggleOption } from "@/components/ui";
import { Brain, Filter as FilterIcon } from "lucide-react";
import { LessonCard, type LessonCardData } from "./lesson-card";

interface LessonsResponse {
  generated_at: string;
  total_closed_trades: number;
  cards: ReadonlyArray<LessonCardData>;
  error?: string;
}

type LessonFilter = "all" | "PRIORITIZE" | "AVOID" | "REGIME_DEPENDENT" | "ACTIVE_LEARNING";

const FILTER_OPTIONS: ReadonlyArray<SegmentedToggleOption<LessonFilter>> = [
  { value: "all", label: "All" },
  { value: "PRIORITIZE", label: "Prioritize" },
  { value: "AVOID", label: "Avoid" },
  { value: "REGIME_DEPENDENT", label: "Regime" },
  { value: "ACTIVE_LEARNING", label: "Learning" },
];

export function LessonsSection() {
  const [data, setData] = React.useState<LessonsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<LessonFilter>("all");

  React.useEffect(() => {
    const fetchLessons = async () => {
      try {
        const res = await fetch("/api/intel/lessons", { cache: "no-store" });
        if (res.ok) setData((await res.json()) as LessonsResponse);
      } catch {
        // swallow; UI surfaces error via data.error
      } finally {
        setLoading(false);
      }
    };
    void fetchLessons();
    const id = setInterval(() => void fetchLessons(), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const filteredCards = React.useMemo(() => {
    if (!data) return [] as ReadonlyArray<LessonCardData>;
    if (filter === "all") return data.cards;
    return data.cards.filter((c) => c.category === filter);
  }, [data, filter]);

  const counts = React.useMemo(() => {
    const c: Record<"PRIORITIZE" | "AVOID" | "REGIME_DEPENDENT" | "ACTIVE_LEARNING", number> = {
      PRIORITIZE: 0,
      AVOID: 0,
      REGIME_DEPENDENT: 0,
      ACTIVE_LEARNING: 0,
    };
    if (!data) return c;
    for (const card of data.cards) {
      if (card.category in c) c[card.category] += 1;
    }
    return c;
  }, [data]);

  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Brain size={14} />
              LESSONS
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 text-micro text-fg-muted">
            {data && <span>{data.total_closed_trades} closed trades</span>}
            {data && <span className="text-fg-faint">·</span>}
            {data && (
              <Pill tone="green" size="sm">
                {counts.PRIORITIZE} prioritize
              </Pill>
            )}
            {data && (
              <Pill tone="red" size="sm">
                {counts.AVOID} avoid
              </Pill>
            )}
            {data && (
              <Pill tone="amber" size="sm">
                {counts.REGIME_DEPENDENT} regime
              </Pill>
            )}
            {data && (
              <Pill tone="violet" size="sm">
                {counts.ACTIVE_LEARNING} learning
              </Pill>
            )}
          </div>
        </CardHeader>

        <SegmentedToggle<LessonFilter>
          ariaLabel="Filter lessons"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          full
        />
      </Card>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {!loading && data?.error && <EmptyState title="Failed to load lessons" body={data.error} />}

      {!loading && data && !data.error && filteredCards.length === 0 && (
        <EmptyState
          icon={<FilterIcon size={24} />}
          title={
            filter === "all" ? "No lessons yet" : `No ${filter.toLowerCase().replace(/_/g, " ")} cards`
          }
          body={
            filter === "all"
              ? `Need more closed trades to extract cohort-level lessons. Currently ${data.total_closed_trades} closed trades.`
              : "Switch filter or wait for more samples."
          }
        />
      )}

      {!loading && filteredCards.length > 0 && (
        <ul className="space-y-3">
          {filteredCards.map((card) => (
            <li key={card.id}>
              <LessonCard data={card} />
            </li>
          ))}
        </ul>
      )}

      {data?.generated_at && !loading && (
        <div className="text-center text-micro text-fg-faint">
          generated {new Date(data.generated_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
