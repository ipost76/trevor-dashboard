"use strict";
/**
 * TREVOR Hub Write-Gateway — OP ALLOWLIST REGISTRY  [W-C-P2a · B3 read-only lockdown]
 * ----------------------------------------------------------------------------
 * The gateway is a RE-EXPRESSED OP-ALLOWLIST, not a transparent proxy. The
 * client never sends a helper path or SQL — only an `op` name from this fixed
 * map plus input-validated `args`. The HUB-side gateway uses this module to
 * reject unknown ops (400) BEFORE forwarding over Tailscale.
 *
 * [B3] 2026-06-28 — Hub read-only lockdown. The 22 flag-gated write ops were
 * STRIPPED from this allowlist (capital / pnl_stats / trade-edit / list /
 * benign / toggle / control / config writes), and the now-orphaned validator
 * helpers + consts that only served them were removed with them. Once an op is
 * gone from this registry the Hub-side gateway rejects it `unknown_op` (400)
 * BEFORE ever forwarding to the VM — so every gateway-backed write route is dead
 * at the Hub choke point. The VM-side registry strip is the second layer (B4).
 *
 * The ONE survivor is `killswitch.set` — the emergency stop, intentionally
 * UNGATED (Ghost, 2026-06-06) and always actionable.
 *
 * Zero dependencies (Node built-ins only) so this loads inside the standalone
 * gateway process the same way `server.js` does.
 */

// op → { flag: <auto_config key | null>, validate(args) → null (ok) | "<error>" }
const OPS = {
  // killswitch is the emergency stop — intentionally has NO write-enable gate (Ghost, 2026-06-06).
  "killswitch.set": {
    flag: null,
    validate: (a) => (["on", "off"].includes(String(a.action || "").toLowerCase()) ? null : "action must be 'on' or 'off'"),
  },

  // R12-B1 (2026-07-22): the RECORD-ONLY promotion approval. The Hub records an
  // APPROVAL RECORD; CC applies the config change later via a prompt. This op
  // writes ONE row to promotion_approvals (applied=0) and touches NOTHING else —
  // no config value, no auto_config flag, no champion table, no level mint.
  //
  // 🚨 The allowed-key Set is enumerated denial #1 (STRUCTURAL, not by convention):
  // any key other than candidate_id/decision/note fails validation → 400 at this
  // Hub choke, BEFORE the envelope is forwarded to the VM. No config field can
  // ever enter the args. Flag-gated HUB_PROMOTION_WRITE_ENABLED (default OFF),
  // enforced AUTHORITATIVELY VM-side by gw_exec._flag_on (423 when off).
  "promotion.approve": {
    flag: "HUB_PROMOTION_WRITE_ENABLED",
    validate: (a) => {
      const allowed = new Set(["candidate_id", "decision", "note"]);
      const extra = Object.keys(a).filter((k) => !allowed.has(k));
      if (extra.length) return `unexpected key(s): ${extra.join(", ")}`;
      if (typeof a.candidate_id !== "string" || !a.candidate_id.trim()) return "candidate_id required";
      if (!["approve", "reject"].includes(a.decision)) return "decision must be 'approve' or 'reject'";
      if (a.note !== undefined && typeof a.note !== "string") return "note must be a string";
      return null;
    },
  },

  // R12-B3 (2026-07-22): the trainer PAUSE control (H5). Records a durable pause
  // REQUEST for the trainer + R8 loop; it does NOT stop an already-running loop —
  // trainer_loop.run_trainer_loop checks TRAINER_LOOP_ENABLED once at entry, so
  // the daemon must POLL this state per-iteration (wired in R13). Flag-gated
  // HUB_PAUSE_CONTROL_ENABLED (default OFF), enforced AUTHORITATIVELY VM-side by
  // gw_exec._flag_on (423 when off); this Hub `flag` field is reference + the UI
  // renders the control only when it reads on. The VM script (set_trainer_pause.py)
  // writes ONLY the additive trainer_pause_state row (+ the gateway's change_log
  // audit) — NO WATCHER_* flag, NO champion/shadow_defs, NO level mint. THE
  // WATCHER STAYS ON.
  //
  // 🚨 validate REJECTS any key other than `reason` (STRUCTURAL, mirrors
  // promotion.approve) so no config field — and no WATCHER_* key — can enter the
  // args at this Hub choke, BEFORE the envelope is forwarded to the VM.
  "trainer.pause": {
    flag: "HUB_PAUSE_CONTROL_ENABLED",
    validate: (a) => {
      const allowed = new Set(["reason"]);
      const extra = Object.keys(a).filter((k) => !allowed.has(k));
      if (extra.length) return `unexpected key(s): ${extra.join(", ")}`;
      if (a.reason !== undefined && typeof a.reason !== "string") return "reason must be a string";
      return null;
    },
  },
  "trainer.resume": {
    flag: "HUB_PAUSE_CONTROL_ENABLED",
    validate: (a) => {
      const allowed = new Set(["reason"]);
      const extra = Object.keys(a).filter((k) => !allowed.has(k));
      if (extra.length) return `unexpected key(s): ${extra.join(", ")}`;
      if (a.reason !== undefined && typeof a.reason !== "string") return "reason must be a string";
      return null;
    },
  },
};

function getOp(name) {
  return Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : null;
}
function opNames() {
  return Object.keys(OPS);
}

module.exports = { OPS, getOp, opNames };
