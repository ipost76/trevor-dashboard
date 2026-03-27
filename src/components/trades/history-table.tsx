"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Check,
  X,
  Edit3,
  Search,
  AlertTriangle,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { DirectionBadge } from "@/components/ui/direction-badge";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { TableRowSkeleton } from "@/components/ui/skeleton";
import { StyledLineChart } from "@/components/charts/StyledLineChart";

/* ── Types ── */

type TrainingStatus = "KEEP" | "EXCLUDE" | "REVIEW" | "IN_MEMORY";

type HistoryRecord = {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  leveraged_pnl_pct?: number;
  leverage?: number;
  confidence?: number;
  exit_reason?: string;
  outcome?: string;
  notes?: string;
  training_status?: TrainingStatus;
  created_at?: string;
  hold_time_minutes?: number;
};

type Filters = {
  ticker: string;
  outcome: string;
  direction: string;
  search: string;
};

type HistoryTableProps = {
  onRefresh: () => void;
};

/* ── Constants ── */

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<TrainingStatus, string> = {
  KEEP: "bg-[rgba(0,255,136,0.1)] text-[var(--neon-green)] border-[rgba(0,255,136,0.3)]",
  EXCLUDE: "bg-[rgba(255,51,102,0.1)] text-[var(--neon-red)] border-[rgba(255,51,102,0.3)]",
  REVIEW: "bg-[rgba(255,170,0,0.1)] text-[var(--neon-amber)] border-[rgba(255,170,0,0.3)]",
  IN_MEMORY: "bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border-[rgba(0,240,255,0.3)]",
};

/* ── Delete Confirmation Modal ── */

function DeleteModal({
  count,
  isChromaDB,
  onConfirm,
  onCancel,
}: {
  count: number;
  isChromaDB: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-4 w-80 space-y-3 border border-[var(--neon-red)] shadow-[0_0_20px_rgba(255,51,102,0.2)]">
        <div className="flex items-center gap-2 text-[var(--neon-red)]">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-bold">Confirm Delete</span>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-1">
          <p>
            This will permanently delete{" "}
            <span className="text-foreground font-bold">{count}</span>{" "}
            trade{count !== 1 ? "s" : ""} from:
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>
              <Database className="h-2.5 w-2.5 inline mr-1" />
              SQLite trade_outcomes table
            </li>
            {isChromaDB && (
              <li>
                <Database className="h-2.5 w-2.5 inline mr-1" />
                ChromaDB vector embeddings
              </li>
            )}
          </ul>
          <p className="text-[var(--neon-red)] font-bold pt-1">
            This action cannot be undone.
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end pt-1">
          <button onClick={onCancel} className="btn-primary text-[10px] px-3 py-1">
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="text-[10px] px-3 py-1 font-bold uppercase tracking-wider bg-[rgba(255,51,102,0.15)] text-[var(--neon-red)] border border-[rgba(255,51,102,0.3)] rounded hover:bg-[rgba(255,51,102,0.25)] transition-colors"
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Status Dropdown ── */

function StatusDropdown({
  value,
  onChange,
}: {
  value: TrainingStatus;
  onChange: (status: TrainingStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TrainingStatus)}
      className="input-terminal text-[9px] px-1 py-0.5 w-16 appearance-none cursor-pointer"
    >
      <option value="KEEP">KEEP</option>
      <option value="EXCLUDE">EXCLUDE</option>
      <option value="REVIEW">REVIEW</option>
      <option value="IN_MEMORY">IN_MEMORY</option>
    </select>
  );
}

/* ── Main Component ── */

export function HistoryTable({ onRefresh }: HistoryTableProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState("");
  const [filters, setFilters] = useState<Filters>({
    ticker: "",
    outcome: "",
    direction: "",
    search: "",
  });
  const [deleteModal, setDeleteModal] = useState<{
    ids: number[];
    show: boolean;
  }>({ ids: [], show: false });
  const [pnlChart, setPnlChart] = useState<Array<{ date: string; cumulative: number }>>([]);

  // Fetch cumulative P&L for chart
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stats/daily-pnl");
        const data = await res.json();
        if (Array.isArray(data)) {
          setPnlChart(data.map((d: Record<string, unknown>) => ({
            date: String(d.date || "").slice(5),
            cumulative: Number(d.cumulative) || 0,
          })));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      scope: "history",
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (filters.ticker) params.set("ticker", filters.ticker);
    if (filters.outcome) params.set("outcome", filters.outcome);
    if (filters.direction) params.set("direction", filters.direction);
    if (filters.search) params.set("search", filters.search);

    const d = await safeFetch<{ records?: HistoryRecord[]; total?: number }>(
      `/api/trades?${params.toString()}`,
      {}
    );
    setRecords(d.records || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [page, filters]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filters.ticker, filters.outcome, filters.direction, filters.search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /* ── Selection Handlers ── */

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map((r) => r.id)));
    }
  };

  /* ── Annotation ── */

  const startEdit = (record: HistoryRecord) => {
    setEditingId(record.id);
    setEditNote(record.notes || "");
  };

  const saveAnnotation = async (id: number) => {
    await fetch("/api/trades", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, notes: editNote }),
    });
    setEditingId(null);
    setEditNote("");
    fetchHistory();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNote("");
  };

  /* ── Status Update ── */

  const updateStatus = async (id: number, status: TrainingStatus) => {
    await fetch("/api/trades", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, training_status: status }),
    });
    fetchHistory();
  };

  /* ── Delete ── */

  const confirmDelete = (ids: number[]) => {
    setDeleteModal({ ids, show: true });
  };

  const executeDelete = async () => {
    const { ids } = deleteModal;
    if (ids.length === 1) {
      await fetch("/api/trades", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ids[0] }),
      });
    } else if (ids.length > 1) {
      await fetch("/api/trades", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    }
    setDeleteModal({ ids: [], show: false });
    setSelected(new Set());
    fetchHistory();
    onRefresh();
  };

  /* ── Bulk Actions ── */

  const bulkExclude = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await fetch("/api/trades", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    fetchHistory();
    onRefresh();
  };

  /* ── Filter Change Helpers ── */

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Cumulative P&L Chart */}
      {pnlChart.length > 1 && (
        <div className="px-2 pt-2 pb-1 border-b border-[var(--border)]">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 px-1">Cumulative P&L</div>
          <StyledLineChart
            data={pnlChart}
            lines={[{ dataKey: "cumulative", color: "#00ff88", name: "P&L %" }]}
            xKey="date"
            height={120}
            showArea
            referenceLine={0}
          />
        </div>
      )}

      {/* Filters Row */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--panel-header)]">
        <div className="flex items-center gap-1">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={filters.ticker}
            onChange={(e) => updateFilter("ticker", e.target.value.toUpperCase())}
            placeholder="TICKER"
            className="input-terminal w-20 text-[10px]"
          />
        </div>
        <select
          value={filters.outcome}
          onChange={(e) => updateFilter("outcome", e.target.value)}
          className="input-terminal text-[10px]"
        >
          <option value="">All Outcomes</option>
          <option value="WIN">WIN</option>
          <option value="LOSS">LOSS</option>
          <option value="SCRATCH">SCRATCH</option>
        </select>
        <select
          value={filters.direction}
          onChange={(e) => updateFilter("direction", e.target.value)}
          className="input-terminal text-[10px]"
        >
          <option value="">All Dirs</option>
          <option value="long">LONG</option>
          <option value="short">SHORT</option>
        </select>
        <input
          value={filters.search}
          onChange={(e) => updateFilter("search", e.target.value)}
          placeholder="Search notes..."
          className="input-terminal flex-1 text-[10px]"
        />
        <span className="text-[9px] text-muted-foreground whitespace-nowrap">
          {total} records
        </span>
      </div>

      {/* Bulk Toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--neon-cyan)] bg-[rgba(0,240,255,0.04)]">
          <span className="text-[10px] font-bold neon-text">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={bulkExclude}
            className="text-[9px] px-2 py-0.5 font-bold uppercase tracking-wider bg-[rgba(255,170,0,0.1)] text-[var(--neon-amber)] border border-[rgba(255,170,0,0.2)] rounded hover:bg-[rgba(255,170,0,0.2)] transition-colors"
          >
            Exclude Selected
          </button>
          <button
            onClick={() => confirmDelete(Array.from(selected))}
            className="text-[9px] px-2 py-0.5 font-bold uppercase tracking-wider bg-[rgba(255,51,102,0.1)] text-[var(--neon-red)] border border-[rgba(255,51,102,0.2)] rounded hover:bg-[rgba(255,51,102,0.2)] transition-colors"
          >
            Delete Selected
          </button>
        </div>
      )}

      {/* Mobile Card View */}
      <div className="md:hidden flex-1 overflow-auto p-2 space-y-2">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <TableRowSkeleton key={i} cols={3} />)}</div>
        ) : records.length === 0 ? (
          <EmptyState icon={Database} message="No trade records found" sub="Adjust filters or wait for trades to close" />
        ) : (
          records.map((r) => {
            const pnl = r.leveraged_pnl_pct ?? r.pnl_pct ?? 0;
            const date = r.created_at ? new Date(r.created_at + (r.created_at.includes("Z") ? "" : "Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "";
            return (
              <div key={r.id} className={cn("panel p-2.5 border-l-2", pnl > 0 ? "border-l-[var(--neon-green)]" : "border-l-[var(--neon-red)]")}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold">{r.ticker}</span>
                    <DirectionBadge dir={r.direction} />
                    {(r.leverage ?? 1) > 1 && <span className="text-[9px] neon-amber">{r.leverage}x</span>}
                  </div>
                  <span className={cn("text-[12px] font-bold font-mono", pnl > 0 ? "neon-green" : "neon-red")}>{pnl > 0 ? "+" : ""}{pnl.toFixed(1)}%</span>
                </div>
                <div className="flex gap-3 text-[9px] text-muted-foreground">
                  <span>Entry: ${r.entry_price?.toFixed(r.entry_price < 1 ? 4 : 2)}</span>
                  <span>Exit: ${r.exit_price?.toFixed(r.exit_price < 1 ? 4 : 2)}</span>
                  {r.confidence != null && <span>Conf: {r.confidence}</span>}
                  {date && <span>{date}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Table Header */}
      <div className="hidden md:flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)] text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground bg-[var(--panel-header)]">
        <span className="w-6 flex justify-center">
          <input
            type="checkbox"
            checked={records.length > 0 && selected.size === records.length}
            onChange={toggleSelectAll}
            className="accent-[var(--neon-cyan)] h-3 w-3 cursor-pointer"
          />
        </span>
        <span className="w-16">Ticker</span>
        <span className="w-10">Dir</span>
        <span className="w-14 text-right">P&L%</span>
        <span className="w-8 text-right">Lev</span>
        <span className="w-14 text-right">Conf</span>
        <span className="flex-1 min-w-0">Annotation</span>
        <span className="w-16">Status</span>
        <span className="w-14 text-right">Actions</span>
      </div>

      {/* Desktop Table Body */}
      <div className="hidden md:block flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRowSkeleton key={i} cols={8} />
            ))}
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            icon={Database}
            message="No trade records found"
            sub="Adjust filters or wait for trades to close"
          />
        ) : (
          records.map((r) => {
            const pnl = r.leveraged_pnl_pct ?? r.pnl_pct ?? 0;
            const status: TrainingStatus = r.training_status || "REVIEW";
            const isEditing = editingId === r.id;

            return (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-1 data-cell hover:bg-[rgba(0,240,255,0.03)] transition-colors",
                  selected.has(r.id) && "bg-[rgba(0,240,255,0.05)]"
                )}
              >
                {/* Checkbox */}
                <span className="w-6 flex justify-center">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="accent-[var(--neon-cyan)] h-3 w-3 cursor-pointer"
                  />
                </span>

                {/* Ticker */}
                <span className="w-16 font-bold truncate text-[11px]">
                  {r.ticker}
                </span>

                {/* Direction */}
                <span className="w-10">
                  <DirectionBadge dir={r.direction} />
                </span>

                {/* P&L */}
                <span
                  className={cn(
                    "w-14 text-right font-bold font-mono text-[11px]",
                    pnl > 0 ? "neon-green" : pnl < 0 ? "neon-red" : "text-muted-foreground"
                  )}
                >
                  {pnl > 0 ? "+" : ""}
                  {pnl.toFixed(2)}%
                </span>

                {/* Leverage */}
                <span className="w-8 text-right text-[10px] text-muted-foreground">
                  {r.leverage || 1}x
                </span>

                {/* Confidence */}
                <span className="w-14 flex justify-end">
                  {r.confidence != null ? (
                    <ConfidenceBar value={r.confidence} />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">--</span>
                  )}
                </span>

                {/* Annotation */}
                <span className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveAnnotation(r.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                        className="input-terminal text-[10px] flex-1"
                        placeholder="Add notes..."
                      />
                      <button
                        onClick={() => saveAnnotation(r.id)}
                        className="text-[var(--neon-green)] hover:opacity-80"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-[var(--neon-red)] hover:opacity-80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className="text-[10px] text-muted-foreground truncate block cursor-pointer hover:text-foreground"
                      onClick={() => startEdit(r)}
                      title={r.notes || "Click to annotate"}
                    >
                      {r.notes || "--"}
                    </span>
                  )}
                </span>

                {/* Training Status */}
                <span className="w-16">
                  <span
                    className={cn(
                      "text-[8px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider inline-block w-full text-center",
                      STATUS_STYLES[status]
                    )}
                  >
                    {status === "IN_MEMORY" ? "IN MEM" : status}
                  </span>
                </span>

                {/* Actions */}
                <span className="w-14 flex items-center justify-end gap-1">
                  <StatusDropdown
                    value={status}
                    onChange={(s) => updateStatus(r.id, s)}
                  />
                  <button
                    onClick={() => startEdit(r)}
                    className="text-muted-foreground hover:text-[var(--neon-cyan)] transition-colors"
                    title="Annotate"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => confirmDelete([r.id])}
                    className="text-muted-foreground hover:text-[var(--neon-red)] transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)] shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            className="btn-primary disabled:opacity-30"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="text-[10px] text-muted-foreground font-mono">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="btn-primary disabled:opacity-30"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal.show && (
        <DeleteModal
          count={deleteModal.ids.length}
          isChromaDB={deleteModal.ids.some((id) =>
            records.find((r) => r.id === id && r.training_status === "IN_MEMORY")
          )}
          onConfirm={executeDelete}
          onCancel={() => setDeleteModal({ ids: [], show: false })}
        />
      )}
    </div>
  );
}
