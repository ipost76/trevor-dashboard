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
  options?: { timeout?: number; cwd?: string }
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require("child_process");
  const scriptPath = join(DASHBOARD_DIR, script);
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\"'\"'")}'`);
  const cmd = `${PYTHON_PATH} ${scriptPath} ${escapedArgs.join(" ")}`;
  return execSync(cmd, {
    encoding: "utf-8",
    timeout: options?.timeout ?? 15000,
    cwd: options?.cwd ?? TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
  }).trim();
}

export function sanitizeShellArg(input: string): string {
  return input.replace(/[;&|`$(){}[\]!#~<>\\]/g, "");
}
