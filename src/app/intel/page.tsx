"use client";
import { useSearchParams } from "next/navigation";
import { Brain } from "lucide-react";
import { EmptyState, Card } from "@/components/ui";
import { ZONES } from "@/lib/navigation";

const INTEL_ZONE = ZONES.find((z) => z.id === "intel")!;

export default function IntelPage() {
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") ?? INTEL_ZONE.defaultSubTab ?? "lessons";
  const subLabel =
    INTEL_ZONE.subTabs?.find((s) => s.key === tab)?.label ?? "Lessons";

  return (
    <div className="p-4 md:p-6">
      <Card padding="lg">
        <EmptyState
          icon={<Brain size={36} />}
          title={`Intel · ${subLabel}`}
          body="Intelligence zone is being rebuilt in Wave F. Auto-extracted Lessons, Trade Journal, ChromaDB Similar-Trade lookup, Calibration deep-dive, and Shadow / Optuna surface land here."
        />
      </Card>
    </div>
  );
}
