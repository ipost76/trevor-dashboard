"use client";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── helpers ────────────────────────────────────────────────────── */
export function timeAgo(iso: string | null): string {
  if (!iso) return "\u2014";
  const d = new Date(iso + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function badge(text: string, color: string) {
  return <span className={cn("px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold border", color)}>{text}</span>;
}

export const statusColors: Record<string, string> = {
  active: "text-green-400 border-green-400/30 bg-green-400/10",
  testing: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  retired: "text-gray-500 border-gray-500/30 bg-gray-500/10",
  idea: "text-cyan-400 border-cyan-400/30 bg-cyan-400/10",
};

/* ── Modal ──────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="glass-strong w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto rounded-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(0,240,255,0.1)]">
          <h3 className="text-xs font-bold tracking-[0.15em] uppercase neon-text">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded" />
    </label>
  );
}

export function TextArea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <textarea {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded min-h-[80px] resize-y" />
    </label>
  );
}

export function Select({ label, options, ...props }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select {...props} className="input-terminal w-full mt-1 px-2.5 py-1.5 text-xs rounded bg-[rgba(0,240,255,0.04)]">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
