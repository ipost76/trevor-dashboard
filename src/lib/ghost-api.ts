import { join } from "path";

const TREVOR_DIR = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
const PYTHON_PATH = join(TREVOR_DIR, "venv", "bin", "python3");
const SCRIPT_PATH = join(process.cwd(), "query_ghost.py");

export function ghostQuery(table: string, action: string, ...args: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require("child_process");
  // spawnSync with argv — NO shell. All args pass through as literal strings.
  const result = spawnSync(PYTHON_PATH, [SCRIPT_PATH, table, action, ...args], {
    encoding: "utf-8",
    timeout: 15000,
    cwd: TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ghost_api python exit=${result.status}: ${(result.stderr || "").slice(0, 500)}`);
  }
  return (result.stdout || "").trim();
}

export function ghostJson(table: string, action: string, ...args: string[]) {
  return JSON.parse(ghostQuery(table, action, ...args));
}
