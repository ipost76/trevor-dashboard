import { HealthSection } from "@/components/memory/health-section";

// B4 — top-level "Health" home. Renders the same <HealthSection> as the
// /memory?tab=health deep link (which is preserved). The centering wrapper
// mirrors MemoryZoneView's outer `mx-auto w-full max-w-screen-2xl` so the
// standalone page matches the dispatcher layout.
export default function HealthPage() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <HealthSection />
    </div>
  );
}
