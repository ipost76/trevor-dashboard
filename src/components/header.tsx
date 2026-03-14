"use client";
import { useEffect, useState } from "react";
import { Wifi, WifiOff, KeyRound, LogOut, Zap, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { ChangePasswordModal } from "@/components/change-password-modal";

type StatusData = { ok: boolean; trevor: { running: boolean; pid: number }; xp: number; rank: string };

export function Header() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    updateTime();
    const t = setInterval(updateTime, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchStatus = () => {
      safeFetch<StatusData | null>("/api/status", null).then(setStatus);
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    window.location.href = "/login";
  };

  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--panel-header)] px-3">
        {/* Left: Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {status?.trevor.running ? (
              <div className="relative">
                <Wifi className="h-3 w-3 text-[var(--neon-green)]" />
                <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--neon-green)] pulse-live" />
              </div>
            ) : (
              <WifiOff className="h-3 w-3 text-[var(--neon-red)]" />
            )}
            <span className={cn(
              "text-[10px] font-bold tracking-[0.1em] uppercase",
              status?.trevor.running ? "neon-green" : "neon-red"
            )}>
              {status ? (status.trevor.running ? "LIVE" : "OFFLINE") : "..."}
            </span>
          </div>
          {status?.trevor.running && (
            <span className="text-[9px] text-muted-foreground font-mono">PID {status.trevor.pid}</span>
          )}
          <div className="h-3 w-px bg-[var(--border)]" />
          <span className="text-[10px] text-muted-foreground font-mono">{time}</span>
        </div>

        {/* Right: XP + Controls */}
        <div className="flex items-center gap-3">
          {status && (
            <div className="flex items-center gap-1.5 rounded bg-[rgba(0,240,255,0.06)] border border-[rgba(0,240,255,0.12)] px-2 py-0.5">
              <Zap className="h-2.5 w-2.5 text-[var(--neon-cyan)]" />
              <span className="text-[10px] font-bold text-[var(--neon-cyan)]">{status.xp} XP</span>
              <span className="text-[9px] text-muted-foreground">{status.rank}</span>
            </div>
          )}
          <div className="h-3 w-px bg-[var(--border)]" />
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[rgba(0,240,255,0.06)] hover:text-foreground transition-colors"
            title="Change password"
          >
            <KeyRound className="h-3 w-3" />
          </button>
          <button
            onClick={handleLogout}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[rgba(255,51,102,0.1)] hover:text-[var(--neon-red)] transition-colors"
            title="Log out"
          >
            <LogOut className="h-3 w-3" />
          </button>
        </div>
      </header>

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </>
  );
}
