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
};

function getOp(name) {
  return Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : null;
}
function opNames() {
  return Object.keys(OPS);
}

module.exports = { OPS, getOp, opNames };
