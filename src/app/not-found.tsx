import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded"
          style={{
            background: "rgba(212,166,74,0.08)",
            border: "1px solid var(--color-accent-gold-subtle)",
          }}
        >
          <AlertTriangle className="h-8 w-8 text-accent-gold-strong" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-label-ui text-accent-gold-strong mb-1" style={{ fontSize: "13px", letterSpacing: "0.1em" }}>
            404 // NOT FOUND
          </h2>
          <p className="text-caption-ui text-fg-muted">
            The requested route does not exist.
          </p>
        </div>
        <Link
          href="/autotrader"
          className="text-label-ui rounded px-4 py-2 transition-all duration-fast"
          style={{
            background: "rgba(95,180,204,0.1)",
            border: "1px solid var(--color-accent-cyan-soft)",
            color: "var(--color-accent-cyan-soft-strong)",
          }}
        >
          Return to AutoTrader
        </Link>
      </div>
    </div>
  );
}
