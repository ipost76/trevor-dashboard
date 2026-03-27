"use client";
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
  return (
    <div role="tablist" className="flex items-center border-b border-[var(--border)] bg-[var(--panel-header)] overflow-x-auto scrollbar-hide">
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
  );
}
