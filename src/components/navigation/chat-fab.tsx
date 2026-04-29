"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Floating Chat button, present on every page.
 * Mobile: bottom-right, above BottomNav (with safe-area inset).
 * Desktop: top-right of viewport, fixed.
 *
 * Tapping opens /chat as a route. Wave H may upgrade this to a side-panel
 * modal; B1 keeps it as a route nav.
 */
export function ChatFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const isOnChat = pathname === "/chat";

  return (
    <button
      type="button"
      aria-label={isOnChat ? "Close chat" : "Open TREVOR Chat"}
      onClick={() => router.push(isOnChat ? "/dashboard" : "/chat")}
      className={cn(
        "tap-target fixed z-50 inline-flex items-center justify-center rounded-full",
        "border border-accent-cyan/40 bg-bg-card text-accent-cyan shadow-glow-cyan",
        "transition-transform duration-instant active:scale-95",
        "h-12 w-12",
        "bottom-[calc(76px+env(safe-area-inset-bottom,0))] right-4",
        "lg:top-4 lg:right-4 lg:bottom-auto",
      )}
    >
      {isOnChat ? <X size={22} /> : <MessageSquare size={22} />}
    </button>
  );
}
