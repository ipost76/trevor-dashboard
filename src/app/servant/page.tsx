import { ServantSection } from "@/components/servant/servant-section";

export const dynamic = "force-dynamic";

// SERVANT (Edge-Hunter, B5) — top-level single-view bottom-nav zone, between AUTO
// and INTEL. Ghost reads the edge-hunter's ranked findings (servant_findings,
// handled=0, READ-ONLY over the litestream replica), downloads the rolling .md to
// take into a Claude.ai chat, and hits reset once he's addressed it. The reset
// round-trips to the VM (the engine owns the write); the Hub never writes the
// replica. Styled to match the Intel DAILY EDGE tab. The centering wrapper mirrors
// the other zone pages' `mx-auto w-full max-w-screen-2xl`.
export default function ServantPage() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <ServantSection />
    </div>
  );
}
