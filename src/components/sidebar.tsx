"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, Brain, Settings, MessageSquare,
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef, Suspense } from "react";

// ── Zone definitions ────────────────────────────────────────────────────────

type NavChild = { label: string; href: string; tabKey: string };
type NavZone = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  children: NavChild[];
};

const NAV_ZONES: NavZone[] = [
  {
    id: "dashboard",
    label: "DASHBOARD",
    icon: LayoutDashboard,
    href: "/dashboard",
    children: [],
  },
  {
    id: "trading",
    label: "TRADING",
    icon: TrendingUp,
    href: "/trading",
    children: [
      { label: "Trades", href: "/trading?tab=trades", tabKey: "trades" },
      { label: "Holdings", href: "/trading?tab=holdings", tabKey: "holdings" },
      { label: "AutoTrader", href: "/trading?tab=autotrader", tabKey: "autotrader" },
    ],
  },
  {
    id: "intelligence",
    label: "INTELLIGENCE",
    icon: Brain,
    href: "/intelligence",
    children: [
      { label: "Signals", href: "/intelligence?tab=signals", tabKey: "signals" },
      { label: "Research", href: "/intelligence?tab=research", tabKey: "research" },
      { label: "Training", href: "/intelligence?tab=training", tabKey: "training" },
    ],
  },
  {
    id: "command",
    label: "COMMAND",
    icon: Settings,
    href: "/command",
    children: [
      { label: "Control Panel", href: "/command?tab=control", tabKey: "control" },
      { label: "Ghost HQ", href: "/command?tab=ghosthq", tabKey: "ghosthq" },
      { label: "Reminders", href: "/command?tab=reminders", tabKey: "reminders" },
      { label: "Dev Tasks", href: "/command?tab=devtasks", tabKey: "devtasks" },
    ],
  },
  {
    id: "chat",
    label: "CHAT",
    icon: MessageSquare,
    href: "/chat",
    children: [],
  },
];

// Old route → zone mapping (for highlighting correct zone on legacy routes)
const LEGACY_ROUTE_MAP: Record<string, string> = {
  "/trades": "trading",
  "/holdings": "trading",
  "/autotrader": "trading",
  "/signals": "intelligence",
  "/research": "intelligence",
  "/training": "intelligence",
  "/control": "command",
  "/ghost": "command",
  "/reminders": "command",
  "/dev-tasks": "command",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getActiveZoneId(pathname: string): string | null {
  for (const zone of NAV_ZONES) {
    if (pathname === zone.href) return zone.id;
    if (zone.id !== "dashboard" && pathname.startsWith(zone.href)) return zone.id;
  }
  // Check legacy routes
  for (const [route, zoneId] of Object.entries(LEGACY_ROUTE_MAP)) {
    if (pathname === route || pathname.startsWith(route + "/")) return zoneId;
  }
  if (pathname === "/" || pathname === "/dashboard") return "dashboard";
  return null;
}

// ── Long-press hook ───────────────────────────────────────────────────────

const LONG_PRESS_MS = 400;

function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const hasMoved = useRef(false);

  const start = useCallback(() => {
    isLongPressRef.current = false;
    hasMoved.current = false;
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(10);
      }
      onLongPress();
    }, LONG_PRESS_MS);
  }, [onLongPress]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const move = useCallback(() => {
    hasMoved.current = true;
    stop();
  }, [stop]);

  return {
    onTouchStart: start,
    onTouchEnd: stop,
    onTouchMove: move,
    isLongPress: isLongPressRef,
  };
}

// ── Inner sidebar content (needs useSearchParams inside Suspense) ─────────

function SidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab");
  const [collapsed, setCollapsed] = useState(false);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [signalBadge, setSignalBadge] = useState(0);
  const [quickJump, setQuickJump] = useState<{ zoneId: string; x: number } | null>(null);

  const activeZoneId = getActiveZoneId(pathname);

  // Auto-expand active zone on navigation
  useEffect(() => {
    if (activeZoneId) {
      const zone = NAV_ZONES.find(z => z.id === activeZoneId);
      if (zone && zone.children.length > 0) {
        setExpandedZone(activeZoneId);
      }
    }
  }, [activeZoneId]);

  // Poll for unread signal count
  useEffect(() => {
    const fetchBadge = async () => {
      try {
        const res = await fetch("/api/signals/unread-count");
        const d = await res.json();
        setSignalBadge(d.count || 0);
      } catch { /* ignore */ }
    };
    fetchBadge();
    const iv = setInterval(fetchBadge, 60000);
    return () => clearInterval(iv);
  }, []);

  // Clear badge on signal/trade pages
  useEffect(() => {
    if (pathname === "/signals" || pathname === "/trades" || pathname === "/intelligence") {
      setSignalBadge(0);
    }
  }, [pathname]);

  // Close quick-jump on outside tap
  useEffect(() => {
    if (!quickJump) return;
    const handler = () => setQuickJump(null);
    document.addEventListener("touchstart", handler);
    return () => document.removeEventListener("touchstart", handler);
  }, [quickJump]);

  // ── Desktop sidebar ──────────────────────────────────────────────────────

  const DesktopSidebar = () => (
    <aside className={cn(
      "hidden md:flex h-full flex-col md:border-r md:transition-[width] md:duration-200",
      "bg-[var(--sidebar)] border-[var(--sidebar-border)]",
      "w-0",
      collapsed ? "md:w-14" : "md:w-52"
    )}>
      {/* Logo */}
      <div className={cn(
        "flex items-center shrink-0 border-b border-[var(--sidebar-border)]",
        collapsed ? "justify-center px-2 py-3" : "gap-2.5 px-3 py-3"
      )}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[rgba(0,240,255,0.1)] border border-[rgba(0,240,255,0.3)]">
          <span className="text-sm font-bold neon-text">T</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.15em] neon-text">TREVOR</div>
            <div className="text-[9px] tracking-[0.1em] text-muted-foreground uppercase">Mission Control</div>
          </div>
        )}
      </div>

      {/* Nav zones */}
      <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2", collapsed ? "px-1.5" : "px-2")}>
        {NAV_ZONES.map((zone) => {
          const isActive = activeZoneId === zone.id;
          const isExpanded = expandedZone === zone.id;
          const hasChildren = zone.children.length > 0;
          const Icon = zone.icon;

          return (
            <div key={zone.id}>
              {/* Zone header */}
              <div className="flex items-center gap-0.5">
                <Link
                  href={zone.href}
                  title={collapsed ? zone.label : undefined}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded py-2 text-[13px] font-semibold uppercase tracking-[0.05em] transition-all duration-150",
                    collapsed ? "justify-center px-2" : "px-3",
                    isActive
                      ? "bg-[rgba(0,255,136,0.08)] text-[#00ff88] font-bold border border-[rgba(0,255,136,0.15)]"
                      : "text-[#7ab88a] hover:bg-[rgba(0,240,255,0.06)] hover:text-[#c8ffe0] border border-transparent"
                  )}
                >
                  <span className="relative">
                    <Icon className={cn("h-4 w-4 shrink-0", isActive && "drop-shadow-[0_0_6px_rgba(0,255,136,0.5)]")} />
                    {signalBadge > 0 && zone.id === "intelligence" && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-[#ff4444] text-white text-[9px] font-bold leading-none border-2 border-[var(--sidebar)]">
                        {signalBadge}
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="flex-1 truncate">{zone.label}</span>}
                </Link>
                {/* Chevron toggle for zones with children */}
                {hasChildren && !collapsed && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setExpandedZone(prev => prev === zone.id ? null : zone.id);
                    }}
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded transition-colors",
                      "text-[#3d6b4a] hover:text-[#7ab88a] hover:bg-[rgba(0,255,136,0.06)]"
                    )}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRightSmall className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {/* Children (collapsible) */}
              {hasChildren && !collapsed && (
                <div
                  className="overflow-hidden transition-all duration-200 ease-in-out"
                  style={{
                    maxHeight: isExpanded ? `${zone.children.length * 36}px` : "0px",
                    opacity: isExpanded ? 1 : 0,
                  }}
                >
                  {zone.children.map((child) => {
                    const isChildActive = pathname === zone.href && activeTab === child.tabKey;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center pl-11 pr-3 py-1.5 text-[12px] rounded transition-all duration-150",
                          isChildActive
                            ? "text-[#00ff88] bg-[rgba(0,255,136,0.05)]"
                            : "text-[#3d6b4a] hover:text-[#7ab88a] hover:bg-[rgba(0,255,136,0.04)]"
                        )}
                      >
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className={cn("border-t border-[var(--sidebar-border)]", collapsed ? "px-1.5 py-2" : "px-2 py-2")}>
        <button
          onClick={() => setCollapsed(p => !p)}
          className={cn(
            "flex w-full items-center rounded py-1.5 text-muted-foreground transition-colors hover:bg-[rgba(0,240,255,0.04)] hover:text-foreground",
            collapsed ? "justify-center px-0" : "gap-2 px-2"
          )}
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <><ChevronLeft className="h-3.5 w-3.5" /><span className="text-[10px] tracking-wide">Collapse</span></>}
        </button>
      </div>
    </aside>
  );

  // ── Mobile bottom tab bar ────────────────────────────────────────────────

  const MobileTabBar = () => {
    const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

    const handleLongPress = useCallback((zone: NavZone, index: number) => {
      if (zone.children.length === 0) return;
      const el = itemRefs.current[index];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      setQuickJump({ zoneId: zone.id, x: centerX });
    }, []);

    return (
      <>
        {/* Quick-jump popup */}
        {quickJump && (() => {
          const zone = NAV_ZONES.find(z => z.id === quickJump.zoneId);
          if (!zone || zone.children.length === 0) return null;
          // Clamp popup position within viewport
          const popupWidth = 180;
          const clampedX = Math.max(popupWidth / 2 + 8, Math.min(quickJump.x, window.innerWidth - popupWidth / 2 - 8));
          return (
            <div
              className="fixed z-[60] md:hidden"
              style={{
                bottom: 72,
                left: clampedX,
                transform: "translateX(-50%)",
                animation: "quickJumpIn 0.15s ease-out",
              }}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  background: "var(--card, #0e1510)",
                  border: "1px solid rgba(0,255,136,0.18)",
                  borderRadius: 8,
                  padding: "6px 0",
                  minWidth: 160,
                  boxShadow: "0 -4px 20px rgba(0,0,0,0.5), 0 0 12px rgba(0,255,136,0.08)",
                }}
              >
                {zone.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={() => setQuickJump(null)}
                    className="flex items-center px-4 py-2.5 text-[13px] transition-colors"
                    style={{
                      color: "#7ab88a",
                      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    }}
                    onMouseOver={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.08)";
                      (e.currentTarget as HTMLElement).style.color = "#00ff88";
                    }}
                    onMouseOut={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "#7ab88a";
                    }}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
              {/* Triangle arrow */}
              <div style={{
                position: "absolute",
                bottom: -6,
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: "6px solid var(--card, #0e1510)",
              }} />
            </div>
          );
        })()}

        {/* Bottom tab bar */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around md:hidden"
          style={{
            height: 64,
            background: "var(--sidebar, #0b110c)",
            borderTop: "1px solid rgba(0,255,136,0.18)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {NAV_ZONES.map((zone, index) => {
            const isActive = activeZoneId === zone.id;
            const Icon = zone.icon;
            const hasChildren = zone.children.length > 0;

            const longPress = useLongPress(
              // eslint-disable-next-line react-hooks/rules-of-hooks
              useCallback(() => handleLongPress(zone, index), [zone, index])
            );

            return (
              <Link
                key={zone.id}
                ref={(el) => { itemRefs.current[index] = el; }}
                href={zone.href}
                onClick={(e) => {
                  if (longPress.isLongPress.current) {
                    e.preventDefault();
                    return;
                  }
                  setQuickJump(null);
                }}
                {...(hasChildren ? {
                  onTouchStart: longPress.onTouchStart,
                  onTouchEnd: longPress.onTouchEnd,
                  onTouchMove: longPress.onTouchMove,
                } : {})}
                className="flex flex-col items-center justify-center relative"
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  padding: "6px 12px",
                  textDecoration: "none",
                  WebkitTapHighlightColor: "transparent",
                  color: isActive ? "#00ff88" : "#3d6b4a",
                }}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: "25%",
                    right: "25%",
                    height: 2,
                    background: "#00ff88",
                    borderRadius: "0 0 2px 2px",
                  }} />
                )}
                <span className="relative">
                  <Icon className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_6px_rgba(0,255,136,0.6)]")} />
                  {signalBadge > 0 && zone.id === "intelligence" && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-[#ff4444] text-white text-[9px] font-bold leading-none border-2 border-[var(--sidebar)]">
                      {signalBadge}
                    </span>
                  )}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  lineHeight: 1,
                  marginTop: 2,
                }}>
                  {zone.id === "intelligence" ? "INTEL" : zone.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </>
    );
  };

  return (
    <>
      <DesktopSidebar />
      <MobileTabBar />
    </>
  );
}

// ── Exported Sidebar (wrapped in Suspense for useSearchParams) ─────────────

export function Sidebar() {
  return (
    <Suspense fallback={null}>
      <SidebarInner />
    </Suspense>
  );
}
