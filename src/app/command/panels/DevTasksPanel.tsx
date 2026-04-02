"use client";
import { useEffect, useState, useCallback } from "react";
import { ClipboardList, CheckCircle, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type DevTask = {
  id: number;
  title: string;
  notes: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type Counts = { total: number; open: number; wip: number; done: number };

const CATEGORIES = ["all", "fix", "prompt", "update", "note", "bug"] as const;
const PRIORITIES = ["all", "high", "med", "low"] as const;
const STATUSES = ["open", "in-progress", "done"] as const;

const CAT_COLORS: Record<string, string> = {
  fix: "bg-red-500/20 text-red-400",
  prompt: "bg-purple-500/20 text-purple-400",
  update: "bg-blue-500/20 text-blue-400",
  note: "bg-[rgba(0,240,255,0.08)] text-muted-foreground",
  bug: "bg-orange-500/20 text-orange-400",
};

const PRIO_DOTS: Record<string, string> = {
  high: "bg-red-500",
  med: "bg-yellow-500",
  low: "bg-green-500",
};

export default function DevTasksPanel() {
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, open: 0, wip: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("all");
  const [prioFilter, setPrioFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const fetchTasks = useCallback(async () => {
    const status = statusFilter === "all" ? "" : statusFilter;
    const category = catFilter === "all" ? "" : catFilter;
    const priority = prioFilter === "all" ? "" : prioFilter;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (priority) params.set("priority", priority);
    const data = await safeFetch<{ tasks: DevTask[]; counts: Counts }>(
      `/api/dev-tasks?${params}`,
      { tasks: [], counts: { total: 0, open: 0, wip: 0, done: 0 } }
    );
    setTasks(data.tasks);
    setCounts(data.counts);
    setLoading(false);
  }, [statusFilter, catFilter, prioFilter]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  const toggleTask = async (task: DevTask) => {
    const newStatus = task.status === "done" ? "open" : "done";
    setToggling(task.id);
    try {
      await fetch("/api/dev-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: newStatus }),
      });
      await fetchTasks();
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto p-2 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Dev Tasks</h1>
        <span className="ml-2 rounded-full bg-[var(--card)] px-2.5 py-0.5 text-xs font-medium text-foreground">
          {counts.open} open
        </span>
        {counts.wip > 0 && (
          <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
            {counts.wip} WIP
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition",
                statusFilter === s
                  ? "bg-[rgba(0,240,255,0.15)] text-[var(--neon-cyan)]"
                  : "bg-[var(--card)] text-muted-foreground hover:bg-[rgba(0,240,255,0.06)]"
              )}
            >
              {s === "in-progress" ? "WIP" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition",
                catFilter === c
                  ? "bg-[rgba(0,240,255,0.15)] text-[var(--neon-cyan)]"
                  : "bg-[var(--card)] text-muted-foreground hover:bg-[rgba(0,240,255,0.06)]"
              )}
            >
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => setPrioFilter(p)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition",
                prioFilter === p
                  ? "bg-[rgba(0,240,255,0.15)] text-[var(--neon-cyan)]"
                  : "bg-[var(--card)] text-muted-foreground hover:bg-[rgba(0,240,255,0.06)]"
              )}
            >
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No tasks found.</div>
      ) : (
        <div className="space-y-1">
          {tasks.map((task) => {
            const isDone = task.status === "done";
            const isExpanded = expanded === task.id;
            return (
              <div key={task.id} className="group">
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition cursor-pointer",
                    "hover:bg-[rgba(0,240,255,0.04)]",
                    isDone && "opacity-50"
                  )}
                  onClick={() => setExpanded(isExpanded ? null : task.id)}
                >
                  {/* Checkbox */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTask(task);
                    }}
                    className="flex-shrink-0"
                    disabled={toggling === task.id}
                  >
                    {toggling === task.id ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : isDone ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground group-hover:text-muted-foreground" />
                    )}
                  </button>

                  {/* ID */}
                  <span className="text-xs text-muted-foreground font-mono w-8">#{task.id}</span>

                  {/* Category badge */}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                      CAT_COLORS[task.category] || CAT_COLORS.note
                    )}
                  >
                    {task.category}
                  </span>

                  {/* Title */}
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      isDone ? "line-through text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {task.title}
                  </span>

                  {/* Priority dot */}
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full flex-shrink-0",
                      PRIO_DOTS[task.priority] || PRIO_DOTS.med
                    )}
                  />

                  {/* Date */}
                  <span className="text-[11px] text-muted-foreground w-20 text-right">
                    {task.created_at ? task.created_at.slice(0, 10) : ""}
                  </span>
                </div>

                {/* Expanded notes */}
                {isExpanded && task.notes && (
                  <div className="ml-16 px-3 pb-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {task.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
