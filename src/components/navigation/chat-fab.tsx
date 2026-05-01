"use client";
import * as React from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModal } from "@/components/chat/chat-modal";
import { ChatPanel } from "@/components/chat/chat-panel";

/**
 * Floating Chat button, present on every page. Opens a slide-up modal
 * (mobile bottom sheet / lg+ right-rail panel) carrying the new H1
 * TREVOR Chat surface — token-streamed Haiku, shared F2 budget pool.
 *
 * Mobile: bottom-right, above BottomNav (with safe-area inset).
 * Desktop: top-right of viewport, fixed.
 *
 * The legacy /chat route is intentionally left in place per H1 §0/§9
 * but is no longer the primary chat surface. I1 may prune it.
 */
export function ChatFAB() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open TREVOR Chat"
        onClick={() => setOpen(true)}
        className={cn(
          "tap-target fixed z-40 inline-flex items-center justify-center rounded-full",
          "border border-accent-cyan/40 bg-bg-card text-accent-cyan shadow-glow-cyan",
          "transition-transform duration-instant active:scale-95 hover:scale-105",
          "h-12 w-12",
          "bottom-[calc(76px+env(safe-area-inset-bottom,0))] right-4",
          "lg:top-4 lg:right-4 lg:bottom-auto",
        )}
      >
        <MessageSquare size={22} />
      </button>

      <ChatModal open={open} onClose={() => setOpen(false)}>
        <ChatPanel onClose={() => setOpen(false)} />
      </ChatModal>
    </>
  );
}
