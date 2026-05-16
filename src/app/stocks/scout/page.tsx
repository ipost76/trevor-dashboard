import { ScoutTabs } from "@/components/scout/scout-tabs";

// SCOUT data is live and changes during EOD pipeline runs; never cache.
export const dynamic = "force-dynamic";

export default function ScoutPage() {
  return <ScoutTabs />;
}
