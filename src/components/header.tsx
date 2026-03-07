"use client";
import { useEffect, useState } from "react";
import { WifiOff, KeyRound, LogOut, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { usePolling } from "@/lib/use-polling";
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

  usePolling(() => {
    safeFetch<StatusData | null>("/api/status", null).then(setStatus);
  }, 30000);

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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 md:hidden">
            <span className="text-[11px] font-bold tracking-[0.15em] neon-text" style={{ fontFamily: "var(--font-display)" }}>TREVOR</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status?.trevor.running ? (
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-[var(--neon-green)] pulse-live" />
              </div>
            ) : (
              <WifiOff className="h-3 w-3 text-[var(--neon-red)]" />
            )}
            <span className={cn(
              "text-[10px] font-bold tracking-[0.1em] uppercase hidden sm:inline",
              status?.trevor.running ? "neon-green" : "neon-red"
            )}>
              {status ? (status.trevor.running ? "LIVE" : "OFFLINE") : "..."}
            </span>
          </div>
          {status?.trevor.running && (
            <span className="text-[9px] text-muted-foreground font-mono hidden md:inline">PID {status.trevor.pid}</span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">{time}</span>
        </div>

        <div className="flex items-center gap-3">
          {status && (
            <div className="flex items-center gap-1.5 rounded bg-[rgba(0,255,136,0.05)] border border-[rgba(0,255,136,0.15)] px-2 py-0.5">
              <Zap className="h-2.5 w-2.5 text-[var(--neon-green)]" />
              <span className="text-[10px] font-bold text-[var(--neon-green)]">{status.xp} XP</span>
              <span className="text-[9px] text-muted-foreground hidden sm:inline">{status.rank}</span>
            </div>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground transition-colors"
            title="Change password"
          >
            <KeyRound className="h-3 w-3" />
          </button>
          <button
            onClick={handleLogout}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[rgba(255,71,87,0.1)] hover:text-[var(--neon-red)] transition-colors"
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
