"use client";
import { cn } from "@/lib/utils";
export function TypingDots({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: { w: "gap-0.5", d: "h-1 w-1" }, md: { w: "gap-1", d: "h-1.5 w-1.5" }, lg: { w: "gap-1.5", d: "h-2 w-2" } }[size];
  return (
    <span aria-hidden className={cn("inline-flex items-center", s.w, className)}>
      {[0, 150, 300].map((delay, i) => (
        <span key={i} className={cn("animate-bounce-dot rounded-full bg-current", s.d)} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}
