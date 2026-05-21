"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabBarItem<T extends string> {
  key: T;
  label: string;
  badge?: number | string;
}

export interface TabBarProps<T extends string> {
  items: ReadonlyArray<TabBarItem<T>>;
  active: T;
  onChange: (next: T) => void;
  className?: string;
}

// Edge-fade width — keeps the affordance visible at 375px while leaving
// enough room for two tab labels in the unfaded zone.
const EDGE_FADE_PX = 28;

export function TabBar<T extends string>({
  items,
  active,
  onChange,
  className,
}: TabBarProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      );
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [items]);

  // Mask the leading/trailing 28px to transparent when there's more
  // content to scroll. Surface-agnostic (no bg color needed) — works
  // inside ZoneSubTabs (sticky on bg-sidebar) AND inside a Card.
  const maskImage = React.useMemo<string | undefined>(() => {
    if (!canScrollLeft && !canScrollRight) return undefined;
    const left = canScrollLeft
      ? `transparent 0, black ${EDGE_FADE_PX}px`
      : "black 0";
    const right = canScrollRight
      ? `black calc(100% - ${EDGE_FADE_PX}px), transparent 100%`
      : "black 100%";
    return `linear-gradient(to right, ${left}, ${right})`;
  }, [canScrollLeft, canScrollRight]);

  return (
    <div
      ref={scrollRef}
      role="tablist"
      className={cn(
        "relative -mx-4 overflow-x-auto border-b border-border-subtle px-4 [scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={
        maskImage
          ? ({
              maskImage,
              WebkitMaskImage: maskImage,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex min-w-max gap-1">
        {items.map((it) => {
          const isActive = it.key === active;
          return (
            <button
              key={it.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(it.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "tap-target relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2 text-caption uppercase tracking-wider transition-colors duration-fast",
                isActive
                  ? "text-accent-cyan-soft-strong"
                  : "text-fg-muted hover:text-fg-primary",
              )}
            >
              {it.label}
              {it.badge !== undefined && (
                <span className="rounded-pill bg-bg-elevated px-1.5 py-0.5 text-micro text-fg-muted">
                  {it.badge}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-2 right-2 h-px bg-accent-cyan-soft-strong shadow-glow-subtle-cyan transition-all duration-fast"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
