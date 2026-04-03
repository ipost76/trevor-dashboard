"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

type Reminder = {
  id: number;
  text: string;
  due_at: string;
  repeat_mode: string;
  status: string;
};

const C = {
  surface: "var(--card)",
  borderSolid: "#1e2a3a",
  accent: "#00ff88",
  accentDim: "rgba(0,255,136,0.12)",
  red: "#ff3b5c",
  yellow: "#ffb800",
  textPrimary: "#e8edf4",
  textSecondary: "#7a8a9e",
  textTertiary: "#4a5568",
};

function formatReminderTime(dueAt: string): { text: string; urgency: "overdue" | "soon" | "normal" } {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMs < 0) return { text: "OVERDUE", urgency: "overdue" };
  if (diffMin < 60) return { text: `in ${diffMin}m`, urgency: "soon" };

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const mins = diffMin % 60;
    return { text: `in ${diffHr}h ${mins}m`, urgency: "normal" };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) {
    return { text: "Tomorrow", urgency: "normal" };
  }

  if (diffHr < 168) {
    return {
      text: due.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }),
      urgency: "normal",
    };
  }

  return {
    text: due.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }),
    urgency: "normal",
  };
}

export default function RemindersWidget() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchReminders = async () => {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      const items = (data.reminders || [])
        .filter((r: Reminder) => r.due_at)
        .sort((a: Reminder, b: Reminder) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
        .slice(0, 3);
      setReminders(items);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchReminders();
    const iv = setInterval(fetchReminders, 60000);
    return () => clearInterval(iv);
  }, []);

  const addReminder = async (offsetMs: number) => {
    if (!newText.trim()) return;
    setAdding(true);
    try {
      const dueAt = new Date(Date.now() + offsetMs).toISOString();
      await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText.trim(), due_at: dueAt, repeat_mode: "once" }),
      });
      setNewText("");
      setShowAdd(false);
      await fetchReminders();
    } catch { /* ignore */ }
    setAdding(false);
  };

  const urgencyColor = (u: string) =>
    u === "overdue" ? C.red : u === "soon" ? C.yellow : C.textTertiary;

  return (
    <Link href="/command?tab=reminders" style={{ textDecoration: "none", color: "inherit", animation: "slideUp 0.7s ease" }}>
      <div style={{
        background: C.surface,
        border: `1px solid ${C.borderSolid}`,
        borderRadius: 10,
        padding: "14px 16px",
        cursor: "pointer",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Bell size={12} color={C.textSecondary} style={{ opacity: 0.7 }} />
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: C.textSecondary,
            }}>
              REMINDERS
            </span>
            {reminders.length > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, background: C.accentDim, color: C.accent,
                borderRadius: 4, padding: "1px 5px",
              }}>
                {reminders.length}
              </span>
            )}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAdd(!showAdd); }}
              style={{
                background: "transparent", border: `1px solid ${C.accentDim}`, borderRadius: 4,
                width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                color: C.accent, fontSize: 14, cursor: "pointer", lineHeight: 1,
              }}
            >+</button>
          </div>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: C.accent,
          }}>
            View All →
          </span>
        </div>

        {/* Quick-add form */}
        {showAdd && (
          <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} style={{ marginBottom: 8, padding: "8px 0", borderBottom: `1px solid ${C.borderSolid}` }}>
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="New reminder..."
              onKeyDown={(e) => { if (e.key === "Enter" && newText.trim()) addReminder(3600000); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              style={{
                width: "100%", background: "transparent", border: `1px solid ${C.borderSolid}`, borderRadius: 4,
                padding: "6px 8px", fontSize: 11, color: C.textPrimary, fontFamily: "var(--font-mono)",
                outline: "none", marginBottom: 6,
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[
                { label: "In 1h", ms: 3600000 },
                { label: "In 3h", ms: 10800000 },
                { label: "Tomorrow", ms: 57600000 },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); addReminder(opt.ms); }}
                  disabled={adding || !newText.trim()}
                  style={{
                    padding: "3px 8px", borderRadius: 3, fontSize: 9, fontWeight: 600,
                    fontFamily: "var(--font-mono)", cursor: "pointer",
                    background: C.accentDim, border: `1px solid rgba(0,255,136,0.2)`,
                    color: !newText.trim() ? C.textTertiary : C.accent,
                    opacity: adding ? 0.5 : 1,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reminder items */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "8px 0", fontSize: 11, color: C.textTertiary, fontFamily: "var(--font-mono)" }}>
            Loading...
          </div>
        ) : reminders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "8px 0", fontSize: 11, color: C.textTertiary, fontFamily: "var(--font-mono)" }}>
            No upcoming reminders. ✓
          </div>
        ) : (
          <div>
            {reminders.map((r, i) => {
              const { text: timeText, urgency } = formatReminderTime(r.due_at);
              return (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 0",
                    borderBottom: i < reminders.length - 1 ? "1px solid rgba(0,255,136,0.06)" : "none",
                  }}
                >
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: C.textPrimary,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginRight: 12,
                  }}>
                    {r.text}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: urgency === "overdue" ? 700 : 500,
                    color: urgencyColor(urgency),
                    whiteSpace: "nowrap",
                  }}>
                    {timeText}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}
