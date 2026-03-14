import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  message,
  sub,
  action,
  className,
}: {
  icon: LucideIcon;
  message: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-8 text-muted-foreground gap-2",
        className
      )}
    >
      <Icon className="h-8 w-8 opacity-20" />
      <span className="text-[11px]">{message}</span>
      {sub && <span className="text-[9px] opacity-60">{sub}</span>}
      {action}
    </div>
  );
}
