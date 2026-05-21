"use client";
import * as React from "react";
import { LogOut, Sun, Moon, KeyRound } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter, usePathname } from "next/navigation";
import { KillswitchPill } from "@/components/ui";
import PriceStrip from "@/components/PriceStrip";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { cn } from "@/lib/utils";
import { ChangePasswordModal } from "./change-password-modal";

interface StatusData {
  ok: boolean;
  trevor: { running: boolean; pid: number };
}

/**
 * Post-redesign topbar (B2). NO STOP button anywhere — Discord !killswitch
 * is the single project-wide pause per Rule 32.
 *
 * Composes: LivePulse (cyan/red — derived from /api/status trevor.running) +
 * clock + PriceStrip (row 1 desktop / row 2 mobile) + KillswitchPill (visible
 * only when on) + theme toggle (next-themes) + logout.
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
  const [showChangePassword, setShowChangePassword] = React.useState(false);
  // Mobile hide-on-scroll tuning:
  //   threshold=32 — was 8, too sensitive to iOS rubber-band + address-bar churn
  //   minScrollY=80 — header stays visible while user is near the top, so iOS
  //                   Safari's ~50px address-bar collapse can't trip the hide.
  const scrollDir = useScrollDirection(32, 80);

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

  // Status pill: red when bot offline, refined mint otherwise. B2 swapped
  // <LivePulse> → static refined dot + sans label (per Ghost B1 decision).
  // /api/status does not expose a separate DEGRADED signal — drop amber tier.
  const isOffline = status?.trevor.running === false;
  const dotCls = isOffline ? "bg-accent-red" : "bg-accent-mint";
  const liveLabel = isOffline ? "OFFLINE" : "LIVE";

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
        <span className="font-sans text-h3 font-semibold tracking-tight">TREVOR CHAT</span>
        <span className="ml-auto inline-flex items-center" aria-label={liveLabel}>
          <span className={`h-2 w-2 rounded-full ${dotCls}`} />
        </span>
      </header>
    );
  }

  return (
    <header
      className={cn(
        "safe-pt sticky top-0 z-30 flex flex-col gap-1 border-b border-border-subtle bg-bg-sidebar/95 backdrop-blur",
        // GPU-composited transform-only animation. `duration-100` (100ms,
        // Tailwind built-in) replaces the prior `duration-medium` token —
        // which silently falls back to the default 150ms because
        // Tailwind v4's `--duration-*` @theme namespace does NOT emit
        // `.duration-*` utilities (only `--transition-duration-*` does).
        // 100ms is fast enough that the body bg behind the sticky element
        // is not perceptible as a "black gap" during the hide.
        // `will-change-transform` hints the browser to put the header on
        // its own compositor layer so the transform doesn't repaint
        // underlying content each frame. `ease-out` keeps the bulk of the
        // motion at the start (gap exposed for less time).
        "transition-transform duration-100 ease-out will-change-transform",
        hidden ? "-translate-y-full md:translate-y-0" : "translate-y-0"
      )}
    >
      {/* Row 1: pulse + clock + ticker (desktop) + identity controls */}
      <div className="flex items-center gap-3 px-4 py-2">
        <span className="inline-flex items-center gap-2" aria-label={liveLabel}>
          <span className={`h-2 w-2 rounded-full ${dotCls}`} />
          <span className="font-sans text-micro font-medium uppercase tracking-wider text-fg-muted">
            {liveLabel}
          </span>
        </span>
        <span className="font-mono text-caption tabular-nums text-fg-muted">{now}</span>

        {/* Desktop ticker strip — hidden on mobile (mobile gets row 2) */}
        <div className="hidden lg:block flex-1 min-w-0">
          <PriceStrip />
        </div>

        {/* Spacer for mobile so identity controls right-align */}
        <div className="flex-1 lg:hidden" />

        {/* Killswitch pill — KillswitchPill renders nothing when killswitch is OFF */}
        <KillswitchPill />

        {/* Theme toggle (next-themes) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="tap-target rounded-md p-2 text-fg-muted hover:text-fg-primary"
        >
          {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Change password + Logout (visually grouped) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowChangePassword(true)}
            aria-label="Change password"
            title="Change password"
            className="tap-target rounded-md p-2 text-fg-muted hover:text-fg-primary"
          >
            <KeyRound size={14} />
          </button>

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Logout"
            className="tap-target rounded-md p-2 text-fg-muted hover:text-accent-red"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Row 2: mobile-only ticker strip */}
      <div className="lg:hidden border-t border-border-subtle px-4 py-1">
        <PriceStrip />
      </div>

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </header>
  );
}
