"use client";
import { useEffect, useState } from "react";
import { safeFetch } from "@/lib/fetch";
import { fmtPrice } from "@/lib/format";

// 🚨 [B9] 2026-08-11 — THE SCREEN USED TO SHOW A BARE `ONLINE` AND NOTHING ELSE.
//   `/api/status` has carried `trevor.source` since RM-DECOM B5, and a repo-wide grep
//   found ZERO components reading it: the payload knew it was inferring liveness from a
//   file timestamp and the screen said only "ONLINE". Ghost could not tell a live bot
//   from a freshly-synced file. The API was honest; the screen was not.
//
//   This is a PURE state -> screen map for the same reason `loop-heartbeat-format.ts`
//   and `watcher-format.ts` are: every state can then be driven without a browser, which
//   is the only way to prove the bot-dead rendering without stopping the bot.
//
// 🚨 AN ABSENT `source` FALLS THROUGH TO THE OLD RENDERING, deliberately. Only a source
//   this map recognises changes what is shown. A payload that lost the key must never
//   make this component assert a liveness story nothing told it — the same rule
//   RM-TRAINER-B4 applied to the memory line.
export type TrevorStatus = {
  running?: boolean;
  source?: string;
  botHeartbeatLagSeconds?: number | null;
  replicaAgeSeconds?: number | null;
};

export function fmtAge(s: number | null | undefined): string {
  if (typeof s !== "number" || !isFinite(s)) return "unknown";
  const v = Math.max(0, Math.round(s));
  if (v < 90) return `${v}s`;
  if (v < 5400) return `${Math.round(v / 60)}m`;
  const h = Math.floor(v / 3600);
  return `${h}h${Math.round((v - h * 3600) / 60)}m`;
}

export function describeTrevor(t: TrevorStatus | undefined): {
  label: string;
  detail: string | null;
  tone: "ok" | "bad" | "warn";
} {
  if (!t) return { label: "...", detail: null, tone: "warn" };
  const beat = fmtAge(t.botHeartbeatLagSeconds);
  switch (t.source) {
    case "heartbeat":
      return t.running
        ? { label: "ONLINE", detail: "confirmed by heartbeat", tone: "ok" }
        : { label: "OFFLINE", detail: "heartbeat says the bot is down", tone: "bad" };
    case "replica-fresh":
      // Honest about WHAT is known: the bot stamped a loop this recently.
      return { label: "ONLINE", detail: `bot beat ${beat} ago`, tone: "ok" };
    case "bot-heartbeat-stale":
      // 🚨 The case that was previously invisible: the sync pipeline is healthy and
      // republishing, so the file looks fresh, but the bot itself stopped writing.
      return {
        label: "OFFLINE",
        detail: `bot silent ${beat} — replica still syncing`,
        tone: "bad",
      };
    case "replica-fresh-bot-unverified":
      return {
        label: "ONLINE?",
        detail: "bot signal unreadable — liveness UNVERIFIED",
        tone: "warn",
      };
    case "replica-stale":
      return {
        label: "OFFLINE",
        detail: `replica stale ${fmtAge(t.replicaAgeSeconds)}`,
        tone: "bad",
      };
    default:
      // Unrecognised or absent source -> the pre-[B9] rendering, unchanged.
      return t.running
        ? { label: "ONLINE", detail: null, tone: "ok" }
        : { label: "OFFLINE", detail: null, tone: "bad" };
  }
}

export function StatusBar() {
  const [stats, setStats] = useState<{
    dbSize?: string;
    trades?: number;
    signals?: number;
    uptime?: string;
    uptimeDetail?: string | null;
    uptimeTone?: "ok" | "bad" | "warn";
    cost?: string;
    rank?: string;
  }>({});

  useEffect(() => {
    const fetchStats = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = await safeFetch<any>("/api/status", {});
      if (d && Object.keys(d).length > 0) {
        const sigObj = typeof d.signals === "object" && d.signals ? d.signals : null;
        setStats({
          trades: sigObj?.total ?? (typeof d.trades === "number" ? d.trades : 0),
          signals: sigObj?.total ?? (typeof d.signals === "number" ? d.signals : 0),
          cost: typeof d.todayCost === "number"
            ? `$${fmtPrice(d.todayCost)}`
            : typeof d.cost_today === "number"
              ? `$${fmtPrice(d.cost_today)}`
              : "$0",
          ...(() => {
            const v = describeTrevor(d.trevor);
            return { uptime: v.label, uptimeDetail: v.detail, uptimeTone: v.tone };
          })(),
          rank: d.rank || "Unknown",
        });
      }
    };
    fetchStats();
    const i = setInterval(fetchStats, 60000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="hidden md:flex h-6 shrink-0 items-center justify-between border-t border-border-subtle bg-[var(--panel-header)] px-3 text-[9px] font-mono text-fg-muted">
      <div className="flex items-center gap-4">
        <span>TREVOR V3</span>
        <span
          className={
            stats.uptimeTone === "ok"
              ? "text-accent-mint-strong opacity-90"
              : stats.uptimeTone === "warn"
                ? "text-accent-gold opacity-90"
                : stats.uptimeTone === "bad"
                  ? "text-accent-red opacity-90"
                  : "opacity-90"
          }
          title={stats.uptimeDetail || undefined}
        >
          {stats.uptime || "..."}
        </span>
        {/* The provenance, in muted type beside the verdict — never a bare ONLINE. */}
        {stats.uptimeDetail && (
          <span className="text-fg-muted opacity-80">{stats.uptimeDetail}</span>
        )}
        {stats.trades !== undefined && <span>SIGNALS: {stats.signals}</span>}
        {stats.rank && <span>RANK: {stats.rank}</span>}
      </div>
      <div className="flex items-center gap-4">
        <span>COST TODAY: {stats.cost || "..."}</span>
        <span>HUB v5</span>
      </div>
    </div>
  );
}
