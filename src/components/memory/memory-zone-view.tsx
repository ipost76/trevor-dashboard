"use client";
import * as React from "react";
import { Card, EmptyState } from "@/components/ui";
import { Activity } from "lucide-react";
import { BrainSection } from "./brain-section";
import { MemorySection } from "./memory-section";
import { ChromaSection } from "./chroma-section";

interface MemoryZoneViewProps {
  subtab: string;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function MemoryZoneView({ subtab }: MemoryZoneViewProps) {
  switch (subtab) {
    case "brain":
      return <BrainSection />;
    case "memory":
      return <MemorySection />;
    case "chromadb":
      return <ChromaSection />;
    case "health":
    case "aggressive":
    default:
      return (
        <div className="p-4 md:p-6 lg:px-8 animate-fade-in">
          <Card padding="lg">
            <EmptyState
              icon={<Activity size={36} />}
              title={`Memory · ${capitalize(subtab || "brain")}`}
              body="Coming next in Wave G2."
            />
          </Card>
        </div>
      );
  }
}
