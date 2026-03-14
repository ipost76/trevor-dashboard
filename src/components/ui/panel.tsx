import { cn } from "@/lib/utils";

export function Panel({
  title,
  children,
  className,
  headerRight,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className={cn("panel flex flex-col overflow-hidden", className)}>
      <div className="panel-header flex items-center justify-between">
        <span>{title}</span>
        {headerRight}
      </div>
      <div className="flex-1 overflow-auto p-2">{children}</div>
    </div>
  );
}
