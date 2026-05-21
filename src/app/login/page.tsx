"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username: user, password: pass }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(searchParams.get("from") || "/autotrader");
      } else {
        setError(data.error || "Invalid credentials");
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } catch {
      setError("Connection failed");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary relative overflow-hidden px-4">
      {/* Refined grid background — cyan-soft, ~50% of original intensity */}
      <div className="absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(95,180,204,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(95,180,204,0.025) 1px, transparent 1px)",
        backgroundSize: "40px 40px"
      }} />

      {/* Refined radial glow — cyan-soft, restrained */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at center, rgba(95,180,204,0.04) 0%, transparent 60%)"
      }} />

      <div className={`relative z-10 w-full max-w-sm ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
        <div className="card-elevated p-6">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div
              className="flex h-12 w-12 items-center justify-center rounded mb-3"
              style={{
                background: "rgba(95,180,204,0.08)",
                border: "1px solid var(--color-accent-cyan-soft-subtle)",
              }}
            >
              <span className="text-xl font-semibold text-accent-cyan-soft-strong font-sans">T</span>
            </div>
            <h1 className="text-label-ui text-accent-cyan-soft-strong" style={{ letterSpacing: "0.2em" }}>TREVOR</h1>
            <p className="text-caption-ui text-fg-muted mt-1" style={{ fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase" }}>Trading Terminal Access</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-label-ui text-fg-muted block">Username</label>
              <input
                type="text"
                value={user}
                onChange={e => setUser(e.target.value)}
                className="mt-1.5 w-full rounded bg-bg-elevated px-3 py-2 text-[13px] font-mono text-fg-primary outline-none transition-colors duration-fast"
                style={{
                  border: "1px solid var(--color-accent-cyan-soft-subtle)",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft)"; e.currentTarget.style.boxShadow = "var(--shadow-glow-focus)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft-subtle)"; e.currentTarget.style.boxShadow = "none"; }}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-label-ui text-fg-muted block">Password</label>
              <input
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                className="mt-1.5 w-full rounded bg-bg-elevated px-3 py-2 text-[13px] font-mono text-fg-primary outline-none transition-colors duration-fast"
                style={{
                  border: "1px solid var(--color-accent-cyan-soft-subtle)",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft)"; e.currentTarget.style.boxShadow = "var(--shadow-glow-focus)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-accent-cyan-soft-subtle)"; e.currentTarget.style.boxShadow = "none"; }}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-caption-ui text-accent-red text-center">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !user || !pass}
              className="text-label-ui w-full rounded py-3 transition-all duration-fast disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: "rgba(95,180,204,0.1)",
                border: "1px solid var(--color-accent-cyan-soft)",
                color: "var(--color-accent-cyan-soft-strong)",
                minHeight: "44px",
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.background = "rgba(95,180,204,0.18)";
                  e.currentTarget.style.boxShadow = "var(--shadow-glow-active)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(95,180,204,0.1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {loading ? "AUTHENTICATING…" : "AUTHENTICATE"}
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-bg-primary"><span className="text-label-ui text-accent-cyan-soft-strong">Loading…</span></div>}>
      <LoginForm />
    </Suspense>
  );
}
