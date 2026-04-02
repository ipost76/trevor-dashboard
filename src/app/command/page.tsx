"use client";

import TabContainer from "@/components/TabContainer";
import ControlPanelPanel from "./panels/ControlPanelPanel";
import GhostHQPanel from "./panels/GhostHQPanel";
import RemindersPanel from "./panels/RemindersPanel";
import DevTasksPanel from "./panels/DevTasksPanel";

export default function CommandPage() {
  return (
    <TabContainer
      pageTitle="COMMAND"
      defaultTab="control"
      tabs={[
        { id: "control", label: "Control Panel", content: <ControlPanelPanel /> },
        { id: "ghosthq", label: "Ghost HQ", content: <GhostHQPanel /> },
        { id: "reminders", label: "Reminders", content: <RemindersPanel /> },
        { id: "devtasks", label: "Dev Tasks", content: <DevTasksPanel /> },
      ]}
    />
  );
}
