import * as React from "react";
import { cn } from "@/lib/utils";

type Glow = "none" | "cyan" | "magenta" | "green" | "amber" | "red";
type Padding = "none" | "sm" | "md" | "lg";

const glowClass: Record<Glow, string> = {
  none: "",
  cyan: "shadow-glow-cyan border-border-accent",
  magenta: "shadow-glow-magenta border-accent-magenta/40",
  green: "shadow-glow-green border-accent-green/40",
  amber: "shadow-glow-amber border-border-amber",
  red: "shadow-glow-red border-border-red",
};

const padClass: Record<Padding, string> = {
  none: "",
  sm: "p-3 md:p-4",
  md: "p-4 md:p-6",
  lg: "p-6 md:p-8",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: Glow;
  padding?: Padding;
  asGlass?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ glow = "none", padding = "md", asGlass = false, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md md:rounded-lg border border-border-subtle bg-bg-card shadow-card transition-shadow duration-fast",
        asGlass && "bg-bg-glass backdrop-blur-md",
        glowClass[glow],
        padClass[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  ),
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mb-3 flex items-center justify-between gap-2", className)} {...rest} />
);

export const CardTitle = ({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-micro text-fg-muted", className)} {...rest} />
);
