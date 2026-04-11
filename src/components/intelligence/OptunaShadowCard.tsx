"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, RefreshCw } from "lucide-react";
import { safeFetch } from "@/lib/fetch";

// Hub-side card mirroring the !optuna status embed in Discord.
// Read-only. 60s poll. Shows current A/B shadow state + counters.

type OptunaStatus = {
  enabled: boolean;
  started_at: string | null;
  stopped_at: string | null;
  optuna_params_generated_at: string | null;
  total_comparisons: number;
  prod_fires_count: number;
  optuna_fires_count: number;
  disagreements_count: number;
  agreement_rate: number;
  last_enabled_by: string | null;
  last_reason: string | null;
  updated_at: string | null;
  last_comparison_ts: string | null;
  last_hour: {
    n: number;
    both_fire: number;
    only_prod_fires: number;
    only_optuna_fires: number;
    neither_fires: number;
  };
};

const EMPTY: OptunaStatus = {
  enabled: false,
  started_at: null,
  stopped_at: null,
  optuna_params_generated_at: null,
  total_comparisons: 0,
  prod_fires_count: 0,
  optuna_fires_count: 0,
  disagreements_count: 0,
  agreement_rate: 0,
  last_enabled_by: null,
  last_reason: null,
  updated_at: null,
  last_comparison_ts: null,
  last_hour: {
    n: 0,
    both_fire: 0,
    only_prod_fires: 0,
    only_optuna_fires: 0,
    neither_fires: 0,
  },
};

export function OptunaShadowCard() {
  const [status, setStatus] = useState<OptunaStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await safeFetch<OptunaStatus>("/api/optuna?scope=status", EMPTY);
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const enabled = status.enabled;
  const borderColor = enabled ? "#9b59b6" : "#1e2030";
  const iconColor = enabled ? "#9b59b6" : "#5d5d75";
  const agreementPct = (status.agreement_rate * 100).toFixed(1);

  return (
    <div
      className="bg-[#12131a] border rounded-lg p-4"
      style={{ borderColor }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: iconColor }} />
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
            Optuna A/B Shadow
          </h3>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              color: enabled ? "#9b59b6" : "#5d5d75",
              border: `1px solid ${enabled ? "#9b59b6" : "#5d5d75"}`,
            }}
          >
            {enabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="text-xs text-[#8888a0] hover:text-[#9b59b6] flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <div className="text-[10px] uppercase text-[#8888a0]">Comparisons</div>
          <div className="text-xl font-bold text-[#e8e8f0]">{status.total_comparisons}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#8888a0]">Agreement</div>
          <div className="text-xl font-bold" style={{ color: enabled ? "#9b59b6" : "#5d5d75" }}>
            {agreementPct}%
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#8888a0]">Prod / Optuna</div>
          <div className="text-base font-bold">
            <span className="text-[#00ff88]">{status.prod_fires_count}</span>
            <span className="text-[#5d5d75]"> / </span>
            <span className="text-[#00d4ff]">{status.optuna_fires_count}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#8888a0]">Disagreements</div>
          <div className="text-xl font-bold text-[#ffa502]">{status.disagreements_count}</div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[#1e2030] text-[10px] text-[#8888a0]">
        <div>
          Last hour: n={status.last_hour.n} · both={status.last_hour.both_fire} · only-prod=
          {status.last_hour.only_prod_fires} · only-optuna={status.last_hour.only_optuna_fires} · neither=
          {status.last_hour.neither_fires}
        </div>
        <div className="mt-1">
          Params version: <span className="text-[#e8e8f0]">{status.optuna_params_generated_at || "(none)"}</span>
          {status.started_at && (
            <>
              {" "}· Started: <span className="text-[#e8e8f0]">{status.started_at.substring(0, 16).replace("T", " ")}</span>
            </>
          )}
        </div>
        {status.last_reason && (
          <div className="mt-1 text-[#5d5d75] italic">
            Last action: {status.last_enabled_by || "?"} — {status.last_reason}
          </div>
        )}
        <div className="mt-2 text-[9px] text-[#5d5d75]">
          Production scoring UNCHANGED. Shadow logs comparisons only. Run{" "}
          <span className="text-[#9b59b6]">!optuna report</span> in Discord for verdict.
        </div>
      </div>
    </div>
  );
}
