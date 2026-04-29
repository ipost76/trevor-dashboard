import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-shimmer-ds rounded-md bg-gradient-to-r from-bg-elevated via-bg-card to-bg-elevated bg-[length:200%_100%]",
        className,
      )}
      {...rest}
    />
  );
}
