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
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(0,240,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.03) 1px, transparent 1px)",
        backgroundSize: "40px 40px"
      }} />

      {/* Radial glow */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at center, rgba(0,240,255,0.06) 0%, transparent 60%)"
      }} />

      <div className={`relative z-10 w-full max-w-sm ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
        <div className="panel p-6 glow-border">
          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded bg-[rgba(0,240,255,0.1)] border border-[rgba(0,240,255,0.3)] mb-3">
              <span className="text-xl font-bold neon-text">T</span>
            </div>
            <h1 className="text-sm font-bold tracking-[0.2em] neon-text">TREVOR</h1>
            <p className="text-[9px] tracking-[0.15em] text-muted-foreground uppercase mt-1">Trading Terminal Access</p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Username</label>
              <input
                type="text"
                value={user}
                onChange={e => setUser(e.target.value)}
                className="input-terminal w-full mt-1"
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Password</label>
              <input
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                className="input-terminal w-full mt-1"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-[10px] neon-red text-center">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !user || !pass}
              className="btn-primary w-full py-2.5 disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {loading ? "AUTHENTICATING..." : "AUTHENTICATE"}
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0a0a0f]"><span className="neon-text text-sm">Loading...</span></div>}>
      <LoginForm />
    </Suspense>
  );
}
