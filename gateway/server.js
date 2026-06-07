#!/usr/bin/env node
/**
 * TREVOR Hub — local Write-Gateway  [W-C-P1 skeleton → W-C-P2a write path]
 * ----------------------------------------------------------------------------
 * The TrevorHub-SIDE half of the two-hop write path. A STANDALONE process (Node
 * built-in `http` only — zero deps), bound to its OWN port so it can never
 * collide with or disturb the dashboard on :3000.
 *
 *   >>> THIS GATEWAY STILL PERFORMS ZERO DATABASE WRITES. <<<
 *   It holds NO sqlite binding and NO `trevor.db` connection. It is a
 *   re-expressed OP-ALLOWLIST: it bearer-authes the caller, validates the op +
 *   args (gateway/ops.js), then FORWARDS the envelope to the VM-side gateway
 *   over Tailscale. The VM owns helper dispatch, the authoritative auto_config
 *   flag check, and the mandatory change_log audit. Until the VM gateway is
 *   deployed (separate VM-SSH'd paste), writes fail CLOSED with 502/504.
 *
 * Auth model: a single machine-to-machine bearer token (`GATEWAY_TOKEN`, a fresh
 * `openssl rand -hex 32`, stored in the gitignored `.env.local`, never printed,
 * never committed). This is intentionally SEPARATE from the dashboard's
 * `trevor_session` cookie auth (which is user-session). Requests without a valid
 * bearer token get 401.
 *
 * Routes:
 *   GET  /healthz        → 200 {"status":"ok"}  (UNAUTHENTICATED liveness probe — no bearer; reveals nothing else)
 *   GET  /gateway/health → 200 {"status":"ok","gateway":"live","writes_enabled":<vm-configured>}  (with valid bearer)
 *   POST /gateway/write  → op envelope {op,args,actor,source_type,reason,idempotency_key}
 *                          200 {ok,result} · 423 {gate} · 400 {validation|unknown_op} · 401 · 502/504
 *   (no token / bad token on any OTHER path) → 401
 *   (anything else)      → 404
 *
 * Run:  node gateway/server.js     (reads GATEWAY_ and VM_GATEWAY_ keys from .env.local)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getOp, opNames } = require("./ops");

// ---------------------------------------------------------------------------
// Minimal .env.local loader. A plain Node process does NOT auto-load .env.local
// the way Next.js does, so we parse the few keys we need ourselves. We only read
// GATEWAY_* here; we do not mutate process.env globally beyond these.
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf-8");
  } catch (e) {
    // No .env.local — return empty; startup guard below will fail loudly.
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal();
const PORT = parseInt(process.env.GATEWAY_PORT || env.GATEWAY_PORT || "3939", 10);
const HOST = "127.0.0.1"; // local-only; the VM-side gateway (C-P2) will bind the tailnet iface
const TOKEN = process.env.GATEWAY_TOKEN || env.GATEWAY_TOKEN || "";

// Fail loud rather than silently accept-all if the token is missing.
if (!TOKEN) {
  console.error(
    "[GATEWAY] FATAL: GATEWAY_TOKEN not set (.env.local). Refusing to start an unauthenticated gateway."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// W-C-P2a write path: forward target = the VM-side gateway, reached ONLY over
// Tailscale (ACL-locked, no nginx fallback, no public bind). The VM gateway
// itself is built + verified in a separate VM-SSH'd paste; until it is up,
// every write fails CLOSED with 502/504 (never a hang, never a non-tailnet
// route, never a direct DB write). The Hub gateway holds NO DB connection.
// ---------------------------------------------------------------------------
// NB: VM_GATEWAY_IP is the VM's TAILNET ip (e.g. 100.93.113.117) — deliberately
// SEPARATE from HUB_VM_IP, which middleware.ts uses for the VM's *public* host.
const VM_IP = process.env.VM_GATEWAY_IP || env.VM_GATEWAY_IP || "";
const VM_PORT = parseInt(process.env.VM_GATEWAY_PORT || env.VM_GATEWAY_PORT || "3940", 10);
const VM_TOKEN = process.env.VM_GATEWAY_TOKEN || env.VM_GATEWAY_TOKEN || "";
const VM_FORWARD_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 256 * 1024;

function vmConfigured() {
  return Boolean(VM_IP && VM_PORT && VM_TOKEN);
}
if (!vmConfigured()) {
  console.warn(
    "[GATEWAY] WARN: VM forward target not fully configured (need VM_GATEWAY_IP + VM_GATEWAY_PORT + VM_GATEWAY_TOKEN). " +
      "Write routes will fail CLOSED with 502 until the VM gateway is deployed."
  );
}

// Constant-time bearer check. Length-guard first so timingSafeEqual never throws
// on unequal-length buffers (which would itself leak length via an exception).
function tokenIsValid(presented) {
  if (typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractBearer(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// Read a JSON request body with a hard size cap (reject oversized payloads
// rather than buffering unbounded memory). Resolves with the parsed object or
// rejects with a tagged Error the caller maps to 400.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload_too_large"), { tag: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(Object.assign(new Error("invalid_json"), { tag: "invalid_json" }));
      }
    });
    req.on("error", () => reject(Object.assign(new Error("read_error"), { tag: "read_error" })));
  });
}

// Forward an op envelope to the VM gateway over Tailscale (plain HTTP — the
// tailnet is the encrypted transport; NEVER a public/non-tailnet route). Always
// RESOLVES (never rejects) with {status, body} so the request path can't crash:
//   timeout → 504 · connection error → 502 · VM 5xx → 502 · else pass through.
function forwardToVm(envelope) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(envelope), "utf-8");
    const options = {
      host: VM_IP,
      port: VM_PORT,
      path: "/gateway/write",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": payload.length,
        Authorization: `Bearer ${VM_TOKEN}`,
      },
      timeout: VM_FORWARD_TIMEOUT_MS,
    };
    let settled = false;
    const done = (status, body) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const reqVm = http.request(options, (resVm) => {
      let size = 0;
      const chunks = [];
      resVm.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          resVm.destroy();
          return;
        }
        chunks.push(c);
      });
      resVm.on("end", () => {
        const code = resVm.statusCode || 502;
        let body;
        try {
          const raw = Buffer.concat(chunks).toString("utf-8").trim();
          body = raw ? JSON.parse(raw) : {};
        } catch (_) {
          body = { raw: Buffer.concat(chunks).toString("utf-8").slice(0, 500) };
        }
        // Pass through 200/400/401/423/504; collapse any VM 5xx into 502.
        if (code >= 500 && code !== 504) {
          return done(502, { ok: false, error: "vm_gateway_error", upstream_status: code, upstream: body });
        }
        return done(code, body);
      });
    });
    reqVm.on("timeout", () => {
      reqVm.destroy();
      done(504, { ok: false, error: "vm_gateway_timeout" });
    });
    reqVm.on("error", () => {
      done(502, { ok: false, error: "vm_gateway_unreachable" });
    });
    reqVm.write(payload);
    reqVm.end();
  });
}

// POST /gateway/write — validate the op envelope HUB-side, then forward to the
// VM gateway (which owns helper dispatch + authoritative flag check + audit).
async function handleWrite(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    const tag = e && e.tag === "too_large" ? "payload_too_large" : "invalid_json";
    return sendJson(res, 400, { ok: false, error: tag });
  }

  const op = typeof body.op === "string" ? body.op : "";
  const spec = getOp(op);
  if (!spec) {
    return sendJson(res, 400, { ok: false, error: "unknown_op", op: op || null });
  }

  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
  const verr = spec.validate(args);
  if (verr) {
    return sendJson(res, 400, { ok: false, error: "validation", detail: verr, op });
  }

  // Re-stamp the envelope with a server-trusted idempotency key if absent.
  const envelope = {
    op,
    args,
    actor: typeof body.actor === "string" && body.actor ? body.actor : "hub:ui",
    source_type: typeof body.source_type === "string" && body.source_type ? body.source_type : "UI",
    reason: typeof body.reason === "string" ? body.reason : "",
    idempotency_key:
      typeof body.idempotency_key === "string" && body.idempotency_key ? body.idempotency_key : crypto.randomUUID(),
  };

  if (!vmConfigured()) {
    // Fail CLOSED — no VM target means no write can happen. Never fall back.
    return sendJson(res, 502, {
      ok: false,
      error: "vm_gateway_not_configured",
      note: "VM-side gateway not yet deployed; writes are disabled until it is.",
    });
  }

  const r = await forwardToVm(envelope);
  return sendJson(res, r.status, r.body);
}

const server = http.createServer((req, res) => {
  // Every path is wrapped so a thrown handler can never crash the process.
  try {
    const url = (req.url || "").split("?")[0];

    // --- Unauthenticated liveness probe (GET /healthz). Deliberately placed
    // BEFORE the auth gate so an external monitor can check up/down without
    // holding GATEWAY_TOKEN. Reveals NOTHING beyond "the process is serving":
    // no writes_enabled, no op count, no VM-forward config — those stay behind
    // the bearer on /gateway/health. ---
    if (req.method === "GET" && url === "/healthz") {
      return sendJson(res, 200, { status: "ok" });
    }

    // --- Auth gate: applies to ALL OTHER routes. No valid bearer → 401. ---
    if (!tokenIsValid(extractBearer(req))) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    // --- Health endpoint (authenticated). ---
    if (req.method === "GET" && url === "/gateway/health") {
      return sendJson(res, 200, {
        status: "ok",
        gateway: "live",
        write_route: true,
        ops: opNames().length,
        // writes_enabled here means only "is the VM forward target configured";
        // per-op enablement is enforced authoritatively VM-side via auto_config.
        writes_enabled: vmConfigured(),
      });
    }

    // --- Authenticated write path (op-allowlist → Tailscale forward). ---
    if (req.method === "POST" && url === "/gateway/write") {
      // Async handler — a rejection must never crash the process.
      handleWrite(req, res).catch(() => {
        try {
          sendJson(res, 500, { ok: false, error: "internal_error" });
        } catch (_) {
          /* response already partially sent */
        }
      });
      return;
    }

    // --- Anything else. ---
    return sendJson(res, 404, { error: "not_found" });
  } catch (e) {
    // Last-resort guard — never leak a stack, never crash.
    try {
      sendJson(res, 500, { error: "internal_error" });
    } catch (_) {
      /* response already partially sent; nothing more we can do safely */
    }
  }
});

server.on("error", (e) => {
  console.error(`[GATEWAY] server error: ${e && e.code ? e.code : e}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(
    `[GATEWAY] skeleton listening on http://${HOST}:${PORT} (writes_enabled=false, no DB)`
  );
});

// Clean shutdown on signals so a restart never leaves the port wedged.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
