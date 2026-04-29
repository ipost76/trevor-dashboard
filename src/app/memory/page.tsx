"use client";
import { useSearchParams } from "next/navigation";
import { Database } from "lucide-react";
import { EmptyState, Card } from "@/components/ui";
import { ZONES } from "@/lib/navigation";

const MEMORY_ZONE = ZONES.find((z) => z.id === "memory")!;

export default function MemoryPage() {
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") ?? MEMORY_ZONE.defaultSubTab ?? "brain";
  const subLabel =
    MEMORY_ZONE.subTabs?.find((s) => s.key === tab)?.label ?? "Brain";

  return (
    <div className="p-4 md:p-6">
      <Card padding="lg">
        <EmptyState
          icon={<Database size={36} />}
          title={`Memory · ${subLabel}`}
          body="Memory zone replaces the old Command tab. Brain Files / Memory Journal / ChromaDB / System Health / Aggressive Mode controls land here in Wave G."
        />
      </Card>
    </div>
  );
}
