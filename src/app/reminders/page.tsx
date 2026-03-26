"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Bell, Clock, CheckCircle, XCircle, Plus, Trash2, Edit3, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";

type Reminder = {
  id: number;
  text: string;
  due_at: string;
  repeat_mode: string;
  times_fired: number;
  last_fired_at: string | null;
  status: string;
  discord_message_id: string | null;
  created_at: string;
  completed_at: string | null;
  source: string;
};

type Tab = "active" | "pending" | "completed" | "all";

function relativeTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const now = Date.now();
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff > 0 ? "now" : "just now";
  if (abs < 3600_000) {
    const m = Math.round(abs / 60_000);
    return diff > 0 ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400_000) {
    const h = Math.round(abs / 3600_000);
    return diff > 0 ? `in ${h}h` : `${h}h ago`;
  }
  const days = Math.round(abs / 86400_000);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

const MODE_LABELS: Record<string, string> = {
  once: "1x",
  twice: "2x",
  until_confirmed: "Until DONE",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "PENDING", cls: "text-[var(--neon-amber)]" },
  active: { label: "ACTIVE", cls: "text-[var(--neon-green)]" },
  completed: { label: "DONE", cls: "text-muted-foreground" },
  cancelled: { label: "CANCELLED", cls: "text-muted-foreground line-through" },
};

const QUICK_TIMES = ["30m", "1h", "2h", "4h", "1d", "1w"];

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [showForm, setShowForm] = useState(false);
  const [formText, setFormText] = useState("");
  const [formWhen, setFormWhen] = useState("");
  const [formMode, setFormMode] = useState("once");
  const [editId, setEditId] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    const data = await safeFetch<{ reminders: Reminder[] }>("/api/reminders?all=true", { reminders: [] });
    setReminders(data.reminders || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const filtered = reminders.filter((r) => {
    if (tab === "all") return true;
    if (tab === "active") return r.status === "active";
    if (tab === "pending") return r.status === "pending";
    if (tab === "completed") return r.status === "completed" || r.status === "cancelled";
    return true;
  });

  const counts = {
    active: reminders.filter((r) => r.status === "active").length,
    pending: reminders.filter((r) => r.status === "pending").length,
    completed: reminders.filter((r) => r.status === "completed" || r.status === "cancelled").length,
  };

  const parseWhen = (when: string): string => {
    const s = when.trim().toLowerCase();
    const units: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080 };
    for (const [suffix, mins] of Object.entries(units)) {
      if (s.endsWith(suffix) && s.slice(0, -1).match(/^\d+$/)) {
        const offset = parseInt(s) * mins;
        return new Date(Date.now() + offset * 60_000).toISOString();
      }
    }
    try { return new Date(when).toISOString(); } catch { return ""; }
  };

  const handleCreate = async () => {
    if (!formText || !formWhen) return;
    const dueIso = parseWhen(formWhen);
    if (!dueIso) return;
    await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: formText, due_at: dueIso, repeat_mode: formMode }),
    });
    setFormText(""); setFormWhen(""); setFormMode("once"); setShowForm(false);
    fetchAll();
  };

  const handleAction = async (id: number, action: string) => {
    await fetch(`/api/reminders/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchAll();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    fetchAll();
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "completed", label: "Completed", count: counts.completed },
    { key: "all", label: "All", count: reminders.length },
  ];

  return (
    <div className="flex-1 overflow-hidden p-2">
      <div className="panel h-full flex flex-col">
        {/* Header */}
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5" />
            <span>REMINDERS</span>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary flex items-center gap-1 text-[10px] px-2 py-0.5"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 px-3 py-2 border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "text-[10px] uppercase tracking-wider font-bold transition-colors",
                tab === t.key ? "text-[var(--neon-cyan)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label} <span className="opacity-60">({t.count})</span>
            </button>
          ))}
        </div>

        {/* New Reminder Form */}
        {showForm && (
          <div className="px-3 py-2 border-b border-[var(--border)] space-y-2 bg-[rgba(0,240,255,0.02)]">
            <input
              type="text"
              placeholder="What to remind about..."
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              className="input-terminal w-full text-[11px]"
            />
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex gap-1">
                {QUICK_TIMES.map((qt) => (
                  <button
                    key={qt}
                    onClick={() => setFormWhen(qt)}
                    className={cn(
                      "px-1.5 py-0.5 text-[9px] rounded border transition-colors",
                      formWhen === qt
                        ? "border-[var(--neon-cyan)] text-[var(--neon-cyan)] bg-[rgba(0,240,255,0.08)]"
                        : "border-[var(--border)] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {qt}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="or: 2026-03-28 14:00"
                value={QUICK_TIMES.includes(formWhen) ? "" : formWhen}
                onChange={(e) => setFormWhen(e.target.value)}
                className="input-terminal text-[10px] w-36"
              />
            </div>
            <div className="flex gap-3 items-center">
              <span className="text-[9px] text-muted-foreground uppercase">Mode:</span>
              {(["once", "twice", "until_confirmed"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFormMode(m)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded border transition-colors",
                    formMode === m
                      ? "border-[var(--neon-cyan)] text-[var(--neon-cyan)]"
                      : "border-[var(--border)] text-muted-foreground"
                  )}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
              <button onClick={handleCreate} className="btn-primary text-[10px] px-3 py-0.5 ml-auto">
                Create
              </button>
            </div>
          </div>
        )}

        {/* Reminder List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Bell} message="No reminders" sub={tab !== "all" ? "Try another tab" : ""} />
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filtered.map((r) => {
                const badge = STATUS_BADGE[r.status] || STATUS_BADGE.pending;
                return (
                  <div key={r.id} className="px-3 py-2 hover:bg-[rgba(0,240,255,0.02)] transition-colors">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-muted-foreground">#{r.id}</span>
                          <span className={cn("text-[9px] font-bold uppercase", badge.cls)}>{badge.label}</span>
                          <span className="text-[9px] text-muted-foreground">{MODE_LABELS[r.repeat_mode] || r.repeat_mode}</span>
                          {r.times_fired > 0 && (
                            <span className="text-[9px] text-muted-foreground">fired {r.times_fired}x</span>
                          )}
                        </div>
                        <div className="text-[11px] text-foreground mt-0.5">{r.text}</div>
                        <div className="flex items-center gap-3 mt-0.5 text-[9px] text-muted-foreground">
                          {r.status === "pending" && <span><Clock className="h-2.5 w-2.5 inline mr-0.5" />Fires {relativeTime(r.due_at)}</span>}
                          {r.status === "active" && <span><Clock className="h-2.5 w-2.5 inline mr-0.5" />Next {relativeTime(r.due_at)}</span>}
                          {r.last_fired_at && <span>Last fired {relativeTime(r.last_fired_at)}</span>}
                          <span>via {r.source}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.status === "active" && r.repeat_mode === "until_confirmed" && (
                          <button
                            onClick={() => handleAction(r.id, "complete")}
                            className="p-1 text-[var(--neon-green)] hover:bg-[rgba(0,255,136,0.1)] rounded"
                            title="Complete"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(r.status === "pending" || r.status === "active") && (
                          <button
                            onClick={() => handleAction(r.id, "cancel")}
                            className="p-1 text-muted-foreground hover:text-[var(--neon-red)] hover:bg-[rgba(255,51,102,0.1)] rounded"
                            title="Cancel"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {r.times_fired === 0 && r.status === "pending" && (
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="p-1 text-muted-foreground hover:text-[var(--neon-red)] hover:bg-[rgba(255,51,102,0.1)] rounded"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
