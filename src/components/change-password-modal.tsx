"use client";

import { useState, useEffect, useRef } from "react";
import { X, Lock, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCurrent(""); setNext(""); setConfirm(""); setError(""); setSuccess(false);
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) { setError("Min 6 characters"); return; }
    if (next !== confirm) { setError("Passwords don't match"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change-password", currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (data.ok) setSuccess(true);
      else setError(data.error || "Failed");
    } catch { setError("Connection error"); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="panel w-full max-w-sm p-4 glow-border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-[var(--neon-cyan)]" />
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase neon-text">Change Password</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-6 gap-2">
            <Check className="h-8 w-8 text-[var(--neon-green)]" />
            <span className="text-[11px] neon-green">Password updated</span>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Current Password</label>
              <div className="relative mt-1">
                <input ref={ref} type={show ? "text" : "password"} value={current} onChange={e => setCurrent(e.target.value)} className="input-terminal w-full pr-8" />
                <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">New Password</label>
              <input type={show ? "text" : "password"} value={next} onChange={e => setNext(e.target.value)} className="input-terminal w-full mt-1" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Confirm Password</label>
              <input type={show ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} className="input-terminal w-full mt-1" />
            </div>
            {error && <div className="flex items-center gap-1 text-[10px] neon-red"><AlertCircle className="h-3 w-3" />{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-2 disabled:opacity-30">
              {loading ? "UPDATING..." : "UPDATE PASSWORD"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
