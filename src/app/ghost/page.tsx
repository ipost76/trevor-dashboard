"use client";
import { useEffect, useState, useCallback } from "react";
import { safeFetch } from "@/lib/fetch";
import { cn } from "@/lib/utils";
import { RefreshCw, Plus, X, Check, Pin, ChevronDown, ChevronRight, Trash2, Edit3, ExternalLink } from "lucide-react";

/* ── types ─────────────────────────────────────────────────────── */
interface VaultStatus { syncTimerActive: boolean; dailyFileCount: number; dailyFiles: string[]; memoryContent: string; heartbeatContent: string; }
interface Trade { id: number; ticker: string; direction: string; entry_price: number | null; exit_price: number | null; leverage: number; stop_loss: number | null; target: number | null; pnl_pct: number | null; outcome: string | null; notes: string | null; tags: string | null; source: string; opened_at: string; closed_at: string | null; }
interface Strategy { id: number; title: string; content: string; category: string | null; tags: string | null; status: string; created_at: string; }
interface Note { id: number; title: string; content: string; category: string | null; tags: string | null; pinned: number; created_at: string; }
interface Training { id: number; title: string; content: string | null; type: string; topic: string | null; status: string; progress_pct: number; source_url: string | null; tags: string | null; started_at: string | null; completed_at: string | null; created_at: string; }
interface Task { id: number; title: string; description: string | null; priority: string; status: string; category: string | null; due_date: string | null; tags: string | null; created_at: string; completed_at: string | null; }

const TABS = ["Vault", "Trades", "Strategies", "Notes", "Training", "Tasks"] as const;
type TabName = (typeof TABS)[number];

/* ── helpers ────────────────────────────────────────────────────── */
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function badge(text: string, color: string) {
  return <span className={cn("px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold border", color)}>{text}</span>;
}

const priorityColors: Record<string, string> = { urgent: "text-red-400 border-red-400/30 bg-red-400/10", high: "text-amber-400 border-amber-400/30 bg-amber-400/10", medium: "text-cyan-400 border-cyan-400/30 bg-cyan-400/10", low: "text-gray-500 border-gray-500/30 bg-gray-500/10" };
const statusColors: Record<string, string> = { active: "text-green-400 border-green-400/30 bg-green-400/10", testing: "text-amber-400 border-amber-400/30 bg-amber-400/10", retired: "text-gray-500 border-gray-500/30 bg-gray-500/10", idea: "text-cyan-400 border-cyan-400/30 bg-cyan-400/10" };

/* ── Modal ──────────────────────────────────────────────────────── */
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="glass-strong w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto rounded-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(0,240,255,0.1)]">
          <h3 className="text-xs font-bold tracking-[0.15em] uppercase neon-text">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded" />
    </label>
  );
}

function TextArea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <textarea {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded min-h-[80px] resize-y" />
    </label>
  );
}

function Select({ label, options, ...props }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded bg-[rgba(0,240,255,0.04)]">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* ── VAULT TAB ──────────────────────────────────────────────────── */
function VaultTab() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [dailyContent, setDailyContent] = useState<Record<string, string>>({});

  const load = useCallback(() => { safeFetch<VaultStatus>("/api/ghost", { syncTimerActive: false, dailyFileCount: 0, dailyFiles: [], memoryContent: "", heartbeatContent: "" }).then(setStatus); }, []);
  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [load]);

  const loadDaily = async (date: string) => {
    if (expandedDate === date) { setExpandedDate(null); return; }
    setExpandedDate(date);
    if (!dailyContent[date]) {
      const r = await safeFetch<{ content: string }>(`/api/ghost/daily/${date}`, { content: "" });
      setDailyContent(p => ({ ...p, [date]: r.content }));
    }
  };

  if (!status) return <div className="text-muted-foreground text-xs p-8">Loading vault status...</div>;

  return (
    <div className="space-y-4">
      {/* Status + Heartbeat row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="panel-header mb-3">Sync Status</div>
          <div className="flex items-center gap-2 mb-2">
            <div className={cn("h-2 w-2 rounded-full", status.syncTimerActive ? "bg-green-400 shadow-[0_0_6px_rgba(0,255,136,0.5)]" : "bg-red-400")} />
            <span className="text-xs">{status.syncTimerActive ? "Timer Active" : "Timer Inactive"}</span>
          </div>
          <div className="text-[10px] text-muted-foreground space-y-1">
            <div>Daily memory files: <span className="text-foreground">{status.dailyFileCount}</span></div>
            {status.dailyFiles.length > 0 && <div>Range: {status.dailyFiles[status.dailyFiles.length - 1]?.replace(".md", "")} — {status.dailyFiles[0]?.replace(".md", "")}</div>}
          </div>
        </div>
        <div className="panel p-4">
          <div className="panel-header mb-3">TREVOR Heartbeat</div>
          {status.heartbeatContent ? (
            <pre className="text-[10px] leading-relaxed text-muted-foreground max-h-[200px] overflow-y-auto whitespace-pre-wrap">{status.heartbeatContent}</pre>
          ) : (
            <div className="text-xs text-muted-foreground">Heartbeat not available</div>
          )}
        </div>
      </div>

      {/* Memory */}
      <div className="panel p-4">
        <div className="panel-header mb-3">TREVOR Memory</div>
        {status.memoryContent ? (
          <pre className="text-[10px] leading-relaxed text-muted-foreground max-h-[300px] overflow-y-auto whitespace-pre-wrap bg-[#0a0a12] p-3 rounded">{status.memoryContent}</pre>
        ) : (
          <div className="text-xs text-muted-foreground">Memory not available</div>
        )}
      </div>

      {/* Daily Timeline */}
      <div className="panel p-4">
        <div className="panel-header mb-3">Daily Memory Timeline</div>
        {status.dailyFiles.length === 0 ? (
          <div className="text-xs text-muted-foreground">No daily memory files found.</div>
        ) : (
          <div className="space-y-1">
            {status.dailyFiles.map(f => {
              const date = f.replace(".md", "");
              const isExpanded = expandedDate === date;
              return (
                <div key={date}>
                  <button onClick={() => loadDaily(date)} className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-[rgba(0,240,255,0.04)] transition-colors">
                    {isExpanded ? <ChevronDown className="h-3 w-3 text-cyan-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="text-xs font-mono neon-text">{date}</span>
                  </button>
                  {isExpanded && (
                    <pre className="text-[10px] leading-relaxed text-muted-foreground bg-[#0a0a12] p-3 mx-3 mb-2 rounded max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                      {dailyContent[date] || "Loading..."}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── TRADES TAB ─────────────────────────────────────────────────── */
function TradesTab() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState({ total: 0, wins: 0, losses: 0, open: 0, win_rate: 0, avg_pnl: 0 });
  const [showForm, setShowForm] = useState(false);
  const [closeId, setCloseId] = useState<number | null>(null);
  const [closePrice, setClosePrice] = useState("");
  const [form, setForm] = useState({ ticker: "", direction: "LONG", entry_price: "", leverage: "1", stop_loss: "", target: "", notes: "" });

  const load = useCallback(() => {
    safeFetch<{ items: Trade[]; stats: typeof stats }>("/api/ghost/trades", { items: [], stats: { total: 0, wins: 0, losses: 0, open: 0, win_rate: 0, avg_pnl: 0 } }).then(d => { setTrades(d.items); if (d.stats) setStats(d.stats); });
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.ticker) return;
    await fetch("/api/ghost/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: form.ticker, direction: form.direction, entry_price: form.entry_price ? parseFloat(form.entry_price) : null, leverage: parseFloat(form.leverage) || 1, stop_loss: form.stop_loss ? parseFloat(form.stop_loss) : null, target: form.target ? parseFloat(form.target) : null, notes: form.notes || null }) });
    setForm({ ticker: "", direction: "LONG", entry_price: "", leverage: "1", stop_loss: "", target: "", notes: "" });
    setShowForm(false);
    load();
  };

  const closeTrade = async () => {
    if (!closeId || !closePrice) return;
    await fetch(`/api/ghost/trades/${closeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exit_price: parseFloat(closePrice), _action: "close" }) });
    setCloseId(null); setClosePrice("");
    load();
  };

  const deleteTrade = async (id: number) => {
    if (!confirm("Delete this trade?")) return;
    await fetch(`/api/ghost/trades/${id}`, { method: "DELETE" });
    load();
  };

  const openTrades = trades.filter(t => !t.outcome || t.outcome === "OPEN");
  const closedTrades = trades.filter(t => t.outcome && t.outcome !== "OPEN");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Trade</button>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Trade">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Ticker" value={form.ticker} onChange={e => setForm(p => ({ ...p, ticker: e.target.value }))} placeholder="BTC" />
          <Select label="Direction" options={["LONG", "SHORT"]} value={form.direction} onChange={e => setForm(p => ({ ...p, direction: e.target.value }))} />
          <Input label="Entry Price" type="number" step="any" value={form.entry_price} onChange={e => setForm(p => ({ ...p, entry_price: e.target.value }))} />
          <Input label="Leverage" type="number" step="any" value={form.leverage} onChange={e => setForm(p => ({ ...p, leverage: e.target.value }))} />
          <Input label="Stop Loss" type="number" step="any" value={form.stop_loss} onChange={e => setForm(p => ({ ...p, stop_loss: e.target.value }))} />
          <Input label="Target" type="number" step="any" value={form.target} onChange={e => setForm(p => ({ ...p, target: e.target.value }))} />
        </div>
        <TextArea label="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Trade</button>
      </Modal>

      <Modal open={closeId !== null} onClose={() => setCloseId(null)} title="Close Trade">
        <Input label="Exit Price" type="number" step="any" value={closePrice} onChange={e => setClosePrice(e.target.value)} autoFocus />
        <button onClick={closeTrade} className="btn-primary w-full py-2 text-xs mt-2">Close & Calculate P&L</button>
      </Modal>

      {openTrades.length > 0 && (
        <div className="panel p-4">
          <div className="panel-header mb-3">Open Trades</div>
          <div className="space-y-2">
            {openTrades.map(t => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded bg-[rgba(0,240,255,0.03)] border border-[rgba(0,240,255,0.08)]">
                <div>
                  <span className="font-bold text-xs">{t.ticker}</span> {badge(t.direction, t.direction === "LONG" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-red-400 border-red-400/30 bg-red-400/10")}
                  <div className="text-[10px] text-muted-foreground mt-1">${t.entry_price?.toFixed(2)} {t.leverage}x{t.stop_loss ? ` Stop $${t.stop_loss}` : ""} {timeAgo(t.opened_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setCloseId(t.id); setClosePrice(""); }} className="text-[10px] px-2 py-1 rounded border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10">Close</button>
                  <button onClick={() => deleteTrade(t.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel p-4">
        <div className="panel-header mb-3">Trade History</div>
        {closedTrades.length === 0 ? (
          <div className="text-xs text-muted-foreground">No closed trades yet.</div>
        ) : (
          <div className="space-y-1">
            {closedTrades.map(t => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-[rgba(0,240,255,0.03)]">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t.outcome === "WIN" ? "\u2705" : t.outcome === "LOSS" ? "\u274c" : "\u2796"}</span>
                  <span className="text-xs font-bold">{t.ticker} {t.direction}</span>
                  <span className={cn("text-xs font-mono", (t.pnl_pct ?? 0) >= 0 ? "neon-green" : "neon-red")}>{t.pnl_pct != null ? `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(1)}%` : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{timeAgo(t.closed_at)}</span>
                  <button onClick={() => deleteTrade(t.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-3 py-2 text-[10px] text-muted-foreground">
        <span>{stats.total} trades</span>
        <span className="neon-green">{stats.wins}W</span>
        <span className="neon-red">{stats.losses}L</span>
        <span>{stats.win_rate}% WR</span>
        <span>Avg {stats.avg_pnl >= 0 ? "+" : ""}{stats.avg_pnl}%</span>
      </div>
    </div>
  );
}

/* ── STRATEGIES TAB ─────────────────────────────────────────────── */
function StrategiesTab() {
  const [items, setItems] = useState<Strategy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "general", status: "active" });

  const load = useCallback(() => { safeFetch<{ items: Strategy[] }>("/api/ghost/strategies", { items: [] }).then(d => setItems(d.items)); }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.title || !form.content) return;
    await fetch("/api/ghost/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ title: "", content: "", category: "general", status: "active" }); setShowForm(false); load();
  };

  const del = async (id: number) => { if (!confirm("Delete?")) return; await fetch(`/api/ghost/strategies/${id}`, { method: "DELETE" }); load(); };

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Strategy</button>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Strategy">
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
        <TextArea label="Content" rows={6} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" options={["general", "scalp", "swing", "macro", "momentum", "reversal"]} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} />
          <Select label="Status" options={["active", "testing", "retired", "idea"]} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} />
        </div>
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Strategy</button>
      </Modal>
      <div className="space-y-2">
        {items.length === 0 ? <div className="text-xs text-muted-foreground panel p-4">No strategies yet.</div> : items.map(s => (
          <div key={s.id} className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                <span className="text-xs font-bold">{s.title}</span>
                {badge(s.category || "general", "text-muted-foreground border-gray-500/30 bg-gray-500/5")}
                {badge(s.status, statusColors[s.status] || statusColors.active)}
              </div>
              <button onClick={() => del(s.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
            </div>
            {expanded === s.id ? (
              <pre className="text-[10px] text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{s.content}</pre>
            ) : (
              <div className="text-[10px] text-muted-foreground mt-1 truncate">{s.content.slice(0, 150)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── NOTES TAB ──────────────────────────────────────────────────── */
function NotesTab() {
  const [items, setItems] = useState<Note[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ title: "", content: "", category: "", pinned: 0 });

  const load = useCallback(() => { safeFetch<{ items: Note[] }>("/api/ghost/notes", { items: [] }).then(d => setItems(d.items)); }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.title || !form.content) return;
    await fetch("/api/ghost/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ title: "", content: "", category: "", pinned: 0 }); setShowForm(false); load();
  };

  const togglePin = async (n: Note) => {
    await fetch(`/api/ghost/notes/${n.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: n.pinned ? 0 : 1 }) });
    load();
  };

  const del = async (id: number) => { if (!confirm("Delete?")) return; await fetch(`/api/ghost/notes/${id}`, { method: "DELETE" }); load(); };

  const filtered = items.filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase()));
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Note</button>
        <input className="input-terminal px-2.5 py-1.5 text-xs rounded flex-1" placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Note">
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
        <TextArea label="Content" rows={6} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} />
        <Input label="Category" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="thought, idea, reflection..." />
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Note</button>
      </Modal>
      {pinned.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">\ud83d\udccc Pinned</div>
          <div className="space-y-1">{pinned.map(n => <NoteCard key={n.id} note={n} expanded={expanded === n.id} onExpand={() => setExpanded(expanded === n.id ? null : n.id)} onPin={() => togglePin(n)} onDelete={() => del(n.id)} />)}</div>
        </div>
      )}
      <div className="space-y-1">{unpinned.map(n => <NoteCard key={n.id} note={n} expanded={expanded === n.id} onExpand={() => setExpanded(expanded === n.id ? null : n.id)} onPin={() => togglePin(n)} onDelete={() => del(n.id)} />)}</div>
      {filtered.length === 0 && <div className="text-xs text-muted-foreground panel p-4">No notes yet.</div>}
    </div>
  );
}

function NoteCard({ note, expanded, onExpand, onPin, onDelete }: { note: Note; expanded: boolean; onExpand: () => void; onPin: () => void; onDelete: () => void }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0" onClick={onExpand}>
          <span className="text-xs font-bold truncate">{note.title}</span>
          {note.category && <span className="text-[9px] text-muted-foreground">#{note.category}</span>}
          <span className="text-[9px] text-muted-foreground">{timeAgo(note.created_at)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onPin} className={cn("p-0.5", note.pinned ? "text-amber-400" : "text-muted-foreground hover:text-amber-400")}><Pin className="h-3 w-3" /></button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-red-400 p-0.5"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      {expanded ? (
        <pre className="text-[10px] text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{note.content}</pre>
      ) : (
        <div className="text-[10px] text-muted-foreground mt-1 truncate">{note.content.slice(0, 100)}</div>
      )}
    </div>
  );
}

/* ── TRAINING TAB ───────────────────────────────────────────────── */
function TrainingTab() {
  const [items, setItems] = useState<Training[]>([]);
  const [stats, setStats] = useState({ active: 0, completed: 0 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", type: "study", topic: "", source_url: "", status: "in-progress", progress_pct: "0" });

  const load = useCallback(() => { safeFetch<{ items: Training[]; stats: typeof stats }>("/api/ghost/training", { items: [], stats: { active: 0, completed: 0 } }).then(d => { setItems(d.items); if (d.stats) setStats(d.stats); }); }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.title) return;
    await fetch("/api/ghost/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, progress_pct: parseInt(form.progress_pct) || 0, started_at: new Date().toISOString() }) });
    setForm({ title: "", content: "", type: "study", topic: "", source_url: "", status: "in-progress", progress_pct: "0" }); setShowForm(false); load();
  };

  const complete = async (id: number) => {
    await fetch(`/api/ghost/training/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
    load();
  };

  const del = async (id: number) => { if (!confirm("Delete?")) return; await fetch(`/api/ghost/training/${id}`, { method: "DELETE" }); load(); };

  const inProgress = items.filter(t => t.status === "in-progress");
  const completed = items.filter(t => t.status === "completed");
  const other = items.filter(t => !["in-progress", "completed"].includes(t.status));

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Entry</button>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Training Entry">
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Advances in Financial ML" />
        <TextArea label="Notes" value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" options={["study", "course", "book", "video", "practice", "research", "other"]} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} />
          <Input label="Topic" value={form.topic} onChange={e => setForm(p => ({ ...p, topic: e.target.value }))} placeholder="quant, ta, python..." />
        </div>
        <Input label="Source URL" value={form.source_url} onChange={e => setForm(p => ({ ...p, source_url: e.target.value }))} />
        <Input label="Progress %" type="number" min="0" max="100" value={form.progress_pct} onChange={e => setForm(p => ({ ...p, progress_pct: e.target.value }))} />
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Entry</button>
      </Modal>

      {inProgress.length > 0 && (
        <div className="panel p-4">
          <div className="panel-header mb-3">In Progress</div>
          <div className="space-y-3">{inProgress.map(t => <TrainingCard key={t.id} item={t} onComplete={() => complete(t.id)} onDelete={() => del(t.id)} />)}</div>
        </div>
      )}
      {other.length > 0 && (
        <div className="panel p-4">
          <div className="panel-header mb-3">Queued</div>
          <div className="space-y-3">{other.map(t => <TrainingCard key={t.id} item={t} onComplete={() => complete(t.id)} onDelete={() => del(t.id)} />)}</div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="panel p-4">
          <div className="panel-header mb-3">Completed</div>
          <div className="space-y-3">{completed.map(t => <TrainingCard key={t.id} item={t} onDelete={() => del(t.id)} />)}</div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground px-3">{stats.active} active | {stats.completed} completed</div>
    </div>
  );
}

function TrainingCard({ item, onComplete, onDelete }: { item: Training; onComplete?: () => void; onDelete: () => void }) {
  return (
    <div className="p-3 rounded bg-[rgba(0,240,255,0.02)] border border-[rgba(0,240,255,0.06)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">{item.title}</span>
          {badge(item.type, "text-muted-foreground border-gray-500/30 bg-gray-500/5")}
          {item.topic && <span className="text-[9px] text-muted-foreground">{item.topic}</span>}
        </div>
        <div className="flex items-center gap-2">
          {item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-cyan-400"><ExternalLink className="h-3 w-3" /></a>}
          {onComplete && item.status !== "completed" && <button onClick={onComplete} className="text-[10px] px-2 py-0.5 rounded border border-green-400/30 text-green-400 hover:bg-green-400/10">Complete</button>}
          <button onClick={onDelete} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      {item.status !== "completed" && (
        <div className="mt-2 h-1.5 rounded-full bg-[rgba(0,240,255,0.1)] overflow-hidden">
          <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${item.progress_pct}%` }} />
        </div>
      )}
      <div className="text-[9px] text-muted-foreground mt-1">{item.progress_pct}% | {item.status === "completed" ? `Completed ${timeAgo(item.completed_at)}` : `Started ${timeAgo(item.started_at)}`}</div>
    </div>
  );
}

/* ── TASKS TAB ──────────────────────────────────────────────────── */
function TasksTab() {
  const [items, setItems] = useState<Task[]>([]);
  const [stats, setStats] = useState({ total: 0, open: 0, done: 0, overdue: 0 });
  const [showForm, setShowForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", category: "", due_date: "" });

  const load = useCallback(() => { safeFetch<{ items: Task[]; stats: typeof stats }>("/api/ghost/tasks", { items: [], stats: { total: 0, open: 0, done: 0, overdue: 0 } }).then(d => { setItems(d.items); if (d.stats) setStats(d.stats); }); }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.title) return;
    await fetch("/api/ghost/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ title: "", description: "", priority: "medium", category: "", due_date: "" }); setShowForm(false); load();
  };

  const toggle = async (t: Task) => {
    const newStatus = t.status === "done" ? "todo" : "done";
    await fetch(`/api/ghost/tasks/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    load();
  };

  const del = async (id: number) => { if (!confirm("Delete?")) return; await fetch(`/api/ghost/tasks/${id}`, { method: "DELETE" }); load(); };

  const openTasks = items.filter(t => t.status !== "done" && t.status !== "cancelled");
  const doneTasks = items.filter(t => t.status === "done");
  const groups: Record<string, Task[]> = {};
  for (const t of openTasks) { const p = t.priority || "medium"; (groups[p] ??= []).push(t); }
  const priorityOrder = ["urgent", "high", "medium", "low"];
  const isOverdue = (t: Task) => t.due_date && new Date(t.due_date) < new Date() && t.status !== "done";

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Task</button>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Task">
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
        <TextArea label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Priority" options={["low", "medium", "high", "urgent"]} value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} />
          <Input label="Category" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="trevor, personal..." />
        </div>
        <Input label="Due Date" type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Task</button>
      </Modal>

      {priorityOrder.map(p => {
        const tasks = groups[p];
        if (!tasks?.length) return null;
        return (
          <div key={p} className="panel p-4">
            <div className="panel-header mb-2">{badge(p, priorityColors[p] || priorityColors.medium)} <span className="ml-2 text-muted-foreground">{p.toUpperCase()}</span></div>
            <div className="space-y-1">
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[rgba(0,240,255,0.03)]">
                  <button onClick={() => toggle(t)} className="h-4 w-4 rounded border border-[rgba(0,240,255,0.3)] flex items-center justify-center shrink-0 hover:bg-cyan-400/10" />
                  <span className={cn("text-xs flex-1", isOverdue(t) && "text-red-400")}>{t.title}</span>
                  {t.category && <span className="text-[9px] text-muted-foreground">{t.category}</span>}
                  {t.due_date && <span className={cn("text-[9px]", isOverdue(t) ? "text-red-400" : "text-muted-foreground")}>{t.due_date}</span>}
                  <button onClick={() => del(t.id)} className="text-muted-foreground hover:text-red-400 shrink-0"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {doneTasks.length > 0 && (
        <div className="panel p-4">
          <button onClick={() => setShowDone(!showDone)} className="panel-header flex items-center gap-2 w-full text-left">
            {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Done ({doneTasks.length})
          </button>
          {showDone && (
            <div className="space-y-1 mt-2">
              {doneTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 py-1 px-2 text-muted-foreground">
                  <button onClick={() => toggle(t)} className="h-4 w-4 rounded border border-green-400/30 bg-green-400/10 flex items-center justify-center shrink-0"><Check className="h-2.5 w-2.5 text-green-400" /></button>
                  <span className="text-xs line-through flex-1">{t.title}</span>
                  <span className="text-[9px]">{timeAgo(t.completed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground px-3">{stats.open} open | {stats.done} done | {stats.overdue > 0 ? <span className="text-red-400">{stats.overdue} overdue</span> : "0 overdue"}</div>
    </div>
  );
}

/* ── MAIN PAGE ──────────────────────────────────────────────────── */
export default function GhostPage() {
  const [tab, setTab] = useState<TabName>("Vault");

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <h1 className="text-lg font-bold tracking-[0.2em] uppercase neon-text">Ghost Command Center</h1>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-[rgba(0,240,255,0.1)]">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold whitespace-nowrap rounded-t transition-colors",
              tab === t
                ? "text-[var(--neon-cyan)] border-b-2 border-[var(--neon-cyan)] bg-[rgba(0,240,255,0.06)]"
                : "text-muted-foreground hover:text-foreground hover:bg-[rgba(0,240,255,0.03)]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "Vault" && <VaultTab />}
        {tab === "Trades" && <TradesTab />}
        {tab === "Strategies" && <StrategiesTab />}
        {tab === "Notes" && <NotesTab />}
        {tab === "Training" && <TrainingTab />}
        {tab === "Tasks" && <TasksTab />}
      </div>
    </div>
  );
}
