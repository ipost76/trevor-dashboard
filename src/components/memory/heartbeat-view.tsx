"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  EmptyState,
  HapticButton,
  CollapsibleSection,
  MetricTile,
} from "@/components/ui";
import {
  Activity,
  Radio,
  Bot,
  Database,
  ShieldCheck,
  Wifi,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  Container,
  TrendingUp,
  Clock,
  HeartPulse,
} from "lucide-react";

// HB-04: Hub-side heartbeat view backed by Observatory's /api/heartbeat
// proxy. Mirrors the Discord embed's traffic-light + categories shape.
// Companion to the G2 KillswitchControlCard (preserved separately) and
// the G2 SentinelsCard (split out for independent diagnostic value).

type Severity = "ok" | "warning" | "critical";

interface ServiceItem {
  name: string;
  active: boolean;
  pid: string;
  uptime_seconds: number;
  status: Severity;
  restart_count?: number;
  restart_reason?: string;
}
interface PipelineCat {
  status: Severity;
  scanner_detail: string;
  scanner_ago_seconds: number;
  scanner_last_cycle_ago_seconds?: number;
  scanner_cadence_seconds: number;
  signals_scored_delta?: number;
  guard_passed: number;
  guard_blocked: number;
  exit_events_delta?: number;
  current_regime?: string;
}
interface OpenPosition {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  leverage: number;
  notional_usd: number;
}
interface AutotraderCat {
  status: Severity;
  enabled: boolean;
  trades_today: number;
  last_trade_ago_seconds: number;
  killswitch: boolean;
  details?: string[];
  today_wins?: number;
  today_losses?: number;
  today_pnl_usd?: number;
  today_avg_pnl_pct?: number;
  open_count?: number;
  open_positions?: OpenPosition[];
  unrealized_pnl_usd?: number | null;
}
interface GatewayInfo {
  blocks_in_last_2h: number;
  max_block_seconds: number;
  last_block_time: string | null;
  block_details: unknown[];
}
interface ConnectivityCat {
  status: Severity;
  details?: string[];
  hl_api_reachable: boolean;
  hl_api_latency_ms: number;
  hl_api_error?: string | null;
  discord_ws_connected: boolean;
  discord_ws_latency_ms: number;
  discord_ws_reconnections_2h: number;
  gateway?: GatewayInfo;
}
interface ContainerItem {
  name: string;
  status: string;
  running: boolean;
  criticality: string;
}
interface DockerCat {
  status: Severity;
  details?: string[];
  containers: ContainerItem[];
}
interface SystemCat {
  status: Severity;
  memory_pss_mb: number;
  memory_high_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_pct: number;
  cpu_load_1m: number;
  cpu_cores: number;
  details?: string[];
}
interface DatabaseCat {
  status: Severity;
  trevor_db_size_mb: number;
  wal_size_mb: number;
  locked: boolean;
  sacred_files_ok: boolean;
  sacred_verified: number;
  sacred_total: number;
  details?: string[];
}
interface BackupCat {
  status: Severity;
  last_success_ago_hours: number;
  last_success_size_mb: number;
  litestream_active: boolean;
  details?: string[];
}
interface BudgetBreakdown {
  briefing?: number;
  learning?: number;
  swarm?: number;
  other?: number;
}
interface BudgetCat {
  status: Severity;
  used_usd: number;
  budget_usd: number;
  pct: number;
  budget_reset_seconds?: number;
  budget_breakdown?: BudgetBreakdown;
}
interface StuckTrade {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  held_hours: number;
  trade_mode: string;
}
interface ComponentRate {
  display_name: string;
  current_count: number;
  previous_count: number;
  delta: number;
  is_first_snapshot: boolean;
}
interface ComponentRatesCat {
  status: Severity;
  details?: string[];
  rates: Record<string, ComponentRate>;
  dead_components?: string[];
}
interface SelfHealthCat {
  api_responsive: boolean;
  db_accessible: boolean;
  db_size_mb: number;
  uptime_seconds: number;
}
interface StaleLoop {
  name: string;
  ago_seconds: number;
  cadence_seconds: number;
}
interface HeartbeatData {
  overall_status: Severity;
  critical_count: number;
  warning_count: number;
  timestamp: string;
  categories: {
    services: { items: ServiceItem[] };
    pipeline: PipelineCat;
    autotrader: AutotraderCat;
    connectivity: ConnectivityCat;
    docker?: DockerCat;
    system: SystemCat;
    database: DatabaseCat;
    backup: BackupCat;
    budget: BudgetCat;
    stuck_trades: { status: Severity; trades: StuckTrade[] };
    self_health?: SelfHealthCat;
    component_rates?: ComponentRatesCat;
    stale_loops: StaleLoop[];
  };
}

const POLL_MS = 30_000;
const HEARTBEAT_CADENCE_SECONDS = 7200; // 2h — matches Observatory config

function severityIcon(s: Severity): string {
  return s === "critical" ? "🔴" : s === "warning" ? "🟡" : "🟢";
}

function severityTone(s: Severity): "green" | "amber" | "red" {
  return s === "critical" ? "red" : s === "warning" ? "amber" : "green";
}

function severityCardClass(s: Severity): string {
  if (s === "critical") return "border-l-4 border-accent-red";
  if (s === "warning") return "border-l-4 border-accent-gold";
  return "";
}

// Group-header status pill (B8 collapsible groups).
function severityIntent(s: Severity): "live" | "warn" | "error" {
  return s === "critical" ? "error" : s === "warning" ? "warn" : "live";
}

function severityLabel(s: Severity): string {
  return s === "critical" ? "CRIT" : s === "warning" ? "WARN" : "OK";
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "just started";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function HeartbeatView() {
  const [data, setData] = React.useState<HeartbeatData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // RM-DECOM B5: the /api/heartbeat proxy returns a 200 `{observatory:'retired'}`
  // empty shape (no overall_status) once the Observatory is decommissioned —
  // render a calm neutral card, never the red "unreachable" error card.
  const [retired, setRetired] = React.useState(false);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
  const [now, setNow] = React.useState<number>(Date.now());

  const fetchHeartbeat = React.useCallback(async (force = false) => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/heartbeat", {
        method: force ? "POST" : "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        const json = (await res.json()) as HeartbeatData & { observatory?: string };
        // RM-DECOM B5: retired shape (no live heartbeat) → neutral card, not data.
        if (json.observatory === "retired") {
          setRetired(true);
        } else {
          setRetired(false);
          setData(json);
          setLastUpdated(Date.now());
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchHeartbeat();
    const pollId = setInterval(() => void fetchHeartbeat(), POLL_MS);
    return () => clearInterval(pollId);
  }, [fetchHeartbeat]);

  React.useEffect(() => {
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickId);
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // RM-DECOM B5: Observatory decommissioned → the heartbeat proxy returned the
  // `retired` shape. Show a calm neutral card (no retry — the source is retiring;
  // the 60s poll self-recovers if this was a transient blip pre-decommission).
  // Trade/account numbers stay live via the replica on the other health cards.
  if (retired) {
    return (
      <Card padding="md" className="card-base">
        <EmptyState
          icon={<HeartPulse size={32} className="text-fg-muted" />}
          title="Observatory heartbeat retired"
          body="Live heartbeat telemetry is offline (Observatory decommissioned — RM-DECOM). Trade data, closed history and account numbers remain live via the replica on the other cards."
        />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card padding="md" className="card-warn">
        <EmptyState
          icon={<AlertCircle size={32} />}
          title="Observatory unreachable"
          body={error ?? "Could not fetch heartbeat data from the Observatory."}
          action={
            <HapticButton
              variant="primary"
              size="md"
              onClick={() => void fetchHeartbeat(true)}
              disabled={refreshing}
            >
              <RefreshCw size={14} /> Retry
            </HapticButton>
          }
        />
      </Card>
    );
  }

  const cats = data.categories;
  const overallIcon = severityIcon(data.overall_status);
  const overallTone = severityTone(data.overall_status);

  const memPct = cats.system.memory_high_mb > 0
    ? (cats.system.memory_pss_mb / cats.system.memory_high_mb) * 100
    : 0;

  // Countdown keys off the actual heartbeat post time (data.timestamp), not
  // the 30s poll time — lastUpdated was reset every poll, so the old code
  // never actually counted down (HB-04 bug).
  const heartbeatTimeMs = new Date(data.timestamp).getTime();
  const heartbeatAgoMs = now - heartbeatTimeMs;
  const nextHeartbeatSeconds = Math.max(
    0,
    HEARTBEAT_CADENCE_SECONDS - Math.floor(heartbeatAgoMs / 1000),
  );

  // self_health carries no status field — derive one for the card border.
  const selfHealthStatus: Severity =
    cats.self_health &&
    (!cats.self_health.api_responsive || !cats.self_health.db_accessible)
      ? "critical"
      : "ok";

  // Collapsible group-header summaries (B8).
  const svcUp = cats.services.items.filter((s) => s.active).length;
  const svcTotal = cats.services.items.length;
  const tradingWorst: Severity =
    cats.services.items.some((s) => s.status === "critical") ||
    cats.autotrader.status === "critical" ||
    cats.pipeline.status === "critical"
      ? "critical"
      : cats.services.items.some((s) => s.status === "warning") ||
          cats.autotrader.status === "warning" ||
          cats.pipeline.status === "warning"
        ? "warning"
        : "ok";
  const stuckCount = cats.stuck_trades.trades.length;
  const staleCount = cats.stale_loops.length;
  const diagWorst: Severity =
    stuckCount > 0 ? "critical" : staleCount > 0 ? "warning" : "ok";

  const categoryCards: Array<{
    key: keyof typeof cats;
    label: string;
    icon: React.ReactElement;
    status: Severity;
    summary: string;
  }> = [
    {
      key: "services",
      label: "Services",
      icon: <Activity size={16} />,
      status:
        (cats.services.items.find((s) => s.status === "critical")?.status as Severity) ??
        (cats.services.items.find((s) => s.status === "warning")?.status as Severity) ??
        "ok",
      summary: `${cats.services.items.filter((s) => s.active).length}/${cats.services.items.length} up`,
    },
    {
      key: "pipeline",
      label: "Pipeline",
      icon: <Radio size={16} />,
      status: cats.pipeline.status,
      summary: cats.pipeline.scanner_detail,
    },
    {
      key: "autotrader",
      label: "AutoTrader",
      icon: <Bot size={16} />,
      status: cats.autotrader.status,
      summary: cats.autotrader.killswitch
        ? "Killswitch ON"
        : `${cats.autotrader.enabled ? "Enabled" : "Disabled"} · ${cats.autotrader.trades_today} closed (all modes)`,
    },
    {
      key: "database",
      label: "Database",
      icon: <Database size={16} />,
      status: cats.database.status,
      summary: `${cats.database.trevor_db_size_mb} MB · WAL ${cats.database.wal_size_mb} MB`,
    },
    {
      key: "backup",
      label: "Backup",
      icon: <ShieldCheck size={16} />,
      status: cats.backup.status,
      summary:
        cats.backup.last_success_ago_hours < 999
          ? `${cats.backup.last_success_ago_hours.toFixed(1)}h ago`
          : "No backup found",
    },
  ];

  // Items with warning/critical to surface in detail strip
  const detailItems: Array<{ category: string; status: Severity; text: string }> = [];
  for (const svc of cats.services.items) {
    if (svc.status === "critical") {
      detailItems.push({ category: "Services", status: "critical", text: `${svc.name.replace(".service", "")} — DOWN` });
    } else if (svc.status === "warning") {
      detailItems.push({ category: "Services", status: "warning", text: `${svc.name.replace(".service", "")} — degraded` });
    }
  }
  if (cats.pipeline.status !== "ok") {
    detailItems.push({
      category: "Pipeline",
      status: cats.pipeline.status,
      text: cats.pipeline.scanner_detail,
    });
  }
  if (cats.autotrader.killswitch) {
    detailItems.push({ category: "AutoTrader", status: "critical", text: "Killswitch ON — trading blocked" });
  }
  for (const d of cats.database.details ?? []) {
    detailItems.push({ category: "Database", status: "critical", text: d });
  }
  for (const d of cats.backup.details ?? []) {
    detailItems.push({ category: "Backup", status: cats.backup.status, text: d });
  }
  for (const d of cats.system.details ?? []) {
    detailItems.push({ category: "System", status: cats.system.status, text: d });
  }
  for (const sl of cats.stale_loops) {
    detailItems.push({
      category: "Stale Loop",
      status: "warning",
      text: `${sl.name} — stale ${Math.floor(sl.ago_seconds / 60)}m (cadence ${sl.cadence_seconds}s)`,
    });
  }

  return (
    <div className="space-y-4">
      {/* HEADER STRIP */}
      <Card padding="md" glow={overallTone === "green" ? "cyan" : overallTone}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              {overallIcon}
            </span>
            <div>
              <div className="text-h3 font-display tracking-wide">
                TREVOR HEARTBEAT
              </div>
              <div className="text-micro text-fg-muted">
                {lastUpdated ? `Updated ${formatAgo(now - lastUpdated)}` : "Never"}
                {refreshing && " · refreshing…"}
                {error && (
                  <span className="text-accent-red"> · {error}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.critical_count > 0 && (
              <Pill tone="red" pulse>
                {data.critical_count} CRITICAL
              </Pill>
            )}
            {data.warning_count > 0 && (
              <Pill tone="amber">
                {data.warning_count} WARNING{data.warning_count > 1 ? "S" : ""}
              </Pill>
            )}
            {data.critical_count === 0 && data.warning_count === 0 && (
              <Pill tone="green">ALL OK</Pill>
            )}
            <HapticButton
              variant="secondary"
              size="sm"
              onClick={() => void fetchHeartbeat(true)}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Refresh Now
            </HapticButton>
          </div>
        </div>
      </Card>

      {/* STATUS CARDS GRID — 6 categories */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {categoryCards.map((c) => (
          <Card
            key={c.key}
            padding="sm"
            className={severityCardClass(c.status)}
          >
            <div className="flex items-center gap-2">
              <span className="text-fg-muted">{c.icon}</span>
              <span className="text-caption font-display tracking-wide text-fg-primary">
                {c.label}
              </span>
              <span className="ml-auto" aria-hidden>
                {severityIcon(c.status)}
              </span>
            </div>
            <div className="mt-2 text-caption text-fg-muted truncate">
              {c.summary}
            </div>
          </Card>
        ))}
      </div>

      {/* DETAILS STRIP — only renders when there are warnings/criticals */}
      {detailItems.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Active Issues ({detailItems.length})</CardTitle>
          </CardHeader>
          <ul className="space-y-2">
            {detailItems.map((d, i) => (
              <li
                key={`${d.category}-${i}`}
                className={
                  "flex items-start gap-2 rounded-md bg-bg-elevated px-3 py-2 " +
                  severityCardClass(d.status)
                }
              >
                <span aria-hidden>{severityIcon(d.status)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-micro uppercase tracking-wider text-fg-muted">
                    {d.category}
                  </div>
                  <div className="text-caption text-fg-primary break-words">
                    {d.text}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* GROUP: System — merged System Resources + Quick Stats (B8 regroup) */}
      <CollapsibleSection
        title="System"
        defaultOpen
        rightSlot={
          <Pill intent={severityIntent(cats.system.status)} size="sm">
            {severityLabel(cats.system.status)}
          </Pill>
        }
      >
        <div className="space-y-4 p-4">
          {/* Resource utilization bars */}
          <div className="space-y-3">
            <ResourceBar
              label="Memory"
              valueText={`${cats.system.memory_pss_mb} MB / ${cats.system.memory_high_mb} MB cap`}
              pct={memPct}
              warnAt={80}
            />
            <ResourceBar
              label="Disk"
              valueText={`${cats.system.disk_used_gb.toFixed(1)} / ${cats.system.disk_total_gb.toFixed(1)} GB`}
              pct={cats.system.disk_pct}
              warnAt={85}
            />
            <div>
              <ResourceBar
                label="Budget"
                valueText={`$${cats.budget.used_usd.toFixed(2)} / $${cats.budget.budget_usd.toFixed(2)}`}
                pct={cats.budget.pct}
                warnAt={80}
              />
              {cats.budget.budget_breakdown &&
                Object.keys(cats.budget.budget_breakdown).length > 0 && (
                  <div className="mt-1 text-caption text-fg-muted">
                    {Object.entries(cats.budget.budget_breakdown)
                      .filter(([, v]) => (v ?? 0) > 0.01)
                      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                      .map(([k, v]) => `${k} $${(v ?? 0).toFixed(2)}`)
                      .join(" · ")}
                  </div>
                )}
            </div>
          </div>
          {/* Discrete stat tiles (former Quick Stats) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricTile
              label="CPU load (1m)"
              value={cats.system.cpu_load_1m.toFixed(2)}
              sub={`${cats.system.cpu_cores} cores`}
              size="sm"
            />
            <MetricTile
              label="Sacred files"
              value={`${cats.database.sacred_verified}/${cats.database.sacred_total}`}
              tone={cats.database.sacred_files_ok ? "positive" : "negative"}
              size="sm"
            />
            <MetricTile
              label="Killswitch"
              value={cats.autotrader.killswitch ? "ON" : "OFF"}
              tone={cats.autotrader.killswitch ? "negative" : "positive"}
              size="sm"
            />
            <MetricTile
              label="AT enabled"
              value={cats.autotrader.enabled ? "YES" : "NO"}
              tone={cats.autotrader.enabled ? "positive" : "warn"}
              size="sm"
            />
            <MetricTile
              label="Closed today"
              value={String(cats.autotrader.trades_today)}
              sub="all modes · UTC"
              size="sm"
            />
            <MetricTile
              label="Last heartbeat"
              value={formatAgo(heartbeatAgoMs)}
              size="sm"
            />
            <MetricTile
              label="Next heartbeat"
              value={formatCountdown(nextHeartbeatSeconds)}
              size="sm"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* GROUP: Trading Infra — AutoTrader · Pipeline · Services (B8) */}
      <CollapsibleSection
        title="Trading Infra"
        defaultOpen={false}
        rightSlot={
          <Pill intent={severityIntent(tradingWorst)} size="sm">
            {svcUp}/{svcTotal} svc
          </Pill>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
        {/* AutoTrader */}
        <Card padding="md" className={severityCardClass(cats.autotrader.status)}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Bot size={16} /> AutoTrader
              </span>
            </CardTitle>
          </CardHeader>
          <div className="space-y-2">
            <StatusRow
              icon={
                cats.autotrader.killswitch
                  ? "🔴"
                  : cats.autotrader.enabled
                    ? "🟢"
                    : "⚪"
              }
              label="Status"
              value={
                cats.autotrader.killswitch
                  ? "Killswitch ON"
                  : cats.autotrader.enabled
                    ? "Enabled"
                    : "Disabled"
              }
              tone={
                cats.autotrader.killswitch
                  ? "critical"
                  : cats.autotrader.enabled
                    ? "ok"
                    : "warning"
              }
            />
            <StatusRow
              icon="🔁"
              label="Closed today · all modes (UTC)"
              value={String(cats.autotrader.trades_today)}
            />
            {cats.autotrader.today_pnl_usd !== undefined &&
              cats.autotrader.trades_today > 0 && (
                <StatusRow
                  icon={cats.autotrader.today_pnl_usd >= 0 ? "💰" : "💸"}
                  label={"Today's P&L"}
                  value={`${cats.autotrader.today_pnl_usd >= 0 ? "+" : ""}$${cats.autotrader.today_pnl_usd.toFixed(2)} (${cats.autotrader.today_wins ?? 0}W/${cats.autotrader.today_losses ?? 0}L · ${(cats.autotrader.today_avg_pnl_pct ?? 0).toFixed(1)}% avg)`}
                  tone={cats.autotrader.today_pnl_usd >= 0 ? "ok" : "warning"}
                />
              )}
            {(cats.autotrader.open_count ?? 0) > 0 && (
              <StatusRow
                icon="📈"
                label="Open positions"
                value={`${cats.autotrader.open_count} position${
                  (cats.autotrader.open_count ?? 0) > 1 ? "s" : ""
                }${
                  cats.autotrader.unrealized_pnl_usd != null
                    ? ` (${cats.autotrader.unrealized_pnl_usd >= 0 ? "+" : ""}$${cats.autotrader.unrealized_pnl_usd.toFixed(2)} unrealized)`
                    : ""
                }`}
              />
            )}
          </div>
        </Card>

        {/* Pipeline */}
        <Card padding="md" className={severityCardClass(cats.pipeline.status)}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Radio size={16} /> Pipeline
              </span>
            </CardTitle>
          </CardHeader>
          <div className="space-y-2">
            <StatusRow
              icon={severityIcon(cats.pipeline.status)}
              label="Scanner"
              value={cats.pipeline.scanner_detail}
              tone={cats.pipeline.status}
            />
            {cats.pipeline.current_regime &&
              cats.pipeline.current_regime !== "UNKNOWN" && (
                <StatusRow
                  icon={
                    cats.pipeline.current_regime === "TRENDING"
                      ? "📈"
                      : cats.pipeline.current_regime === "VOLATILE"
                        ? "⚡"
                        : "↔️"
                  }
                  label="Regime"
                  value={cats.pipeline.current_regime}
                />
              )}
            {(cats.pipeline.signals_scored_delta ?? 0) > 0 && (
              <StatusRow
                icon="📊"
                label="Signals scored"
                value={String(cats.pipeline.signals_scored_delta)}
              />
            )}
            <StatusRow
              icon="🛡️"
              label="Guard"
              value={`${cats.pipeline.guard_passed} passed · ${cats.pipeline.guard_blocked} blocked`}
            />
            {(cats.pipeline.exit_events_delta ?? 0) > 0 && (
              <StatusRow
                icon="🚪"
                label="Exit events"
                value={String(cats.pipeline.exit_events_delta)}
              />
            )}
          </div>
        </Card>

        {/* Services */}
        <Card
          padding="md"
          className={severityCardClass(
            cats.services.items.some((s) => s.status === "critical")
              ? "critical"
              : cats.services.items.some((s) => s.status === "warning")
                ? "warning"
                : "ok",
          )}
        >
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Activity size={16} /> Services
              </span>
            </CardTitle>
          </CardHeader>
          {cats.services.items.length > 0 ? (
            <div className="space-y-2">
              {cats.services.items.map((svc) => (
                <StatusRow
                  key={svc.name}
                  icon={svc.active ? "🟢" : "🔴"}
                  label={svc.name.replace(".service", "")}
                  value={`${svc.active ? formatUptime(svc.uptime_seconds) : "DOWN"}${
                    (svc.restart_count ?? 0) > 0
                      ? ` · ↻ ${svc.restart_count} (${svc.restart_reason ?? "unknown"})`
                      : ""
                  }`}
                  tone={svc.status}
                />
              ))}
            </div>
          ) : (
            <CardNote>No services reported</CardNote>
          )}
        </Card>

        </div>
      </CollapsibleSection>

      {/* GROUP: Connectivity & Containers — Connectivity + Docker (B8) */}
      <CollapsibleSection
        title="Connectivity & Containers"
        defaultOpen={false}
        rightSlot={
          <Pill intent={severityIntent(cats.connectivity.status)} size="sm">
            {cats.connectivity.hl_api_reachable ? "ONLINE" : "OFFLINE"}
          </Pill>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
        {/* Connectivity */}
        <Card padding="md" className={severityCardClass(cats.connectivity.status)}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                {cats.connectivity.hl_api_reachable ? <Wifi size={16} /> : <WifiOff size={16} />}
                Connectivity
              </span>
            </CardTitle>
          </CardHeader>
          <div className="space-y-2">
            <StatusRow
              icon={cats.connectivity.hl_api_reachable ? "🟢" : "🔴"}
              label="Hyperliquid API"
              value={
                cats.connectivity.hl_api_reachable
                  ? `OK (${cats.connectivity.hl_api_latency_ms}ms)`
                  : (cats.connectivity.hl_api_error ?? "Unreachable")
              }
              tone={cats.connectivity.hl_api_reachable ? "ok" : "critical"}
            />
            <StatusRow
              icon={cats.connectivity.discord_ws_connected ? "🟢" : "🔴"}
              label="Discord WebSocket"
              value={
                cats.connectivity.discord_ws_connected
                  ? `Connected (${cats.connectivity.discord_ws_latency_ms}ms)`
                  : "Disconnected"
              }
              tone={cats.connectivity.discord_ws_connected ? "ok" : "critical"}
            />
            {cats.connectivity.discord_ws_reconnections_2h > 0 && (
              <StatusRow
                icon={cats.connectivity.discord_ws_reconnections_2h > 2 ? "🟡" : "🟢"}
                label="WS Reconnections"
                value={`${cats.connectivity.discord_ws_reconnections_2h}× in 2h`}
                tone={cats.connectivity.discord_ws_reconnections_2h > 2 ? "warning" : "ok"}
              />
            )}
            {cats.connectivity.gateway &&
              cats.connectivity.gateway.blocks_in_last_2h > 0 && (
                <StatusRow
                  icon={cats.connectivity.gateway.blocks_in_last_2h > 2 ? "🟡" : "🟢"}
                  label="Gateway blocks"
                  value={`${cats.connectivity.gateway.blocks_in_last_2h}× in 2h · max ${cats.connectivity.gateway.max_block_seconds}s`}
                  tone={cats.connectivity.gateway.blocks_in_last_2h > 2 ? "warning" : "ok"}
                />
              )}
          </div>
        </Card>

        {/* Docker */}
        <Card padding="md" className={severityCardClass(cats.docker?.status ?? "ok")}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Container size={16} /> Docker
              </span>
            </CardTitle>
          </CardHeader>
          {cats.docker ? (
            cats.docker.containers.length > 0 ? (
              <div className="space-y-2">
                {cats.docker.containers.map((c) => (
                  <StatusRow
                    key={c.name}
                    icon={c.running ? "🟢" : "🔴"}
                    label={c.name}
                    value={c.status}
                    tone={
                      c.running
                        ? "ok"
                        : c.criticality === "critical"
                          ? "critical"
                          : "warning"
                    }
                  />
                ))}
              </div>
            ) : (
              <CardNote>No containers reported</CardNote>
            )
          ) : (
            <CardNote>Data unavailable</CardNote>
          )}
        </Card>

        </div>
      </CollapsibleSection>

      {/* GROUP: Diagnostics — Component Rates · Stuck Trades · Stale Loops · Self-Health (B8) */}
      <CollapsibleSection
        title="Diagnostics"
        defaultOpen={false}
        rightSlot={
          <Pill intent={severityIntent(diagWorst)} size="sm">
            {stuckCount} stuck · {staleCount} stale
          </Pill>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
        {/* Component Rates */}
        <Card
          padding="md"
          className={severityCardClass(cats.component_rates?.status ?? "ok")}
        >
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <TrendingUp size={16} /> Component Rates
              </span>
            </CardTitle>
          </CardHeader>
          {cats.component_rates ? (
            Object.keys(cats.component_rates.rates).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(cats.component_rates.rates).map(([key, r]) => {
                  const dead = (
                    cats.component_rates?.dead_components ?? []
                  ).includes(r.display_name);
                  return (
                    <StatusRow
                      key={key}
                      icon={dead ? "🟡" : r.delta > 0 ? "🟢" : "⚪"}
                      label={r.display_name}
                      value={dead ? "no events" : `+${r.delta} events`}
                      tone={dead ? "warning" : "ok"}
                    />
                  );
                })}
              </div>
            ) : (
              <CardNote>No component rates reported</CardNote>
            )
          ) : (
            <CardNote>Data unavailable</CardNote>
          )}
        </Card>

        {/* Stuck Trades */}
        <Card padding="md" className={severityCardClass(cats.stuck_trades.status)}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <AlertTriangle size={16} /> Stuck Trades
              </span>
            </CardTitle>
          </CardHeader>
          {cats.stuck_trades.trades.length > 0 ? (
            <div className="space-y-2">
              {cats.stuck_trades.trades.map((t) => (
                <StatusRow
                  key={t.id}
                  icon="🔴"
                  label={`${t.ticker} ${t.direction}`}
                  value={`open ${t.held_hours.toFixed(1)}h`}
                  tone="critical"
                />
              ))}
            </div>
          ) : (
            <CardNote>No positions over 48h</CardNote>
          )}
        </Card>

        {/* Stale Loops */}
        <Card
          padding="md"
          className={severityCardClass(
            cats.stale_loops.length > 0 ? "warning" : "ok",
          )}
        >
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Clock size={16} /> Stale Loops
              </span>
            </CardTitle>
          </CardHeader>
          {cats.stale_loops.length > 0 ? (
            <div className="space-y-2">
              {cats.stale_loops.map((sl) => (
                <StatusRow
                  key={sl.name}
                  icon="🟡"
                  label={sl.name}
                  value={`stale ${formatCountdown(sl.ago_seconds)} · cadence ${sl.cadence_seconds}s`}
                  tone="warning"
                />
              ))}
            </div>
          ) : (
            <CardNote>All loops healthy</CardNote>
          )}
        </Card>

        {/* Observatory Self-Health */}
        <Card padding="md" className={severityCardClass(selfHealthStatus)}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <HeartPulse size={16} /> Observatory Self-Health
              </span>
            </CardTitle>
          </CardHeader>
          {cats.self_health ? (
            <div className="space-y-2">
              <StatusRow
                icon={cats.self_health.api_responsive ? "🟢" : "🔴"}
                label="API responsive"
                value={cats.self_health.api_responsive ? "Yes" : "No"}
                tone={cats.self_health.api_responsive ? "ok" : "critical"}
              />
              <StatusRow
                icon={cats.self_health.db_accessible ? "🟢" : "🔴"}
                label="DB accessible"
                value={cats.self_health.db_accessible ? "Yes" : "No"}
                tone={cats.self_health.db_accessible ? "ok" : "critical"}
              />
              <StatusRow
                icon="📊"
                label="Observatory DB"
                value={`${cats.self_health.db_size_mb} MB`}
              />
              <StatusRow
                icon="⏱️"
                label="Uptime"
                value={formatUptime(cats.self_health.uptime_seconds)}
              />
            </div>
          ) : (
            <CardNote>Data unavailable</CardNote>
          )}
        </Card>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ResourceBar(props: {
  label: string;
  valueText: string;
  pct: number;
  warnAt: number;
}) {
  const clamped = Math.min(100, Math.max(0, props.pct));
  const tone =
    clamped >= 95
      ? "bg-accent-red"
      : clamped >= props.warnAt
        ? "bg-accent-gold"
        : "bg-accent-mint";
  return (
    <div>
      <div className="flex items-baseline justify-between text-caption">
        <span className="text-fg-muted">{props.label}</span>
        <span className="font-mono text-fg-primary">{props.valueText}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
        <div
          className={`h-full ${tone} transition-all duration-medium`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function StatusRow(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "warning" | "critical";
}) {
  const valueClass =
    props.tone === "critical"
      ? "text-accent-red"
      : props.tone === "warning"
        ? "text-accent-gold"
        : "text-fg-primary";
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-bg-elevated px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 font-sans text-caption text-fg-muted">
        <span aria-hidden>{props.icon}</span>
        <span className="truncate">{props.label}</span>
      </span>
      <span className={`shrink-0 font-mono text-caption ${valueClass}`}>
        {props.value}
      </span>
    </div>
  );
}

function CardNote(props: { children: React.ReactNode }) {
  return <p className="text-caption text-fg-muted">{props.children}</p>;
}
