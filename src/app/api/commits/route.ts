import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

type Commit = {
  hash: string;
  short_hash: string;
  date: string;
  author: string;
  subject: string;
};

let cached: { total: number; commits: Commit[] } | null = null;
let cacheTime = 0;

function loadCommits() {
  const now = Date.now();
  if (cached && now - cacheTime < 60_000) return cached;
  try {
    const raw = readFileSync(
      join(process.cwd(), "public", "commit-history.json"),
      "utf-8"
    );
    cached = JSON.parse(raw);
    cacheTime = now;
  } catch {
    cached = { total: 0, commits: [] };
  }
  return cached!;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const search = (searchParams.get("search") || "").toLowerCase().trim();

  const data = loadCommits();
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
