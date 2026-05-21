"use client";
import * as React from "react";
import {
  TrendingUp,
  Activity,
  ShieldAlert,
  Target,
  Flame,
  BarChart3,
  BookOpen,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Skeleton, Pill } from "@/components/ui";

interface Suggestion {
  id: string;
  label: string;
  subtitle: string;
  icon: string;
}
interface SuggestionsResponse {
  suggestions: ReadonlyArray<Suggestion>;
  killswitch_enabled?: boolean;
  aggressive_threshold?: number | null;
  error?: string;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  TrendingUp,
  Activity,
  ShieldAlert,
  Target,
  Flame,
  BarChart3,
  BookOpen,
  MessageSquare,
};

export function ChatEmptyState({ onPick }: { onPick: (label: string) => void }) {
  const [data, setData] = React.useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/suggestions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setData(j); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-1 flex-col items-stretch justify-center gap-6 px-4 py-8 text-center md:px-6">
      <div className="flex flex-col items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-full border border-accent-cyan-soft/40 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong shadow-glow-subtle">
          <Sparkles size={26} />
        </div>
        <h2 className="font-sans text-h2 font-semibold tracking-tight text-fg-primary">Ask TREVOR anything</h2>
        <p className="max-w-xs font-sans text-caption leading-relaxed text-fg-muted">
          I can read your positions, signals, calibration, journal, and system state.
        </p>
        {data && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {data.killswitch_enabled && (
              <Pill intent="error" size="sm" pulse>
                KILLSWITCH ON
              </Pill>
            )}
            {typeof data.aggressive_threshold === "number" && data.aggressive_threshold < 40 && (
              <Pill
                tone="magenta"
                size="sm"
                className="bg-accent-plum/10 text-accent-plum-strong border-accent-plum/30"
              >
                AGGR <span className="font-mono">{data.aggressive_threshold}</span>
              </Pill>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 px-2 text-left">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}

        {!loading && data && data.suggestions.length === 0 && (
          <div className="font-sans text-caption text-fg-muted text-center">
            No tailored suggestions yet — start typing.
          </div>
        )}

        {!loading &&
          data?.suggestions.map((s) => {
            const Icon = ICON_MAP[s.icon] ?? MessageSquare;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s.label)}
                className={[
                  "tap-target group flex items-start gap-3 rounded-md border px-3 py-3 text-left",
                  "border-border-subtle bg-bg-elevated",
                  "hover:border-accent-cyan-soft/60 hover:bg-bg-card",
                  "transition-all duration-fast",
                ].join(" ")}
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-md border border-accent-cyan-soft/30 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong group-hover:border-accent-cyan-soft/60">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-sans text-caption font-semibold text-fg-primary">{s.label}</span>
                  <span className="block font-sans text-micro uppercase tracking-wider text-fg-muted">{s.subtitle}</span>
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
