"use client";

import TabContainer from "@/components/TabContainer";
import SignalsPanel from "./panels/SignalsPanel";
import ResearchPanel from "./panels/ResearchPanel";
import TrainingPanel from "./panels/TrainingPanel";
import QualityPanel from "./panels/QualityPanel";

export default function IntelligencePage() {
  return (
    <TabContainer
      pageTitle="INTELLIGENCE"
      defaultTab="signals"
      tabs={[
        { id: "signals", label: "Signals", content: <SignalsPanel /> },
        { id: "research", label: "Research", content: <ResearchPanel /> },
        { id: "training", label: "Training", content: <TrainingPanel /> },
        { id: "quality", label: "Quality", content: <QualityPanel /> },
      ]}
    />
  );
}
