"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { Modal, Input, TextArea, Select, timeAgo, badge, statusColors } from "./shared";

interface Strategy {
  id: number; title: string; content: string; category: string | null;
  tags: string | null; status: string; created_at: string;
  assets: string | null; direction: string | null; timeframe: string | null;
  entry_conditions: string | null; exit_rules: string | null;
  risk_per_trade: string | null; min_confidence: number | null;
  win_count: number; loss_count: number; total_pnl: number;
  last_triggered_at: string | null;
}

type StatusFilter = "all" | "active" | "testing" | "retired" | "idea";

const borderColors: Record<string, string> = {
  active: "border-l-green-400", testing: "border-l-amber-400",
  retired: "border-l-gray-500", idea: "border-l-cyan-400",
};

const defaultForm = {
  title: "", content: "", category: "scalp", status: "idea", direction: "BOTH",
  assets: "", entry_conditions: "", exit_rules: "", risk_per_trade: "",
  min_confidence: "",
};

export function StrategiesTab() {
  const [items, setItems] = useState<Strategy[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...defaultForm });

  const load = useCallback(() => {
    safeFetch<{ items: Strategy[] }>("/api/ghost/strategies", { items: [] }).then(d => setItems(d.items));
  }, []);
  useEffect(load, [load]);

  const filtered = statusFilter === "all" ? items : items.filter(s => s.status === statusFilter);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...defaultForm });
    setShowForm(true);
  };

  const openEdit = (s: Strategy) => {
    setEditId(s.id);
    setForm({
      title: s.title, content: s.content || "",
      category: s.category || "scalp", status: s.status || "idea",
      direction: s.direction || "BOTH",
      assets: s.assets || "",
      entry_conditions: s.entry_conditions || "",
      exit_rules: s.exit_rules || "",
      risk_per_trade: s.risk_per_trade || "",
      min_confidence: s.min_confidence != null ? String(s.min_confidence) : "",
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title) return;
    const body: Record<string, unknown> = {
      title: form.title, content: form.content || form.title,
      category: form.category, status: form.status, direction: form.direction,
      assets: form.assets || null,
      entry_conditions: form.entry_conditions || null,
      exit_rules: form.exit_rules || null,
      risk_per_trade: form.risk_per_trade || null,
      min_confidence: form.min_confidence ? parseInt(form.min_confidence) : null,
    };
    if (editId) {
      await fetch(`/api/ghost/strategies/${editId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/ghost/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setShowForm(false);
    setEditId(null);
    load();
  };

  const archive = async (id: number) => {
    await fetch(`/api/ghost/strategies/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "retired" }) });
    load();
  };

  const del = async (id: number) => {
    if (!confirm("Delete this strategy? This cannot be undone.")) return;
    await fetch(`/api/ghost/strategies/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-3 overflow-y-auto pb-32">
      <button onClick={openCreate} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Strategy</button>

      {/* ── Status Filter ── */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {(["all", "active", "testing", "retired", "idea"] as StatusFilter[]).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={cn("px-2.5 py-1.5 rounded text-[9px] font-bold uppercase whitespace-nowrap transition-colors",
              statusFilter === f ? "bg-[rgba(0,255,136,0.15)] text-[#00ff88] border border-[rgba(0,255,136,0.3)]" : "text-muted-foreground hover:text-foreground hover:bg-[rgba(0,240,255,0.04)]"
            )}>{f === "idea" ? "IDEAS" : f.toUpperCase()}</button>
        ))}
      </div>

      {/* ── Strategy Cards ── */}
      {filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground panel p-4 text-center">No strategies{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => {
            const isExpanded = expanded === s.id;
            const border = borderColors[s.status] || "border-l-gray-500";
            const totalTrades = (s.win_count || 0) + (s.loss_count || 0);
            const wr = totalTrades > 0 ? Math.round(s.win_count / totalTrades * 100) : null;
            return (
              <div key={s.id} className={cn("panel border-l-[3px] overflow-hidden", border, s.status === "retired" && "opacity-60")}>
                {/* Collapsed header */}
                <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs font-bold truncate">{s.title}</span>
                    {badge(s.category || "general", "text-muted-foreground border-gray-500/30 bg-gray-500/5")}
                    {badge(s.status, statusColors[s.status] || statusColors.active)}
                  </div>
                </div>
                {/* Summary line */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-[10px] text-muted-foreground">
                  {s.assets && <span>Assets: <span className="text-foreground">{s.assets}</span></span>}
                  {s.direction && s.direction !== "BOTH" && <span>Dir: <span className="text-foreground">{s.direction}</span></span>}
                  {s.min_confidence != null && <span>Min: <span className="text-foreground">{s.min_confidence}%</span></span>}
                  {s.timeframe && <span>{s.timeframe}</span>}
                </div>
                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-[rgba(0,240,255,0.06)] pt-2">
                    {s.entry_conditions && (
                      <div><div className="text-[8px] uppercase text-muted-foreground mb-0.5">Entry Conditions</div><div className="text-[11px] text-foreground">{s.entry_conditions}</div></div>
                    )}
                    {s.exit_rules && (
                      <div><div className="text-[8px] uppercase text-muted-foreground mb-0.5">Exit Rules</div><div className="text-[11px] text-foreground">{s.exit_rules}</div></div>
                    )}
                    {s.risk_per_trade && (
                      <div><div className="text-[8px] uppercase text-muted-foreground mb-0.5">Risk</div><div className="text-[11px] text-foreground">{s.risk_per_trade}</div></div>
                    )}
                    {s.content && !s.entry_conditions && (
                      <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">{s.content}</pre>
                    )}
                    {totalTrades > 0 && (
                      <div className="flex items-center gap-3 text-[10px] pt-1">
                        <span className="text-muted-foreground">Performance:</span>
                        <span className="neon-green">{s.win_count}W</span>
                        <span className="neon-red">{s.loss_count}L</span>
                        {wr !== null && <span>({wr}% WR)</span>}
                        <span className={cn(s.total_pnl >= 0 ? "neon-green" : "neon-red")}>{s.total_pnl >= 0 ? "+" : ""}{s.total_pnl.toFixed(1)}%</span>
                      </div>
                    )}
                    {s.last_triggered_at && <div className="text-[9px] text-muted-foreground">Last triggered: {timeAgo(s.last_triggered_at)}</div>}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="text-[10px] px-2 py-1 rounded border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10">Edit</button>
                      {s.status !== "retired" && (
                        <button onClick={(e) => { e.stopPropagation(); archive(s.id); }} className="text-[10px] px-2 py-1 rounded border border-gray-500/30 text-muted-foreground hover:bg-gray-500/10 flex items-center gap-1"><Archive className="h-3 w-3" />Archive</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); del(s.id); }} className="text-muted-foreground hover:text-red-400 ml-auto"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create/Edit Modal ── */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditId(null); }} title={editId ? "Edit Strategy" : "New Strategy"}>
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="SOL Momentum Scalp" />
        <div className="grid grid-cols-3 gap-3">
          <Select label="Status" options={["active", "testing", "retired", "idea"]} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} />
          <Select label="Category" options={["scalp", "swing", "position", "macro", "other"]} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} />
          <Select label="Direction" options={["BOTH", "LONG", "SHORT"]} value={form.direction} onChange={e => setForm(p => ({ ...p, direction: e.target.value }))} />
        </div>
        <Input label="Assets (comma-separated, blank = all)" value={form.assets} onChange={e => setForm(p => ({ ...p, assets: e.target.value }))} placeholder="BTC, SOL, ETH" />
        <TextArea label="Entry Conditions" rows={3} value={form.entry_conditions} onChange={e => setForm(p => ({ ...p, entry_conditions: e.target.value }))} placeholder="15m MACD cross with volume confirmation..." />
        <TextArea label="Exit Rules" rows={3} value={form.exit_rules} onChange={e => setForm(p => ({ ...p, exit_rules: e.target.value }))} placeholder="Target 2-3% with 1% stop..." />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Risk Per Trade" value={form.risk_per_trade} onChange={e => setForm(p => ({ ...p, risk_per_trade: e.target.value }))} placeholder="5x max leverage" />
          <Input label="Min Confidence (0-100)" type="number" min="0" max="100" value={form.min_confidence} onChange={e => setForm(p => ({ ...p, min_confidence: e.target.value }))} />
        </div>
        <TextArea label="Notes" rows={3} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} />
        <button onClick={save} className="btn-primary w-full py-2 text-xs mt-2">{editId ? "Save Changes" : "Create Strategy"}</button>
      </Modal>
    </div>
  );
}
