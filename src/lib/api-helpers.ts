import { join } from "path";
import { spawn } from "child_process";

export const TREVOR_DIR = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
export const DB_PATH = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
export const PYTHON_PATH = join(TREVOR_DIR, "venv", "bin", "python3");
export const DASHBOARD_DIR = process.cwd();

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// safeDecodeSegment — the guard for a dynamic route segment.  [B4, 2026-08-01]
//
// 🚨 Next hands the dynamic segment ALREADY DECODED, so a request for `%25`
// arrives at the handler as a bare `%` — and `decodeURIComponent("%")` THROWS
// URIError. Unguarded, that escapes the handler as an unstructured HTTP 500:
// measured on five routes before this fix, `%25`, `%2` and `%E0%A4%A` all
// returned 500 with an empty or "Internal Server Error" body.
//
// A malformed segment is a CLIENT error. It must not be indistinguishable from
// a genuine server failure — that is the whole point of the guard, not merely
// suppressing a stack trace.
//
// The malformed value is passed through UNCHANGED rather than repaired or
// blanked, so the caller's own shape check (a DATE_RE, a filename test) is what
// rejects it and decides the 400. This function never decides a status.
//
// ⚠️ ORIGIN AND THE ONE DELIBERATE DEVIATION. D2 (2026-07-31) authored this as
// a file-local `safeDecode` inside api/health/digests/[date]/route.ts for the
// DELETE path, and its semantics are reproduced here EXACTLY. What changed is
// the location, not the behaviour: five routes carry the identical defect, and
// five copies of one guard is the same "two copies of one fact" failure that a
// shared fix exists to prevent — the next correction would land in one copy and
// silently not the others. One guard, one style, five call sites.
// ─────────────────────────────────────────────────────────────────────────────
export function safeDecodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC child-process bridge (2026-05-29 — RM-DASH async-bridge wave).
//
// HISTORY / WHY ASYNC: the prior bridge was SYNCHRONOUS, which BLOCKS the single
// Node event loop until the child closes its stdout pipe. A 2026-05-27 fix added
// `killSignal:'SIGKILL'` to kill an unkillable DIRECT child on timeout — but the
// loop still wedged for ~8 minutes on 2026-05-29. Root cause: SIGKILL reaps the
// tracked child PID, NOT a GRANDCHILD that inherited the stdout pipe fd. The
// synchronous read keeps blocking on the pipe until EOF (all write ends closed),
// which never comes while the grandchild holds it — defeating the timeout entirely.
//
// THE FIX (three load-bearing parts):
//   1. async streaming spawn (the non-blocking child-process API) — a slow/hung
//      child can never block the loop.
//   2. `detached:true` → the child is its own process-group LEADER (pgid==pid), so
//      `process.kill(-pid,'SIGKILL')` on timeout reaps the WHOLE group, grandchildren
//      included. This is what the 2026-05-27 SIGKILL-on-direct-child fix could not do.
//   3. `stdio:['pipe','pipe','pipe']` — we read the child's stdout/stderr; grandchildren
//      do NOT inherit our (the parent Node process's) stdout, so a leaked write end can
//      never wedge OUR process. Combined with async, EOF-wait can't block the loop.
//   Node sync-child orphaned-pipe bug for reference: https://github.com/nodejs/node/issues/20966
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB, matches the old sync cap

export interface SpawnResult {
  stdout: string;
  stderr: string;
  status: number | null; // exit code (null when killed by signal)
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  bufferExceeded: boolean;
}

interface SpawnAsyncOptions {
  timeout: number;
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

/**
 * Core async spawn. Resolves with a structured result on close; rejects only on a
 * genuine spawn error (ENOENT etc). NEVER blocks the event loop. On timeout it
 * SIGKILLs the entire process group so grandchildren cannot keep the pipes open.
 */
function spawnAsync(
  file: string,
  args: string[],
  options: SpawnAsyncOptions
): Promise<SpawnResult> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true, // new process group → group-kill reaps grandchildren
      stdio: ["pipe", "pipe", "pipe"], // we pipe; children do NOT inherit our stdio
    });

    let stdout = "";
    let stderr = "";
    let outLen = 0;
    let errLen = 0;
    let timedOut = false;
    let bufferExceeded = false;
    let settled = false;

    const killGroup = () => {
      // negative pid = whole process group (requires detached:true). Guard ESRCH
      // (group already gone). Fall back to a direct child.kill as belt-and-suspenders.
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "ESRCH") {
          /* best-effort; swallow */
        }
      }
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeout);

    child.stdout.on("data", (d: Buffer) => {
      outLen += d.length;
      if (outLen <= maxBuffer) {
        stdout += d.toString("utf-8");
      } else if (!bufferExceeded) {
        bufferExceeded = true;
        killGroup();
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      errLen += d.length;
      if (errLen <= maxBuffer) {
        stderr += d.toString("utf-8");
      } else if (!bufferExceeded) {
        bufferExceeded = true;
        killGroup();
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // 'close' fires after the process exits AND all stdio pipes are closed. The
    // timeout guarantees we never wait forever; on timeout the group-kill closes
    // the pipes, so 'close' still fires (with timedOut=true).
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        status: code,
        signal: signal as NodeJS.Signals | null,
        timedOut,
        bufferExceeded,
      });
    });

    // Feed stdin (for `python3 -` style inline code) then close it.
    if (child.stdin) {
      if (options.input !== undefined) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    }
  });
}

/**
 * Run a Python helper script under TREVOR's venv, async. Returns trimmed stdout.
 * THROWS on timeout / signal / non-zero exit / maxBuffer breach — drop-in async
 * replacement for the old sync runPython (callers now MUST `await` it).
 *
 * argv array — NO shell, NO interpolation. User input can safely contain $, backtick,
 * quotes, newlines; it never reaches a shell.
 */
export async function runPython(
  script: string,
  args: string[] = [],
  options?: { timeout?: number; cwd?: string; input?: string }
): Promise<string> {
  const scriptPath = join(DASHBOARD_DIR, script);
  const timeout = options?.timeout ?? 10000;
  const res = await spawnAsync(PYTHON_PATH, [scriptPath, ...args], {
    timeout,
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    input: options?.input,
  });
  if (res.bufferExceeded) {
    throw new Error(`python exceeded maxBuffer (${DEFAULT_MAX_BUFFER} bytes): ${script} ${args.join(" ")}`);
  }
  if (res.timedOut) {
    throw new Error(`python killed by SIGKILL (timeout ${timeout}ms): ${script} ${args.join(" ")}`);
  }
  if (res.signal) {
    throw new Error(`python killed by ${res.signal}: ${script} ${args.join(" ")}`);
  }
  if (res.status !== 0) {
    throw new Error(`python exit=${res.status}: ${(res.stderr || "").slice(0, 500)}`);
  }
  return (res.stdout || "").trim();
}

/**
 * Like runPython but NEVER throws on a non-zero exit — returns the structured
 * result so callers can map exit codes → HTTP status (e.g. 0→200, 1→400, 3→423).
 * Mirrors the shape of the old synchronous result the write routes inspected.
 * Still throws (rejects) on a genuine spawn error (ENOENT etc).
 */
export async function runPythonResult(
  script: string,
  args: string[] = [],
  options?: { timeout?: number; cwd?: string; input?: string }
): Promise<SpawnResult> {
  const scriptPath = join(DASHBOARD_DIR, script);
  return spawnAsync(PYTHON_PATH, [scriptPath, ...args], {
    timeout: options?.timeout ?? 10000,
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    input: options?.input,
  });
}

// Run inline python source via stdin (python3 -), async. Untrusted values MUST be
// passed via the env map and read inside the code with os.environ.get(...), NEVER
// interpolated into the code string (which is Python-source injection).
export async function runPythonInline(
  code: string,
  options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
): Promise<string> {
  const timeout = options?.timeout ?? 5000;
  const res = await spawnAsync(PYTHON_PATH, ["-"], {
    timeout,
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor", ...(options?.env ?? {}) },
    input: code,
  });
  if (res.bufferExceeded) {
    throw new Error(`python inline exceeded maxBuffer (${DEFAULT_MAX_BUFFER} bytes)`);
  }
  if (res.timedOut) {
    throw new Error(`python inline killed by SIGKILL (timeout ${timeout}ms)`);
  }
  if (res.signal) {
    throw new Error(`python inline killed by ${res.signal}`);
  }
  if (res.status !== 0) {
    throw new Error(`python exit=${res.status}: ${(res.stderr || "").slice(0, 500)}`);
  }
  return (res.stdout || "").trim();
}

/**
 * Run a non-Python command (git, tail, pgrep, …) via argv — NO shell, async.
 * Returns trimmed stdout. By default throws on non-zero exit; pass
 * `allowFailure:true` to return whatever stdout was produced (e.g. for a best-effort
 * `tail` that may exit non-zero on a missing file).
 */
export async function runCommand(
  file: string,
  args: string[] = [],
  options?: { timeout?: number; cwd?: string; allowFailure?: boolean; env?: NodeJS.ProcessEnv }
): Promise<string> {
  const timeout = options?.timeout ?? 5000;
  const res = await spawnAsync(file, args, {
    timeout,
    cwd: options?.cwd ?? DASHBOARD_DIR,
    env: options?.env ?? process.env,
  });
  if (res.bufferExceeded) {
    throw new Error(`command exceeded maxBuffer: ${file} ${args.join(" ")}`);
  }
  if (res.timedOut) {
    throw new Error(`command killed by SIGKILL (timeout ${timeout}ms): ${file}`);
  }
  if (!options?.allowFailure) {
    if (res.signal) throw new Error(`command killed by ${res.signal}: ${file}`);
    if (res.status !== 0) {
      throw new Error(`command exit=${res.status}: ${(res.stderr || "").slice(0, 500)}`);
    }
  }
  return (res.stdout || "").trim();
}

// Retained for legacy callers. Prefer passing untrusted input as argv to
// runPython — this strip cannot be relied on as a primary defense.
export function sanitizeShellArg(input: string): string {
  return input.replace(/[;&|`$(){}[\]!#~<>\\]/g, "");
}
