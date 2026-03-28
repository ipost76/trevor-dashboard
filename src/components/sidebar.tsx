"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ArrowLeftRight, Terminal, SquareTerminal,
  ChevronLeft, ChevronRight, Shield, BookOpen,
  Search, MessageSquare, Activity, Briefcase, Settings, ClipboardList, Zap,
  MoreHorizontal, X, Bell,
} from "lucide-react";
import { useState, useCallback, useEffect } from "react";

type NavItem = { label: string; icon: React.ComponentType<{ className?: string }>; href: string; group?: string };

const navItems: NavItem[] = [
  { group: "COMMAND", label: "Terminal", icon: SquareTerminal, href: "/terminal" },
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Holdings", icon: Briefcase, href: "/holdings" },
  { label: "Trades", icon: ArrowLeftRight, href: "/trades" },
  { group: "TRADING", label: "AutoTrader", icon: Terminal, href: "/autotrader" },
  { group: "INTEL", label: "Signals", icon: Activity, href: "/signals" },
  { label: "Research", icon: Search, href: "/research" },
  { label: "Chat", icon: MessageSquare, href: "/chat" },
  { label: "Reminders", icon: Bell, href: "/reminders" },
  { group: "GHOST", label: "Ghost HQ", icon: Zap, href: "/ghost" },
  { group: "SYSTEM", label: "Control Panel", icon: Settings, href: "/control" },
  { label: "Training", icon: BookOpen, href: "/training" },
  { label: "Dev Tasks", icon: ClipboardList, href: "/dev-tasks" },
];

// Bottom tab bar: 5 most-used pages + More
const TAB_HREFS = ["/terminal", "/trades", "/signals", "/chat", "/control"];
const TAB_ITEMS = TAB_HREFS.map(h => navItems.find(n => n.href === h)!);
const MORE_ITEMS = navItems.filter(n => !TAB_HREFS.includes(n.href));

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signalBadge, setSignalBadge] = useState(0);

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

  // Clear badge when visiting signals or trades page
  useEffect(() => {
    if (pathname === "/signals" || pathname === "/trades") {
      setSignalBadge(0);
    }
  }, [pathname]);

  const isActiveMore = MORE_ITEMS.some(
    (item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  );

  // ── Desktop sidebar (unchanged) ──
  const DesktopSidebar = () => (
    <aside className={cn(
      "hidden md:flex h-full flex-col md:border-r md:transition-[width] md:duration-200",
      "bg-[var(--sidebar)] border-[var(--sidebar-border)]",
      "w-0", // Mobile: zero width (hidden + w-0 = no flex space)
      collapsed ? "md:w-14" : "md:w-52"
    )}>
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

      <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2", collapsed ? "px-1.5" : "px-2")}>
        {navItems.map((item, i) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const prevGroup = navItems[i - 1]?.group;
          const showGroup = item.group && item.group !== prevGroup;
          const Icon = item.icon;
          return (
            <div key={item.href}>
              {showGroup && !collapsed && (
                <div className="mb-1 mt-3 first:mt-0 px-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--neon-cyan)] opacity-50">
                  {item.group}
                </div>
              )}
              {showGroup && collapsed && <div className="my-2 border-t border-[var(--sidebar-border)]" />}
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-2 rounded py-1.5 text-[11px] font-medium transition-all duration-150",
                  collapsed ? "justify-center px-2" : "px-2.5",
                  isActive
                    ? "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.15)]"
                    : "text-muted-foreground hover:bg-[rgba(0,240,255,0.04)] hover:text-foreground border border-transparent"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "drop-shadow-[0_0_4px_rgba(0,240,255,0.5)]")} />
                {!collapsed && <span className="flex-1 truncate tracking-wide">{item.label}</span>}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={cn("border-t border-[var(--sidebar-border)]", collapsed ? "px-1.5 py-2" : "px-2 py-2")}>
        <button
          onClick={() => setCollapsed(p => !p)}
          className={cn(
            "flex w-full items-center rounded py-1.5 text-muted-foreground transition-colors hover:bg-[rgba(0,240,255,0.04)] hover:text-foreground",
            collapsed ? "justify-center px-0" : "gap-2 px-2"
          )}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <><ChevronLeft className="h-3.5 w-3.5" /><span className="text-[10px] tracking-wide">Collapse</span></>}
        </button>
      </div>
    </aside>
  );

  // ── Mobile bottom tab bar ──
  const MobileTabBar = () => (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMoreOpen(false)} />
          <div className="fixed bottom-14 left-0 right-0 z-50 md:hidden">
            <div className="mx-3 mb-1 rounded-lg bg-[var(--sidebar)] border border-[var(--sidebar-border)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--sidebar-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">More</span>
                <button onClick={() => setMoreOpen(false)} className="p-1 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
              {MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 text-[12px] transition-colors",
                      isActive ? "text-[var(--neon-cyan)] bg-[rgba(0,240,255,0.06)]" : "text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-14 items-center justify-around border-t border-[var(--sidebar-border)] bg-[var(--sidebar)] md:hidden"
           style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-12 h-11 rounded-lg transition-colors",
                isActive ? "text-[var(--neon-cyan)]" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_6px_rgba(0,240,255,0.6)]")} />
                {signalBadge > 0 && (item.href === "/signals" || item.href === "/trades") && (
                  <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[#ff3366] text-white text-[8px] font-bold px-0.5">{signalBadge}</span>
                )}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((p) => !p)}
          className={cn(
            "flex flex-col items-center justify-center w-12 h-11 rounded-lg transition-colors",
            isActiveMore || moreOpen ? "text-[var(--neon-cyan)]" : "text-muted-foreground"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </nav>
    </>
  );

  return (
    <>
      <DesktopSidebar />
      <MobileTabBar />
    </>
  );
}
