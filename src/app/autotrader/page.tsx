import { AutoZoneView } from "@/components/autotrader-v2/auto-zone-view";

export const dynamic = "force-dynamic";

interface AutotraderPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AutotraderPage({ searchParams }: AutotraderPageProps) {
  const { tab } = await searchParams;
  return <AutoZoneView subtab={tab ?? "dashboard"} />;
}
