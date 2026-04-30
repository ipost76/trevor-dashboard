import { ScalperViewV2 } from "@/components/autotrader-v2/scalper-view";

export const dynamic = "force-dynamic";

interface AutotraderPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AutotraderPage({
  searchParams,
}: AutotraderPageProps) {
  const { tab } = await searchParams;
  return <ScalperViewV2 subtab={tab ?? "scalper"} />;
}
