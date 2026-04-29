import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
    >
      {icon && <div className="text-fg-dim">{icon}</div>}
      <div className="text-h3 text-fg-primary">{title}</div>
      {body && <div className="max-w-sm text-caption text-fg-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
