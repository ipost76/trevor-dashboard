"use client";
import * as React from "react";
import { LessonsSection } from "./lessons-section";
import { JournalSection } from "./journal-section";
import { Card, EmptyState } from "@/components/ui";
import { Brain } from "lucide-react";

interface IntelZoneViewProps {
  subtab: string;
}

export function IntelZoneView({ subtab }: IntelZoneViewProps) {
  switch (subtab) {
    case "lessons":
      return <LessonsSection />;
    case "journal":
      return <JournalSection />;
    case "similar":
    case "calibration":
    case "shadow":
    default:
      return (
        <div className="p-4 md:p-6 lg:px-8 animate-fade-in">
          <Card padding="lg">
            <EmptyState
              icon={<Brain size={36} />}
              title={`Intel · ${capitalize(subtab)}`}
              body="Coming next in the redesign sprint."
            />
          </Card>
        </div>
      );
  }
}

function capitalize(s: string): string {
  if (!s) return "Lessons";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
