"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ZONES,
  accentTextClass,
  accentGlowClass,
  zoneFromPath,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Desktop-only collapsing sidebar.
 * Hidden below lg.
 *
 * Two states:
 *  - rail (icon-only, ~56px wide)  — default at lg
 *  - expanded (~220px wide)        — at xl
 */
export function SidebarRail() {
  const pathname = usePathname();
  const activeZone = zoneFromPath(pathname || "");

  return (
    <aside
      role="navigation"
      aria-label="Primary"
      className={cn(
        "hidden lg:flex flex-col gap-1 sticky top-0 h-screen",
        "border-r border-border-subtle bg-bg-sidebar/95 backdrop-blur",
        "w-14 xl:w-56 transition-[width] duration-medium",
        "py-4",
      )}
    >
      <div className="px-3 mb-4 hidden xl:block text-micro text-fg-faint">
        TREVOR // <span className="text-accent-cyan">v3</span>
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {ZONES.map((zone) => {
          const isActive = activeZone?.id === zone.id;
          const Icon = zone.icon;
          return (
            <li key={zone.id}>
              <Link
                href={zone.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-fast",
                  "text-fg-muted hover:bg-bg-elevated hover:text-fg-primary",
                  isActive && cn(accentTextClass(zone.accent), "bg-bg-elevated"),
                )}
                title={zone.label}
              >
                <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="hidden xl:inline text-label-ui">
                  {zone.label}
                </span>
                {isActive && (
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-current",
                      accentGlowClass(zone.accent),
                    )}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
