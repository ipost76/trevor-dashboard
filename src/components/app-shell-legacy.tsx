"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { LegacyHeader } from "@/components/header-legacy";
import { StatusBar } from "@/components/status-bar";
import PriceStrip from "@/components/PriceStrip";

/**
 * Pre-redesign chrome — preserved verbatim from src/components/app-shell.tsx
 * (the 38-line file shipped before B1). Used when HUB_REDESIGN_NAV is off
 * so a single SQL flip rolls the Hub back to its prior state in seconds.
 *
 * Removed in I1 once Wave B–H zones have all migrated and the legacy
 * sidebar.tsx is no longer referenced.
 */
export function LegacyAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="relative z-10 flex h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden text-foreground bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden w-full">
        <LegacyHeader />
        <PriceStrip />
        <main className="flex flex-1 overflow-hidden pb-20 md:pb-0 w-full max-w-full">
          {children}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
