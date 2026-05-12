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
} from "@/components/ui";
import {
  Activity,
  Radio,
  Bot,
  Database,
  ShieldCheck,
  DollarSign,
  Wifi,
  Cpu,
  Gauge,
  RefreshCw,
  AlertCircle,
  WifiOff,
  HardDrive,
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
}
interface PipelineCat {
  status: Severity;
  scanner_detail: string;
  scanner_ago_seconds: number;
  scanner_cadence_seconds: number;
  guard_passed: number;
  guard_blocked: number;
}
interface AutotraderCat {
  status: Severity;
  enabled: boolean;
  trades_today: number;
  last_trade_ago_seconds: number;
  killswitch: boolean;
  details?: string[];
}
interface ConnectivityCat {
  status: Severity;
  hl_api_reachable: boolean;
  hl_api_latency_ms: number;
  discord_ws_connected: boolean;
  discord_ws_latency_ms: number;
  discord_ws_reconnections_2h: number;
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
interface BudgetCat {
  status: Severity;
  used_usd: number;
  budget_usd: number;
  pct: number;
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
    system: SystemCat;
    database: DatabaseCat;
    backup: BackupCat;
    budget: BudgetCat;
    stuck_trades: { status: Severity; trades: unknown[] };
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
  if (s === "warning") return "border-l-4 border-accent-amber";
  return "";
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
        const json = (await res.json()) as HeartbeatData;
        setData(json);
        setLastUpdated(Date.now());
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

  if (!data) {
    return (
      <Card padding="md" glow="red">
        <EmptyState
          icon={<AlertCircle size={32} />}
          title="Observatory unreachable"
          body={error ?? "Could not fetch heartbeat data from :3335."}
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

  const lastHeartbeatAgoMs = lastUpdated ? now - lastUpdated : -1;
  const nextHeartbeatSeconds = Math.max(
    0,
    HEARTBEAT_CADENCE_SECONDS - Math.floor(lastHeartbeatAgoMs / 1000),
  );

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
        : `${cats.autotrader.enabled ? "Enabled" : "Disabled"} · ${cats.autotrader.trades_today} today`,
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
    {
      key: "budget",
      label: "Budget",
      icon: <DollarSign size={16} />,
      status: cats.budget.status,
      summary: `$${cats.budget.used_usd.toFixed(2)} / $${cats.budget.budget_usd.toFixed(2)}`,
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

      {/* BOTTOM ROW: System Resources + Quick Stats */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* System Resources */}
        <Card padding="md">
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Cpu size={16} /> System Resources
              </span>
            </CardTitle>
          </CardHeader>
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
            <ResourceBar
              label="Budget"
              valueText={`$${cats.budget.used_usd.toFixed(2)} / $${cats.budget.budget_usd.toFixed(2)}`}
              pct={cats.budget.pct}
              warnAt={80}
            />
            <div className="flex items-center justify-between text-caption text-fg-muted">
              <span>CPU load (1m)</span>
              <span className="font-mono text-fg-primary">
                {cats.system.cpu_load_1m.toFixed(2)} ({cats.system.cpu_cores} cores)
              </span>
            </div>
          </div>
        </Card>

        {/* Quick Stats */}
        <Card padding="md">
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Gauge size={16} /> Quick Stats
              </span>
            </CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-3 text-caption">
            <Stat
              label="Sacred files"
              value={`${cats.database.sacred_verified}/${cats.database.sacred_total}`}
              tone={cats.database.sacred_files_ok ? "ok" : "critical"}
            />
            <Stat
              label="Killswitch"
              value={cats.autotrader.killswitch ? "ON" : "OFF"}
              tone={cats.autotrader.killswitch ? "critical" : "ok"}
            />
            <Stat
              label="AT enabled"
              value={cats.autotrader.enabled ? "YES" : "NO"}
              tone={cats.autotrader.enabled ? "ok" : "warning"}
            />
            <Stat
              label="Trades today"
              value={String(cats.autotrader.trades_today)}
              tone="ok"
            />
            <Stat
              label="Last heartbeat"
              value={lastUpdated ? formatAgo(now - lastUpdated) : "—"}
              tone="ok"
            />
            <Stat
              label="Next heartbeat"
              value={formatCountdown(nextHeartbeatSeconds)}
              tone="ok"
            />
          </dl>
        </Card>
      </div>

      {/* Connectivity (placeholder for HB-05) */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              {cats.connectivity.hl_api_reachable ? <Wifi size={16} /> : <WifiOff size={16} />}
              Connectivity
            </span>
          </CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md bg-bg-elevated px-3 py-2">
            <span className="flex items-center gap-2 text-caption text-fg-muted">
              <HardDrive size={14} /> Hyperliquid API
            </span>
            <Pill tone="neutral" size="sm">pending (HB-05)</Pill>
          </div>
          <div className="flex items-center justify-between rounded-md bg-bg-elevated px-3 py-2">
            <span className="flex items-center gap-2 text-caption text-fg-muted">
              <Wifi size={14} /> Discord WebSocket
            </span>
            <Pill tone="neutral" size="sm">pending (HB-05)</Pill>
          </div>
        </div>
      </Card>
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
        ? "bg-accent-amber"
        : "bg-accent-green";
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

function Stat(props: { label: string; value: string; tone: "ok" | "warning" | "critical" }) {
  const valueClass =
    props.tone === "critical"
      ? "text-accent-red"
      : props.tone === "warning"
        ? "text-accent-amber"
        : "text-fg-primary";
  return (
    <div className="flex items-baseline justify-between rounded-md bg-bg-elevated px-3 py-2">
      <dt className="text-micro uppercase tracking-wider text-fg-muted">
        {props.label}
      </dt>
      <dd className={`font-mono ${valueClass}`}>{props.value}</dd>
    </div>
  );
}
