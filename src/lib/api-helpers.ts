import { join } from "path";

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

// killSignal:'SIGKILL' is load-bearing — see 2026-05-27 dashboard hang post-mortem.
// Node's default `killSignal: 'SIGTERM'` is catchable AND only kills the direct child.
// If the python child crashes BEFORE the timeout fires, or spawns a subprocess that
// inherits stdout/stderr, spawnSync stays blocked reading the orphaned pipes forever
// — even after the SIGTERM goes through, because the dead PID can't be signaled.
// SIGKILL is the only signal the kernel guarantees against an unkillable child.
// Documented Node behavior: https://github.com/nodejs/node/issues/20966

export function runPython(
  script: string,
  args: string[] = [],
  options?: { timeout?: number; cwd?: string; input?: string }
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require("child_process");
  const scriptPath = join(DASHBOARD_DIR, script);
  // spawnSync with argv array — NO shell, NO interpolation. User input can
  // safely contain $, backtick, quotes, newlines; it never reaches a shell.
  const result = spawnSync(PYTHON_PATH, [scriptPath, ...args], {
    encoding: "utf-8",
    timeout: options?.timeout ?? 10000,
    killSignal: "SIGKILL",
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    input: options?.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    const sig = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`python spawn failed${sig}: ${result.error.message || result.error}`);
  }
  if (result.signal) {
    // Killed by timeout (SIGKILL) — surface this as a distinct, diagnosable error
    throw new Error(`python killed by ${result.signal} (likely timeout ${options?.timeout ?? 10000}ms): ${script} ${args.join(" ")}`);
  }
  if (result.status !== 0) {
    throw new Error(`python exit=${result.status}: ${(result.stderr || "").slice(0, 500)}`);
  }
  return (result.stdout || "").trim();
}

// Run inline python source via stdin (python3 -). Untrusted values MUST be
// passed via the env map and read inside the code with os.environ.get(...),
// NEVER interpolated into the code string (which is Python-source injection).
export function runPythonInline(
  code: string,
  options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require("child_process");
  const result = spawnSync(PYTHON_PATH, ["-"], {
    encoding: "utf-8",
    timeout: options?.timeout ?? 5000,
    killSignal: "SIGKILL",
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor", ...(options?.env ?? {}) },
    input: code,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    const sig = result.signal ? ` signal=${result.signal}` : "";
    throw new Error(`python inline spawn failed${sig}: ${result.error.message || result.error}`);
  }
  if (result.signal) {
    throw new Error(`python inline killed by ${result.signal} (likely timeout ${options?.timeout ?? 5000}ms)`);
  }
  if (result.status !== 0) {
    throw new Error(`python exit=${result.status}: ${(result.stderr || "").slice(0, 500)}`);
  }
  return (result.stdout || "").trim();
}

// Retained for legacy callers. Prefer passing untrusted input as argv to
// runPython — this strip cannot be relied on as a primary defense.
export function sanitizeShellArg(input: string): string {
  return input.replace(/[;&|`$(){}[\]!#~<>\\]/g, "");
}
