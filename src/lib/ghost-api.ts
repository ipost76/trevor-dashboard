import { join } from "path";

const TREVOR_DIR = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
const PYTHON_PATH = join(TREVOR_DIR, "venv", "bin", "python3");
const SCRIPT_PATH = join(process.cwd(), "query_ghost.py");

export function ghostQuery(table: string, action: string, ...args: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require("child_process");
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\"'\"'")}'`);
  const cmd = `${PYTHON_PATH} ${SCRIPT_PATH} ${table} ${action} ${escaped.join(" ")}`;
  return execSync(cmd, {
    encoding: "utf-8",
    timeout: 15000,
    cwd: TREVOR_DIR,
    env: { ...process.env, HOME: "/home/trevor" },
  }).trim();
}

export function ghostJson(table: string, action: string, ...args: string[]) {
  return JSON.parse(ghostQuery(table, action, ...args));
}
