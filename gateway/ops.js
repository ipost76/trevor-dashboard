"use strict";
/**
 * TREVOR Hub Write-Gateway — OP ALLOWLIST REGISTRY  [W-C-P2a]
 * ----------------------------------------------------------------------------
 * The gateway is a RE-EXPRESSED OP-ALLOWLIST, not a transparent proxy. The
 * client never sends a helper path or SQL — only an `op` name from this fixed
 * map plus input-validated `args`. The HUB-side gateway uses this module to
 * reject unknown ops (400) and re-validate args (400) BEFORE forwarding over
 * Tailscale. The VM-side gateway (built in a separate, VM-SSH'd paste) owns the
 * op → helper-invocation mapping, the authoritative flag check, and the
 * mandatory `change_log` audit. `flag` here is informational/UX only — the VM
 * is the source of truth and re-checks it against `auto_config`.
 *
 * FLAG STORE DECISION (Ghost, 2026-06-06): the three NEW write-enable flags
 * (HUB_CAPITAL_WRITE_ENABLED, HUB_TRADE_EDIT_ENABLED, HUB_LIST_WRITE_ENABLED)
 * are `auto_config` DB ROWS — read live by the VM gateway via
 * `SELECT value FROM auto_config WHERE key=?`, exactly like every existing flag
 * (LIVE_EDIT_ENABLED, the toggle flags, HUB_BRAIN_EDIT_ENABLED). Default OFF =
 * row absent or '0'. This overrides the original prompt's "VM env" wording so
 * the new flags hot-flip with no restart and surface in the control panel.
 *
 * Zero dependencies (Node built-ins only) so this loads inside the standalone
 * gateway process the same way `server.js` does.
 */

// --- small validators (mirror each route's existing input validation) ---
function isNonEmptyStr(v, max) {
  return typeof v === "string" && v.length > 0 && (max ? v.length <= max : true);
}
function isPosNum(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function isNonNegNum(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
const TICKER_RE = /^[A-Z0-9]{1,20}$/;
const BOOLISH = new Set(["true", "false"]);

// op → { flag: <auto_config key | null>, validate(args) → null (ok) | "<error>" }
const OPS = {
  // ---- 🔴 Financial — new HUB_CAPITAL_WRITE_ENABLED ----
  "capital.set": {
    flag: "HUB_CAPITAL_WRITE_ENABLED",
    validate: (a) => (isNonNegNum(a.amount) ? null : "amount must be a finite number >= 0"),
  },
  "capital.reset": {
    flag: "HUB_CAPITAL_WRITE_ENABLED",
    validate: (a) => {
      if (a.confirmText !== "RESET") return "confirmText must be exactly 'RESET'";
      if (!(typeof a.amount === "number" && Number.isFinite(a.amount) && a.amount > 0 && a.amount < 100000000)) {
        return "amount must be > 0 and < 100,000,000";
      }
      return null;
    },
  },
  "pnl_stats.reset": {
    flag: "HUB_CAPITAL_WRITE_ENABLED",
    validate: (a) => (a.confirmText === "RESET" ? null : "confirmText must be exactly 'RESET'"),
  },

  // ---- 🔴 Financial / 🔴 Destructive — new HUB_TRADE_EDIT_ENABLED ----
  "trades.patch_margin": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(a.trade_id, 200) && isPosNum(a.margin_usd)
        ? null
        : "trade_id (non-empty string <=200) and margin_usd (>0) required",
  },
  "trades.edit_entry": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(a.trade_id, 200) && isPosNum(a.entry_price)
        ? null
        : "trade_id and positive entry_price required",
  },
  "trades.flip": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(a.trade_id, 200) && isPosNum(a.exit_price) && isPosNum(a.new_entry)
        ? null
        : "trade_id, exit_price (>0) and new_entry (>0) required",
  },
  "trades.close": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(a.trade_id, 200) && isPosNum(a.exit_price)
        ? null
        : "trade_id and positive exit_price required",
  },
  "trades.delete": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) => {
      if (a.mode === "bulk") {
        return Array.isArray(a.ids) && a.ids.length > 0 && a.ids.every((x) => isNonEmptyStr(String(x), 200))
          ? null
          : "bulk mode requires a non-empty ids[] of trade ids";
      }
      if (a.mode === "single") {
        return isNonEmptyStr(String(a.trade_id == null ? "" : a.trade_id), 200)
          ? null
          : "single mode requires a trade_id";
      }
      return "mode must be 'single' or 'bulk'";
    },
  },
  "dca.set": {
    flag: "HUB_TRADE_EDIT_ENABLED",
    validate: (a) =>
      ["add", "remove", "edit", "pause", "resume"].includes(String(a.action || "").toLowerCase())
        ? null
        : "action must be one of add|remove|edit|pause|resume",
  },

  // ---- 🟡 List writes — new HUB_LIST_WRITE_ENABLED ----
  "quality.set": {
    flag: "HUB_LIST_WRITE_ENABLED",
    validate: (a) =>
      ["approve", "reject"].includes(String(a.action || "").toLowerCase()) && Number.isInteger(a.pid)
        ? null
        : "action must be approve|reject and pid must be an integer",
  },
  "watchlist.add": {
    flag: "HUB_LIST_WRITE_ENABLED",
    validate: (a) => (TICKER_RE.test(String(a.ticker || "")) ? null : "ticker must match [A-Z0-9]{1,20}"),
  },
  "watchlist.remove": {
    flag: "HUB_LIST_WRITE_ENABLED",
    validate: (a) => (TICKER_RE.test(String(a.ticker || "")) ? null : "ticker must match [A-Z0-9]{1,20}"),
  },

  // ---- 🟡 Already-gated state ops — KEEP their EXISTING flags (VM re-checks via helper exit 3) ----
  // killswitch is the emergency stop — intentionally has NO write-enable gate (Ghost, 2026-06-06).
  "killswitch.set": {
    flag: null,
    validate: (a) => (["on", "off"].includes(String(a.action || "").toLowerCase()) ? null : "action must be 'on' or 'off'"),
  },
  "autotrader.toggle": {
    flag: "HUB_AUTOTRADER_TOGGLE_ENABLED",
    validate: (a) => (BOOLISH.has(String(a.value || "").toLowerCase()) ? null : "value must be 'true' or 'false'"),
  },
  "aggressive.set": {
    flag: "HUB_AGGRESSIVE_TOGGLE_ENABLED",
    validate: (a) => (BOOLISH.has(String(a.value || "").toLowerCase()) ? null : "value must be 'true' or 'false'"),
  },
  "exit_controls.set": {
    flag: "HUB_CONFIRM_CYCLES_TOGGLE_ENABLED",
    validate: (a) => (BOOLISH.has(String(a.value || "").toLowerCase()) ? null : "value must be 'true' or 'false'"),
  },
  "partials.toggle": {
    flag: "HUB_LIVE_PARTIALS_TOGGLE_ENABLED",
    validate: (a) => (BOOLISH.has(String(a.value || "").toLowerCase()) ? null : "value must be 'true' or 'false'"),
  },
  "control.set": {
    flag: "LIVE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(String(a.key || "")) && BOOLISH.has(String(a.value || "").toLowerCase())
        ? null
        : "key (non-empty) and boolean value ('true'|'false') required",
  },
  "config.set": {
    flag: "LIVE_EDIT_ENABLED",
    validate: (a) =>
      isNonEmptyStr(String(a.key || "")) && a.value !== undefined && a.value !== null
        ? null
        : "key (non-empty) and a non-null value required",
  },
};

function getOp(name) {
  return Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : null;
}
function opNames() {
  return Object.keys(OPS);
}

module.exports = { OPS, getOp, opNames };
