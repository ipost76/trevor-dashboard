#!/usr/bin/env node
/**
 * TREVOR Hub — Write-Gateway SKELETON  [W-C-P1, build C-P1-GW-SKEL]
 * ----------------------------------------------------------------------------
 * Machine-to-machine auth harness for the write path. This is the TrevorHub-SIDE
 * skeleton used to prove the bearer-token auth layer in isolation. It is a
 * STANDALONE process (Node built-in `http` only — zero deps), bound to its OWN
 * port so it can never collide with or disturb the dashboard on :3000.
 *
 *   >>> THIS SKELETON PERFORMS ZERO DATABASE WRITES. <<<
 *   No sqlite binding, no `trevor.db` connection, no write logic, no VM call.
 *   The real write routes (and the gateway that runs ON the VM) are W-C-P2's job.
 *
 * Auth model: a single machine-to-machine bearer token (`GATEWAY_TOKEN`, a fresh
 * `openssl rand -hex 32`, stored in the gitignored `.env.local`, never printed,
 * never committed). This is intentionally SEPARATE from the dashboard's
 * `trevor_session` cookie auth (which is user-session). Requests without a valid
 * bearer token get 401.
 *
 * Routes:
 *   GET /gateway/health  → 200 {"status":"ok","gateway":"skeleton","writes_enabled":false}  (with valid bearer)
 *   (no token / bad token on any path) → 401
 *   (anything else)      → 404
 *
 * Run:  node gateway/server.js     (reads GATEWAY_PORT/GATEWAY_TOKEN from .env.local)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const server = http.createServer((req, res) => {
  // Every path is wrapped so a thrown handler can never crash the process.
  try {
    // --- Auth gate: applies to ALL routes. No valid bearer → 401. ---
    if (!tokenIsValid(extractBearer(req))) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    const url = (req.url || "").split("?")[0];

    // --- Health endpoint (authenticated). ---
    if (req.method === "GET" && url === "/gateway/health") {
      return sendJson(res, 200, {
        status: "ok",
        gateway: "skeleton",
        writes_enabled: false,
      });
    }

    // =====================================================================
    // W-C-P2 WILL ADD WRITE ROUTES HERE
    // -----------------------------------------------------------------
    // Intentionally empty in W-C-P1: NO routes, NO `trevor.db` connection,
    // NO write logic. C-P2 bolts the authenticated write handlers onto this
    // proven auth layer (and the production gateway runs ON the VM).
    // =====================================================================

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
