import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded bg-[rgba(255,170,0,0.08)] border border-[rgba(255,170,0,0.2)]">
          <AlertTriangle className="h-8 w-8 text-[var(--neon-amber)]" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-[0.1em] uppercase text-[var(--neon-amber)] mb-1">
            404 // NOT FOUND
          </h2>
          <p className="text-[11px] text-muted-foreground">
            The requested route does not exist.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="btn-primary flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em]"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
