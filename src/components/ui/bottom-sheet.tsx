"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-bg-overlay backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "safe-pb relative max-h-[85vh] overflow-auto rounded-t-xl border-t border-border-strong bg-bg-card shadow-card animate-slide-up",
          "md:mx-auto md:my-auto md:max-h-[80vh] md:max-w-2xl md:rounded-xl",
          className,
        )}
      >
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-border-subtle bg-bg-card/95 px-4 py-3 backdrop-blur">
          <span className="text-h3 font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-target flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary"
          >
            {"✕"}
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
