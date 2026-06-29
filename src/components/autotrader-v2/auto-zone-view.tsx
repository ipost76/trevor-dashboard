"use client";
import * as React from "react";
import { DashboardTab } from "./dashboard-tab";
import { RecentTab } from "./recent-tab";
import { ActivityTab } from "./activity-tab";

interface AutoZoneViewProps {
  subtab: string;
}

export function AutoZoneView({ subtab }: AutoZoneViewProps) {
  switch (subtab) {
    case "recent":
      return <RecentTab />;
    case "activity":
      return <ActivityTab />;
    case "dashboard":
    default:
      return <DashboardTab />;
  }
}
