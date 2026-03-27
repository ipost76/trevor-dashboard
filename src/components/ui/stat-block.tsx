import { cn } from "@/lib/utils";

export function StatBlock({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="stat-label">{label}</div>
      <div className={cn("stat-value text-sm md:text-xl", color || "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}
