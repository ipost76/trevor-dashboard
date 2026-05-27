"use client";
import * as React from "react";
import { DashboardTab } from "./dashboard-tab";
import { RecentTab } from "./recent-tab";
import { ConfigTab } from "./config-tab";
import { ControlTab } from "./control-tab";
import { ActivityTab } from "./activity-tab";

interface AutoZoneViewProps {
  subtab: string;
}

export function AutoZoneView({ subtab }: AutoZoneViewProps) {
  switch (subtab) {
    case "recent":
      return <RecentTab />;
    case "config":
      return <ConfigTab />;
    case "control":
      return <ControlTab />;
    case "activity":
      return <ActivityTab />;
    case "dashboard":
    default:
      return <DashboardTab />;
  }
}
