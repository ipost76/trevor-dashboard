"use client";
import * as React from "react";
import { LogOut, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter, usePathname } from "next/navigation";
import { LivePulse, KillswitchPill, Pill } from "@/components/ui";
import PriceStrip from "@/components/PriceStrip";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { cn } from "@/lib/utils";

interface StatusData {
  ok: boolean;
  trevor: { running: boolean; pid: number };
  xp: number;
  rank: string;
}

/**
 * Post-redesign topbar (B2). NO STOP button anywhere — Discord !killswitch
 * is the single project-wide pause per Rule 32.
 *
 * Composes: LivePulse (cyan/red — derived from /api/status trevor.running) +
 * clock + PriceStrip (row 1 desktop / row 2 mobile) + KillswitchPill (visible
 * only when on) + XP badge + theme toggle (next-themes) + logout.
 *
 * Mobile: collapses on scroll-down, restores on scroll-up.
 * Desktop: always visible.
 *
 * /chat route renders a minimal back-button + title variant.
 */
export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [status, setStatus] = React.useState<StatusData | null>(null);
  const [now, setNow] = React.useState<string>("");
  const scrollDir = useScrollDirection();

  // Single status poll — replaces /api/system-health + /api/admin/current-state
  // per Phase 0 audit (those endpoints don't return the shape the prompt assumed;
  // /api/status has the right shape and is the existing well-tested choice).
  React.useEffect(() => {
    let alive = true;
    const tickStatus = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as StatusData;
          if (alive) setStatus(data);
        }
      } catch {
        // graceful: keep last known state
      }
    };
    tickStatus();
    const id = setInterval(tickStatus, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Clock — 1s tick, HH:MM:SS
  React.useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setNow(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // LivePulse tone: red when bot offline, cyan otherwise
  // (drops amber DEGRADED tier per Phase 0 audit deviation #2 —
  // /api/status doesn't expose a separate scanner_ok signal)
  const liveTone: "cyan" | "red" =
    status?.trevor.running === false ? "red" : "cyan";
  const liveLabel = liveTone === "red" ? "OFFLINE" : "LIVE";

  // /chat minimal variant detection
  const isChat = pathname === "/chat";

  // Hide on scroll-down, show on scroll-up (mobile only; desktop always visible)
  const hidden = scrollDir === "down";

  const handleLogout = async () => {
    try {
      // POST body — /api/auth route reads body.action, not URL query
      // (verified Phase 0 audit deviation #3)
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      // graceful: still navigate to /login
    }
    router.push("/login");
  };

  const toggleTheme = () =>
    setTheme(resolvedTheme === "dark" ? "light" : "dark");

  // Per-zone variant: /chat renders minimal topbar
  if (isChat) {
    return (
      <header className="safe-pt sticky top-0 z-30 flex items-center gap-3 border-b border-border-subtle bg-bg-sidebar/95 px-4 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="tap-target rounded-md p-2 text-fg-muted hover:text-fg-primary"
        >
          ←
        </button>
        <span className="text-h3 tracking-wide">TREVOR CHAT</span>
        <span className="ml-auto">
          <LivePulse tone={liveTone} label="" />
        </span>
      </header>
    );
  }

  return (
    <header
      className={cn(
        "safe-pt sticky top-0 z-30 flex flex-col gap-1 border-b border-border-subtle bg-bg-sidebar/95 backdrop-blur",
        "transition-transform duration-medium",
        hidden ? "-translate-y-full md:translate-y-0" : "translate-y-0"
      )}
    >
      {/* Row 1: pulse + clock + ticker (desktop) + identity controls */}
      <div className="flex items-center gap-3 px-4 py-2">
        <LivePulse tone={liveTone} label={liveLabel} />
        <span className="text-caption tabular-nums text-fg-muted">{now}</span>

        {/* Desktop ticker strip — hidden on mobile (mobile gets row 2) */}
        <div className="hidden lg:block flex-1 min-w-0">
          <PriceStrip />
        </div>

        {/* Spacer for mobile so identity controls right-align */}
        <div className="flex-1 lg:hidden" />

        {/* Killswitch pill — KillswitchPill renders nothing when killswitch is OFF */}
        <KillswitchPill />

        {/* XP badge */}
        <Pill tone="cyan" size="sm" title={status?.rank ?? "—"}>
          {(status?.xp ?? 0).toLocaleString()}⚡
        </Pill>

        {/* Theme toggle (next-themes) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="tap-target rounded-md p-2 text-fg-muted hover:text-fg-primary"
        >
          {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Logout"
          className="tap-target rounded-md p-2 text-fg-muted hover:text-accent-red"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* Row 2: mobile-only ticker strip */}
      <div className="lg:hidden border-t border-border-subtle px-4 py-1">
        <PriceStrip />
      </div>
    </header>
  );
}
