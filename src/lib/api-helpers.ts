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
    timeout: options?.timeout ?? 15000,
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    input: options?.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
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
