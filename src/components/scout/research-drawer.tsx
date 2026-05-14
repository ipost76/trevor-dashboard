"use client";

import { useEffect, useRef } from "react";
import type { DiscoveryV2Item, ResearchLink } from "@/lib/scout-v3-types";

interface Props {
  /** When non-null, drawer is open and shows links for this item. Null = closed. */
  item: DiscoveryV2Item | null;
  /** Caller dismisses by setting item to null via this callback. */
  onClose: () => void;
}

/**
 * ResearchDrawer — bottom sheet (mobile) / centered modal (desktop) displaying
 * the 6 drawer research links for a discovery card.
 *
 * Trigger: opened by parent passing a non-null `item`. Closed by:
 *   - tapping the backdrop
 *   - tapping the X button
 *   - pressing Escape
 *   - tapping any link (which also opens the URL in a new tab)
 *
 * Renders nothing when `item` is null (no DOM cost when closed).
 *
 * A11y:
 *   - role="dialog", aria-modal="true"
 *   - Escape key dismisses
 *   - Focus moves to the close button on open
 *   - Body scroll locked while open
 */
export function ResearchDrawer({ item, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = item !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const t = window.setTimeout(() => closeRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="research-drawer-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Dismiss research links"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* Sheet — bottom sheet on mobile, centered modal on sm+ */}
      <div
        className="
          relative w-full sm:w-[420px] max-h-[80vh] overflow-y-auto
          bg-zinc-950 border-t sm:border border-fuchsia-400/30
          rounded-t-2xl sm:rounded-2xl
          shadow-[0_0_40px_-8px_rgba(232,121,249,0.4)]
          animate-in slide-in-from-bottom-4 sm:fade-in
        "
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <span className="text-fuchsia-400 text-lg">🔍</span>
          <div className="flex-1 min-w-0">
            <h2
              id="research-drawer-title"
              className="font-mono text-sm uppercase tracking-[0.15em] text-fuchsia-300"
            >
              MORE RESEARCH · {item.ticker}
            </h2>
            {item.company_name && (
              <p className="text-xs text-zinc-500 truncate">{item.company_name}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="
              min-h-[44px] min-w-[44px] flex items-center justify-center
              rounded text-zinc-400 hover:text-white hover:bg-zinc-800
              focus:outline-none focus:ring-2 focus:ring-fuchsia-400
            "
          >
            ✕
          </button>
        </div>

        {/* Body — 2-column grid of 6 link buttons */}
        <div className="p-4 grid grid-cols-2 gap-2">
          {item.research_links.drawer.map((link) => (
            <DrawerLink key={link.label} link={link} onAfterOpen={onClose} />
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-4 pt-1 text-center">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Tap any source · opens in new tab
          </p>
        </div>
      </div>
    </div>
  );
}

function DrawerLink({
  link,
  onAfterOpen,
}: {
  link: ResearchLink;
  onAfterOpen: () => void;
}) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        // Tiny defer so Safari registers the new-tab open before the parent re-renders.
        window.setTimeout(onAfterOpen, 100);
      }}
      className="
        flex flex-col items-center justify-center gap-1.5
        py-3 px-2 min-h-[64px] rounded
        border border-zinc-800 hover:border-fuchsia-400/50
        hover:bg-fuchsia-400/5 transition
        focus:outline-none focus:ring-2 focus:ring-fuchsia-400
      "
    >
      <span className="text-2xl leading-none">{link.icon}</span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300 text-center">
        {link.label}
      </span>
    </a>
  );
}
