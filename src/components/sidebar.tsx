"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Activity, ArrowLeftRight, Terminal, Briefcase,
  ChevronLeft, ChevronRight, Shield, BookOpen,
  Search, MessageSquare, Brain, MoreHorizontal
} from "lucide-react";
import { useState, useCallback } from "react";

type NavItem = { label: string; icon: React.ComponentType<{ className?: string }>; href: string; group?: string };

const navItems: NavItem[] = [
  { group: "COMMAND", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Signals", icon: Activity, href: "/signals" },
  { label: "Trades", icon: ArrowLeftRight, href: "/trades" },
  { label: "Portfolio", icon: Briefcase, href: "/portfolio" },
  { group: "INTEL", label: "Research", icon: Search, href: "/research" },
  { label: "Chat", icon: MessageSquare, href: "/chat" },
  { group: "SYSTEM", label: "Brain", icon: Brain, href: "/brain" },
  { label: "Training", icon: BookOpen, href: "/training" },
  { label: "Logs", icon: Terminal, href: "/logs" },
  { label: "Security", icon: Shield, href: "/security" },
];

// Mobile bottom tab items (max 5)
const mobileItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Signals", icon: Activity, href: "/signals" },
  { label: "Trades", icon: ArrowLeftRight, href: "/trades" },
  { label: "Chat", icon: MessageSquare, href: "/chat" },
];

const moreItems = navItems.filter(i => !mobileItems.find(m => m.href === i.href));

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = useCallback((href: string) => {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  }, [pathname]);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex h-full flex-col border-r transition-[width] duration-200",
        "bg-[var(--sidebar)] border-[var(--sidebar-border)]",
        collapsed ? "w-14" : "w-52"
      )}>
        <div className={cn(
          "flex items-center shrink-0 border-b border-[var(--sidebar-border)]",
          collapsed ? "justify-center px-2 py-3" : "gap-2.5 px-3 py-3"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[rgba(0,255,136,0.08)] border border-[rgba(0,255,136,0.25)]">
            <span className="text-sm font-bold neon-text" style={{ fontFamily: "var(--font-display)" }}>T</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-[0.15em] neon-text" style={{ fontFamily: "var(--font-display)" }}>TREVOR</div>
              <div className="text-[9px] tracking-[0.1em] text-muted-foreground uppercase">Mission Control</div>
            </div>
          )}
        </div>

        <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2", collapsed ? "px-1.5" : "px-2")}>
          {navItems.map((item, i) => {
            const active = isActive(item.href);
            const prevGroup = navItems[i - 1]?.group;
            const showGroup = item.group && item.group !== prevGroup;
            const Icon = item.icon;
            return (
              <div key={item.href}>
                {showGroup && !collapsed && (
                  <div className="mb-1 mt-3 first:mt-0 px-2 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground opacity-50" style={{ fontFamily: "var(--font-display)" }}>
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
                    active
                      ? "bg-[rgba(0,255,136,0.06)] text-[var(--neon-green)] border-l-[3px] border-[var(--neon-green)] border-t-0 border-b-0 border-r-0"
                      : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground border-l-[3px] border-transparent border-t-0 border-b-0 border-r-0"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "drop-shadow-[0_0_4px_rgba(0,255,136,0.4)]")} />
                  {!collapsed && <span className="flex-1 truncate tracking-wide">{item.label}</span>}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className={cn("border-t border-[var(--sidebar-border)]", collapsed ? "px-1.5 py-2" : "px-2 py-2")}>
          <div className={cn("flex items-center gap-1.5 mb-2", collapsed ? "justify-center" : "px-2")}>
            <div className="h-1.5 w-1.5 rounded-full bg-[var(--neon-green)] pulse-live" />
            {!collapsed && <span className="text-[9px] text-muted-foreground">v3.1</span>}
          </div>
          <button
            onClick={() => setCollapsed(p => !p)}
            className={cn(
              "flex w-full items-center rounded py-1.5 text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground",
              collapsed ? "justify-center px-0" : "gap-2 px-2"
            )}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <><ChevronLeft className="h-3.5 w-3.5" /><span className="text-[10px] tracking-wide">Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--sidebar)] border-t border-[var(--sidebar-border)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-around h-14">
          {mobileItems.map(item => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1 px-3 min-w-[56px] min-h-[44px]",
                  active ? "text-[var(--neon-green)]" : "text-[var(--muted-foreground)]"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[9px] font-medium">{item.label}</span>
              </Link>
            );
          })}
          {/* More menu */}
          <div className="relative">
            <button
              onClick={() => setMoreOpen(p => !p)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-1 px-3 min-w-[56px] min-h-[44px]",
                moreOpen || moreItems.some(i => isActive(i.href)) ? "text-[var(--neon-green)]" : "text-[var(--muted-foreground)]"
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[9px] font-medium">More</span>
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div className="absolute bottom-16 right-0 z-50 bg-[var(--card)] border border-[var(--border)] rounded shadow-lg min-w-[160px]">
                  {moreItems.map(item => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 text-[11px] min-h-[44px]",
                          active ? "text-[var(--neon-green)] bg-[rgba(0,255,136,0.06)]" : "text-muted-foreground hover:bg-[var(--muted)]"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
