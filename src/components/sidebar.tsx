"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ArrowLeftRight, Terminal,
  Menu, X, ChevronLeft, ChevronRight, Shield, BookOpen,
  Search, MessageSquare, Activity, Briefcase, Settings,
} from "lucide-react";
import { useState, useCallback } from "react";

type NavItem = { label: string; icon: React.ComponentType<{ className?: string }>; href: string; group?: string };

const navItems: NavItem[] = [
  { group: "COMMAND", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Holdings", icon: Briefcase, href: "/holdings" },
  { label: "Trades", icon: ArrowLeftRight, href: "/trades" },
  { group: "INTEL", label: "Signals", icon: Activity, href: "/signals" },
  { label: "Research", icon: Search, href: "/research" },
  { label: "Chat", icon: MessageSquare, href: "/chat" },
  { group: "SYSTEM", label: "Control Panel", icon: Settings, href: "/control" },
  { label: "Training", icon: BookOpen, href: "/training" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const SidebarContent = () => (
    <aside className={cn(
      "flex h-full flex-col border-r transition-[width] duration-200",
      "bg-[var(--sidebar)] border-[var(--sidebar-border)]",
      collapsed ? "w-14" : "w-52"
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
                onClick={closeMobile}
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

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded glass-strong md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={closeMobile} />}
      <div className={cn(
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl max-md:transition-transform max-md:duration-200",
        mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        "md:relative md:flex md:flex-col"
      )}>
        {mobileOpen && (
          <button onClick={closeMobile} className="absolute right-2 top-2 z-10 rounded p-1.5 text-muted-foreground hover:text-foreground md:hidden">
            <X className="h-4 w-4" />
          </button>
        )}
        <SidebarContent />
      </div>
    </>
  );
}
