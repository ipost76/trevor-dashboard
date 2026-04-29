"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variantCls: Record<Variant, string> = {
  primary:     "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/20",
  secondary:   "bg-bg-elevated text-fg-primary border border-border-subtle hover:border-border-strong",
  ghost:       "bg-transparent text-fg-muted hover:text-fg-primary",
  destructive: "bg-accent-red/10 text-accent-red border border-accent-red/40 hover:bg-accent-red/20",
};

const sizeCls: Record<Size, string> = {
  sm: "px-3 py-1.5 text-caption",
  md: "px-4 py-2 text-body",
  lg: "px-6 py-3 text-h3",
};

export interface HapticButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const HapticButton = React.forwardRef<HTMLButtonElement, HapticButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      fullWidth = false,
      className,
      onClick,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(8);
        } catch {
          // no-op: vibration not supported on this device
        }
      }
      onClick?.(e);
    };
    return (
      <button
        ref={ref}
        type={type}
        onClick={handleClick}
        className={cn(
          "tap-target inline-flex items-center justify-center gap-2 rounded-md font-mono uppercase tracking-wider",
          "transition-all duration-instant active:scale-[0.98]",
          variantCls[variant],
          sizeCls[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
HapticButton.displayName = "HapticButton";
