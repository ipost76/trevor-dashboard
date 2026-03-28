#!/usr/bin/env node
/**
 * TREVOR Hub — Custom Server
 * Serves Next.js on port 3333 + WebSocket terminal on /ws/terminal
 */

const http = require("http");
const next = require("next");
const { parse } = require("url");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const PORT = parseInt(process.env.PORT || "3333", 10);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SALT = process.env.SESSION_SALT || "trevor-mc-2025";
const MAX_SESSIONS = 3;
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const PING_INTERVAL_MS = 30 * 1000; // 30 seconds

// ── Auth ──────────────────────────────────────────────────────────────────────
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [key, ...rest] = c.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  });
  return cookies;
}

function validateToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    return parts.length === 3 && parts[2] === SESSION_SALT;
  } catch {
    return false;
  }
}

// ── Session tracking ──────────────────────────────────────────────────────────
const sessions = new Map(); // id → { ws, pty, lastActivity, pingInterval, idleTimer }
let sessionCounter = 0;

function cleanupSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearInterval(s.pingInterval);
  clearTimeout(s.idleTimer);
  try { s.pty.kill(); } catch {}
  try {
    if (s.ws.readyState <= 1) s.ws.close();
  } catch {}
  sessions.delete(id);
  console.log(`[TERMINAL] Session ${id} cleaned up (${sessions.size} active)`);
}

// ── Next.js setup ─────────────────────────────────────────────────────────────
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // ── WebSocket server (noServer mode) ──────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url, true);

    if (pathname !== "/ws/terminal") {
      socket.destroy();
      return;
    }

    // Auth check
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies["trevor_session"] || "";
    if (!token || !validateToken(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      console.log("[TERMINAL] Auth rejected — invalid or missing cookie");
      return;
    }

    // Session limit
    if (sessions.size >= MAX_SESSIONS) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(4002, "Max sessions reached");
      });
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const id = ++sessionCounter;
    console.log(`[TERMINAL] Session ${id} opened (${sessions.size + 1} active)`);

    // Spawn PTY
    const term = pty.spawn("/bin/bash", ["--login"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: "/home/trevor/trevor",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
      },
    });

    let lastActivity = Date.now();

    // Idle timeout
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[TERMINAL] Session ${id} idle timeout`);
        try {
          ws.send(JSON.stringify({ type: "exit", code: -1, reason: "idle" }));
        } catch {}
        cleanupSession(id);
      }
    }, 60000);

    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
      }
    }, PING_INTERVAL_MS);

    sessions.set(id, { ws, pty: term, lastActivity, pingInterval, idleTimer });

    // PTY → WebSocket
    term.onData((data) => {
      lastActivity = Date.now();
      if (sessions.has(id)) sessions.get(id).lastActivity = lastActivity;
      if (ws.readyState === 1) {
        try { ws.send(data); } catch {}
      }
    });

    // PTY exit
    term.onExit(({ exitCode }) => {
      console.log(`[TERMINAL] PTY exited (session ${id}, code ${exitCode})`);
      if (ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: "exit", code: exitCode })); } catch {}
      }
      cleanupSession(id);
    });

    // WebSocket → PTY
    ws.on("message", (msg) => {
      lastActivity = Date.now();
      if (sessions.has(id)) sessions.get(id).lastActivity = lastActivity;

      const str = typeof msg === "string" ? msg : msg.toString();
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          term.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
          return;
        }
        if (parsed.type === "pong") return;
      } catch {
        // Not JSON — raw keystroke data
      }
      term.write(str);
    });

    // WebSocket close
    ws.on("close", () => {
      console.log(`[TERMINAL] WS closed (session ${id})`);
      cleanupSession(id);
    });

    ws.on("error", (err) => {
      console.error(`[TERMINAL] WS error (session ${id}):`, err.message);
      cleanupSession(id);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[HUB] TREVOR Hub ready on http://${HOST}:${PORT}`);
    console.log(`[HUB] Terminal WebSocket at ws://${HOST}:${PORT}/ws/terminal`);
  });
});
