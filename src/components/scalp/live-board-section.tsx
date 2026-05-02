"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  MoneyText,
  HapticButton,
  BottomSheet,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { Activity, Plus, Lock } from "lucide-react";

interface LiveTicker {
  ticker: string;
  direction: string;
  confidence: number;
  regime: string;
  current_price: number;
  insight_line?: string;
  updated_at?: string;
}

interface LiveBoardResponse {
  tickers?: LiveTicker[];
  last_scan?: string | null;
  cached?: boolean;
}

interface KillswitchState {
  enabled: boolean;
  lastToggle?: string;
  lastAuthor?: string;
  lastReason?: string;
}

export function LiveBoardSection() {
  const [tickers, setTickers] = React.useState<LiveTicker[] | null>(null);
  const [killswitch, setKillswitch] = React.useState<KillswitchState>({ enabled: false });
  const [enterTicker, setEnterTicker] = React.useState<LiveTicker | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [lastScan, setLastScan] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [boardRes, ksRes] = await Promise.all([
          fetch("/api/live-board", { cache: "no-store" }),
          fetch("/api/killswitch", { cache: "no-store" }),
        ]);
        if (!cancelled && boardRes.ok) {
          const j = (await boardRes.json()) as LiveBoardResponse;
          setTickers(j.tickers ?? []);
          setLastScan(j.last_scan ?? null);
        }
        if (!cancelled && ksRes.ok) {
          setKillswitch(await ksRes.json());
        }
      } catch {
        // network blip — keep last good state
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <Card padding="md" glow={killswitch.enabled ? "amber" : "cyan"}>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Activity size={14} />
              LIVE BOARD
            </span>
          </CardTitle>
          {killswitch.enabled ? (
            <Pill tone="amber" size="sm" pulse>
              STANDBY
            </Pill>
          ) : (
            <Pill tone="cyan" size="sm" pulse>
              LIVE
            </Pill>
          )}
        </CardHeader>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {!loading && tickers && tickers.length === 0 && (
          <EmptyState
            title="No tickers"
            body="Scanner has no active universe."
          />
        )}

        {!loading && tickers && tickers.length > 0 && (
          <ul className="space-y-2">
            {tickers.map((t) => {
              const dirTone =
                t.direction === "LONG"
                  ? "green"
                  : t.direction === "SHORT"
                  ? "red"
                  : "neutral";
              const confTone =
                t.confidence >= 50
                  ? "green"
                  : t.confidence >= 40
                  ? "cyan"
                  : "amber";
              return (
                <li
                  key={t.ticker}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-elevated p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-h3 font-bold">{t.ticker}</span>
                      <span className="font-mono text-body tabular-nums text-fg-primary">
                        ${t.current_price < 100
                          ? t.current_price.toFixed(4)
                          : t.current_price.toFixed(2)}
                      </span>
                      <Pill tone={dirTone as "green" | "red" | "neutral"} size="sm">
                        {t.direction}
                      </Pill>
                      <Pill tone={confTone as "green" | "cyan" | "amber"} size="sm">
                        {t.confidence.toFixed(0)}
                      </Pill>
                    </div>
                    {t.insight_line && (
                      <span className="text-micro text-fg-muted">{t.insight_line}</span>
                    )}
                  </div>
                  <HapticButton
                    variant={killswitch.enabled ? "ghost" : "primary"}
                    size="sm"
                    disabled={killswitch.enabled}
                    onClick={() => setEnterTicker(t)}
                    title={
                      killswitch.enabled
                        ? "Killswitch on — manual trades blocked"
                        : "Enter manual position"
                    }
                  >
                    {killswitch.enabled ? <Lock size={14} /> : <Plus size={14} />}
                    ENTER
                  </HapticButton>
                </li>
              );
            })}
          </ul>
        )}

        {killswitch.enabled && (
          <div className="mt-3 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-caption text-accent-amber">
            🚨 Killswitch ON — manual ENTER is blocked. Use Discord{" "}
            <code className="rounded bg-bg-elevated px-1 text-accent-amber">
              !killswitch off
            </code>{" "}
            to resume.
          </div>
        )}

        {!loading && lastScan && (
          <div className="mt-3 text-micro text-fg-muted">
            Last scan: {new Date(lastScan).toLocaleString()}
          </div>
        )}
      </Card>

      <EnterSheet ticker={enterTicker} onClose={() => setEnterTicker(null)} />
    </>
  );
}

interface EnterSheetProps {
  ticker: LiveTicker | null;
  onClose: () => void;
}

type EnterResult = { tone: "ok" | "fail" | "blocked"; message: string } | null;

function EnterSheet({ ticker, onClose }: EnterSheetProps) {
  const [direction, setDirection] = React.useState<"LONG" | "SHORT">("LONG");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<EnterResult>(null);

  React.useEffect(() => {
    if (ticker) {
      setDirection(
        ticker.direction === "SHORT" ? "SHORT" : "LONG",
      );
      setSubmitting(false);
      setResult(null);
    }
  }, [ticker]);

  const submit = async () => {
    if (!ticker) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/live-board/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.ticker,
          direction,
          current_price: ticker.current_price,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        blocked?: boolean;
      };
      if (res.status === 423 || data.blocked) {
        setResult({
          tone: "blocked",
          message: "🚨 Killswitch ON — manual ENTER blocked.",
        });
      } else if (!res.ok || data.error) {
        setResult({
          tone: "fail",
          message: `Failed: ${data.error ?? `HTTP ${res.status}`}`,
        });
      } else {
        setResult({
          tone: "ok",
          message: "Entered ✓ — Discord card incoming.",
        });
        setTimeout(onClose, 1400);
      }
    } catch (err) {
      setResult({ tone: "fail", message: `Failed: ${String(err)}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      open={ticker !== null}
      onClose={onClose}
      title={ticker ? `ENTER · ${ticker.ticker}` : ""}
    >
      {ticker && (
        <div className="space-y-4 p-4">
          <div className="text-caption text-fg-muted">
            Entry price (current):{" "}
            <span className="font-mono text-fg-primary tabular-nums">
              $
              {ticker.current_price < 100
                ? ticker.current_price.toFixed(4)
                : ticker.current_price.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <HapticButton
              variant={direction === "LONG" ? "primary" : "secondary"}
              fullWidth
              onClick={() => setDirection("LONG")}
            >
              📈 LONG
            </HapticButton>
            <HapticButton
              variant={direction === "SHORT" ? "primary" : "secondary"}
              fullWidth
              onClick={() => setDirection("SHORT")}
            >
              📉 SHORT
            </HapticButton>
          </div>

          <HapticButton
            variant="primary"
            fullWidth
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "Entering…" : `Confirm ENTER · ${direction}`}
          </HapticButton>

          {result && (
            <div
              className={
                "rounded-md border px-3 py-2 text-center text-caption " +
                (result.tone === "ok"
                  ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
                  : result.tone === "blocked"
                  ? "border-accent-amber/40 bg-accent-amber/10 text-accent-amber"
                  : "border-accent-red/40 bg-accent-red/10 text-accent-red")
              }
            >
              {result.message}
            </div>
          )}

          <div className="text-center text-micro text-fg-muted">
            Manual scalp entry · respects killswitch · ONE TRADE PER MESSAGE
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

// Suppress unused-import warning — MoneyText reserved for future PnL display.
void MoneyText;
