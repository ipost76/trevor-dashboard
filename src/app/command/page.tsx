"use client";

import TabContainer from "@/components/TabContainer";
import ControlPanelPanel from "./panels/ControlPanelPanel";

export default function CommandPage() {
  return (
    <TabContainer
      pageTitle="COMMAND"
      defaultTab="control"
      tabs={[
        { id: "control", label: "Control Panel", content: <ControlPanelPanel /> },
      ]}
    />
  );
}
