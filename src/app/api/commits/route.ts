import { NextRequest, NextResponse } from "next/server";
import { runCommand } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

type Commit = {
  hash: string;
  short_hash: string;
  date: string;
  author: string;
  subject: string;
};

const REPO_DIR = "/home/trevor/trevor";

// RM-DASH 2026-05-29: single-flight + SWR (60s) on the full git-log load so a
// cold-cache burst spawns ONE `git log` per window, not N. Only the upstream load
// is cached; the per-request filter/paginate derive stays outside the cache. The
// catch below preserves the prior contract: cold failure → {total:0,commits:[]},
// while SWR keeps serving the last good list across a transient git failure.
const commitsCache = createSwrCache<{ total: number; commits: Commit[] }>({
  defaultTtl: 60_000,
  concurrency: 2,
});

async function loadCommits(): Promise<{ total: number; commits: Commit[] }> {
  try {
    const { value } = await commitsCache.swr("commits", async () => {
      // argv (no shell) — the --format token is one element, no quoting needed.
      const raw = await runCommand(
        "git",
        ["-C", REPO_DIR, "log", "--format=%H|%h|%aI|%an|%s", "--no-merges"],
        { timeout: 10_000 }
      );
      const commits: Commit[] = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, short_hash, date, author, ...rest] = line.split("|");
          return { hash, short_hash, date, author, subject: rest.join("|") };
        });
      return { total: commits.length, commits };
    });
    return value;
  } catch {
    return { total: 0, commits: [] };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const search = (searchParams.get("search") || "").toLowerCase().trim();

  const data = await loadCommits();
  let filtered = data.commits;

  if (search) {
    filtered = filtered.filter(
      (c) =>
        c.hash.toLowerCase().includes(search) ||
        c.short_hash.toLowerCase().includes(search) ||
        c.subject.toLowerCase().includes(search) ||
        c.author.toLowerCase().includes(search)
    );
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const commits = filtered.slice(start, start + limit);

  return NextResponse.json({ total, page, total_pages: totalPages, commits });
}
