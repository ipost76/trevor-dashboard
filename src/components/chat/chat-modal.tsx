"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ChatModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Mobile: full-height bottom sheet, slide-up-spring on open.
 * lg+: right-rail panel, max-width 480px, anchored to viewport edge.
 *
 * Closing animates out for 280ms via slide-down-spring + scrim opacity
 * transition before the portal unmounts. ESC + scrim click + close
 * button all dismiss. Body scroll is locked while open.
 */
export function ChatModal({ open, onClose, children }: ChatModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const [animatingOut, setAnimatingOut] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setAnimatingOut(false);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prevOverflow; };
    }
    if (mounted) {
      setAnimatingOut(true);
      const t = window.setTimeout(() => {
        setMounted(false);
        setAnimatingOut(false);
      }, 280);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, mounted]);

  React.useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="TREVOR Chat"
    >
      {/* Scrim — pure transition, fades 200ms together with panel slide-down */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={onClose}
        className={[
          "absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity",
          animatingOut ? "opacity-0 duration-200" : "opacity-100 animate-scrim-fade-in",
        ].join(" ")}
      />

      {/* Panel */}
      <div
        className={[
          "relative flex h-[100dvh] w-full flex-col",
          "bg-bg-primary border-t border-accent-cyan/30 shadow-glow-cyan",
          "lg:h-[100dvh] lg:max-w-[480px] lg:border-l lg:border-t-0",
          "pb-[env(safe-area-inset-bottom)]",
          animatingOut ? "animate-slide-down-spring" : "animate-slide-up-spring",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag-handle visual cue */}
        <div className="flex h-7 items-center justify-center lg:hidden">
          <div className="h-1 w-10 rounded-full bg-fg-muted/40" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="tap-target absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-md text-fg-muted hover:text-fg-primary"
        >
          <X size={18} />
        </button>

        <div className="flex h-full flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
