"use client";

export function DashboardPlaceholder() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center font-mono">
      <div className="text-xs uppercase tracking-[0.3em] text-cyan-400/60">
        TREVOR // DASHBOARD
      </div>
      <h1 className="text-2xl font-bold text-cyan-300">Under Reconstruction</h1>
      <p className="max-w-md text-sm text-zinc-400">
        Dashboard rebuild in progress (Wave C). Until then: bot remains live,
        AutoTrader remains live, signals continue posting to Discord.
      </p>
      <p className="max-w-md text-xs text-zinc-500">
        Killswitch via Discord: <code className="rounded bg-zinc-900 px-2 py-1 text-amber-300">!killswitch on [reason]</code>
      </p>
    </div>
  );
}
