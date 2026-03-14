import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

type CronJob = {
  enabled: boolean;
  schedule?: string;
  interval_minutes?: number;
  description: string;
  handler: string;
};

function parseNextRun(schedule: string): string {
  // Simple cron next-run calculator for "min hour * * dow" patterns
  const parts = schedule.split(/\s+/);
  if (parts.length < 5) return "Unknown";

  const [minField, hourField, , , dowField] = parts;
  const now = new Date();
  const nowUTC = new Date(now.toISOString());

  // Parse values
  const targetMin = minField === "*" ? -1 : parseInt(minField);
  const targetHour = hourField === "*" ? -1 : parseInt(hourField);

  // Parse DOW (0=Sun, 1-5=Mon-Fri, 6=Sat)
  let allowedDows: number[] = [];
  if (dowField === "*") {
    allowedDows = [0, 1, 2, 3, 4, 5, 6];
  } else if (dowField.includes("-")) {
    const [start, end] = dowField.split("-").map(Number);
    for (let i = start; i <= end; i++) allowedDows.push(i);
  } else {
    allowedDows = dowField.split(",").map(Number);
  }

  // Find next occurrence (search up to 8 days ahead)
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(nowUTC);
    candidate.setUTCDate(candidate.getUTCDate() + dayOffset);

    if (!allowedDows.includes(candidate.getUTCDay())) continue;

    const h = targetHour === -1 ? (dayOffset === 0 ? nowUTC.getUTCHours() : 0) : targetHour;
    const m = targetMin === -1 ? 0 : targetMin;

    candidate.setUTCHours(h, m, 0, 0);

    if (candidate > nowUTC) {
      // Convert UTC to ET (approximate: UTC-4 EDT or UTC-5 EST)
      const etOffset = -4; // EDT
      const et = new Date(candidate.getTime() + etOffset * 60 * 60 * 1000);
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][et.getDay()];
      return `${dayName} ${et.getHours().toString().padStart(2, "0")}:${et.getMinutes().toString().padStart(2, "0")} ET`;
    }
  }

  return "Calculating...";
}

export async function GET() {
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const configPath = join(trevorDir, "cron_schedule.json");

  try {
    const fs = await import("fs");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);

    const jobs = Object.entries(config.jobs as Record<string, CronJob>).map(([name, job]) => ({
      name,
      enabled: job.enabled,
      schedule: job.schedule || `every ${job.interval_minutes}min`,
      description: job.description,
      handler: job.handler,
      nextRun: job.schedule ? parseNextRun(job.schedule) : `~${job.interval_minutes}min`,
    }));

    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json({ jobs: [], error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const jobName = body.job_name;
    const enabled = body.enabled;

    if (!jobName || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "job_name (string) and enabled (boolean) required" },
        { status: 400 }
      );
    }

    const raw = runPython("manage_schedule.py", [
      "toggle",
      jobName,
      String(enabled),
    ]);
    const result = safeJsonParse(raw, { error: "Failed to parse response" });

    if (result.error) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const jobName = body.job_name;

    if (!jobName) {
      return NextResponse.json(
        { error: "job_name required" },
        { status: 400 }
      );
    }

    const raw = runPython("manage_schedule.py", ["trigger", jobName]);
    const result = safeJsonParse(raw, { error: "Failed to parse response" });

    if (result.error) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
