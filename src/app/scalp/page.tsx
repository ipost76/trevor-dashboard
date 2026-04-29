"use client";
import { useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import { EmptyState, Card } from "@/components/ui";
import { ZONES } from "@/lib/navigation";

const SCALP_ZONE = ZONES.find((z) => z.id === "scalp")!;

export default function ScalpPage() {
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") ?? SCALP_ZONE.defaultSubTab ?? "live-board";
  const subLabel =
    SCALP_ZONE.subTabs?.find((s) => s.key === tab)?.label ?? "Live Board";

  return (
    <div className="p-4 md:p-6">
      <Card padding="lg">
        <EmptyState
          icon={<Activity size={36} />}
          title={`Scalp · ${subLabel}`}
          body="Scalp zone is being rebuilt in Wave E. Live Board, Recent Signals, Quality, and Calibration sub-tabs will land here. AutoTrader (Auto zone) remains live and unaffected."
        />
      </Card>
    </div>
  );
}
