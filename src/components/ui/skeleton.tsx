import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[rgba(255,255,255,0.04)]",
        className
      )}
    />
  );
}

export function StatStripSkeleton() {
  return (
    <div className="col-span-full panel">
      <div className="panel-header">PORTFOLIO OVERVIEW</div>
      <div className="flex items-center gap-6 p-3 flex-wrap">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-2 w-14" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelSkeleton({ title }: { title: string }) {
  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-header">{title}</div>
      <div className="flex-1 p-2 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
