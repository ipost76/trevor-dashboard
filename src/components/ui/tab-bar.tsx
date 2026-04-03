"use client";
import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

export type TabDef<T extends string> = {
  key: T;
  label: string;
  icon: LucideIcon;
};

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [tabs]);

  return (
    <div className="relative">
      <div ref={scrollRef} role="tablist" className="flex items-center border-b border-[var(--border)] bg-[var(--panel-header)] overflow-x-auto scrollbar-hide">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={cn(
                "flex items-center gap-1 px-2.5 md:px-4 py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-[0.1em] transition-colors border-b-2 shrink-0 whitespace-nowrap",
                active === t.key
                  ? "text-[var(--neon-cyan)] border-[var(--neon-cyan)]"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <div className="absolute top-0 right-0 bottom-0 w-10 pointer-events-none bg-gradient-to-l from-[var(--bg-deep,#0a0a0f)] to-transparent transition-opacity" />
      )}
      {canScrollLeft && (
        <div className="absolute top-0 left-0 bottom-0 w-10 pointer-events-none bg-gradient-to-r from-[var(--bg-deep,#0a0a0f)] to-transparent z-[1] transition-opacity" />
      )}
    </div>
  );
}
