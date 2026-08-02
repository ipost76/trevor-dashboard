"use client";

import { useState, useEffect, useRef } from "react";
import { X, Lock, Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { plainAuthError } from "@/lib/plain-labels";

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
      // 🚨 B13 — THIS LINE IS THE ENTIRE FAILURE SURFACE for a password change,
      // so it must always name a failure. It used to render `data.error`
      // verbatim, which is how `EACCES: permission denied, open
      // '/home/ghost/…/.env.local'` reached the screen. `plainAuthError` always
      // returns a failure sentence and structurally cannot echo the payload —
      // an unrecognised or absent code still yields a neutral failure line,
      // never silence and never anything readable as success.
      else setError(plainAuthError(data.error_code));
    } catch { setError("Connection error"); }
    setLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--color-accent-cyan-soft-subtle)",
  };

  const inputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft)";
    e.currentTarget.style.boxShadow = "var(--shadow-glow-focus)";
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft-subtle)";
    e.currentTarget.style.boxShadow = "none";
  };

  const buttonValid = next.length >= 6 && next === confirm && current.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay px-4" onClick={onClose}>
      <div className="card-elevated w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-accent-cyan-soft-strong" strokeWidth={1.8} />
            <span className="text-label-ui text-accent-cyan-soft-strong">Update Password</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 -mr-2 items-center justify-center rounded text-fg-muted transition-colors duration-fast hover:text-fg-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{
                background: "rgba(95,204,153,0.1)",
                border: "1px solid var(--color-accent-mint-subtle)",
              }}
            >
              <Check className="h-5 w-5 text-accent-mint-strong" strokeWidth={2} />
            </div>
            <span className="text-caption-ui text-accent-mint-strong">Password updated</span>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-label-ui text-fg-muted block">Current Password</label>
              <div className="relative mt-1.5">
                <input
                  ref={ref}
                  type={show ? "text" : "password"}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  className="w-full rounded bg-bg-elevated px-3 py-2 pr-9 text-[13px] font-mono text-fg-primary outline-none transition-colors duration-fast"
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-fg-muted transition-colors duration-fast hover:text-fg-primary"
                  aria-label={show ? "Hide passwords" : "Show passwords"}
                >
                  {show ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-label-ui text-fg-muted block">New Password</label>
              <input
                type={show ? "text" : "password"}
                value={next}
                onChange={e => setNext(e.target.value)}
                className="mt-1.5 w-full rounded bg-bg-elevated px-3 py-2 text-[13px] font-mono text-fg-primary outline-none transition-colors duration-fast"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
            </div>
            <div>
              <label className="text-label-ui text-fg-muted block">Confirm Password</label>
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="mt-1.5 w-full rounded bg-bg-elevated px-3 py-2 text-[13px] font-mono text-fg-primary outline-none transition-colors duration-fast"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
            </div>
            {error && (
              <div className="flex items-center gap-1.5 text-caption-ui text-accent-red">
                <AlertCircle className="h-3 w-3" strokeWidth={2} />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !buttonValid}
              className="text-label-ui w-full rounded py-3 transition-all duration-fast disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: buttonValid ? "rgba(95,180,204,0.1)" : "rgba(138,138,152,0.08)",
                border: `1px solid ${buttonValid ? "var(--color-accent-cyan-soft)" : "var(--color-fg-dim)"}`,
                color: buttonValid ? "var(--color-accent-cyan-soft-strong)" : "var(--color-fg-muted)",
                minHeight: "44px",
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.background = "rgba(95,180,204,0.18)";
                  e.currentTarget.style.boxShadow = "var(--shadow-glow-active)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = buttonValid ? "rgba(95,180,204,0.1)" : "rgba(138,138,152,0.08)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {loading ? "UPDATING…" : "UPDATE PASSWORD"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
