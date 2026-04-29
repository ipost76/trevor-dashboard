"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { SidebarRail } from "@/components/navigation/sidebar-rail";
import { ChatFAB } from "@/components/navigation/chat-fab";
import { ZoneSubTabs } from "@/components/navigation/zone-sub-tabs";
import { Header } from "@/components/header";

/**
 * Wraps page content with the new navigation chrome:
 *  - SidebarRail (desktop only)
 *  - Header (topbar — rebuilt in B2)
 *  - ZoneSubTabs (sub-tab strip; auto-hides when zone has no sub-tabs)
 *  - BottomNav (mobile only)
 *  - ChatFAB (everywhere except /chat itself)
 *
 * /login bypasses chrome entirely (mirrors LegacyAppShell behavior).
 */
export function AppShellNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onChat = pathname === "/chat";

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SidebarRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <ZoneSubTabs />
        <main
          className={cn(
            "flex-1 pb-[88px] lg:pb-0",
            "overflow-x-hidden",
          )}
        >
          {children}
        </main>
        <BottomNav />
      </div>
      {!onChat && <ChatFAB />}
    </div>
  );
}
