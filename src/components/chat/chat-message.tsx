"use client";
import * as React from "react";
import { Sparkles, User } from "lucide-react";

interface Props {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

export function ChatMessage({ role, content, pending }: Props) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="grid h-8 w-8 flex-none place-items-center rounded-md border border-accent-cyan-soft/30 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong">
          <Sparkles size={14} />
        </div>
      )}

      <div
        className={[
          "max-w-[85%] rounded-md border px-3 py-2 font-sans text-caption leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "border-accent-cyan-soft/40 bg-accent-cyan-soft/10 text-fg-primary"
            : "border-border-subtle bg-bg-elevated text-fg-primary",
        ].join(" ")}
      >
        {content || (pending ? <PendingDots /> : null)}
        {pending && content && (
          <span
            className="ml-0.5 inline-block h-3 w-1.5 -mb-0.5 bg-accent-cyan-soft animate-pulse"
            aria-hidden
          />
        )}
      </div>

      {isUser && (
        <div className="grid h-8 w-8 flex-none place-items-center rounded-md border border-border-subtle bg-bg-elevated text-fg-muted">
          <User size={14} />
        </div>
      )}
    </div>
  );
}

function PendingDots() {
  return (
    <span className="inline-flex gap-1 text-fg-muted">
      <span className="h-1.5 w-1.5 rounded-pill bg-current animate-pulse [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-pill bg-current animate-pulse [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-pill bg-current animate-pulse [animation-delay:300ms]" />
    </span>
  );
}
