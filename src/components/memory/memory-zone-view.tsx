"use client";
import * as React from "react";
import { BrainSection } from "./brain-section";
import { MemorySection } from "./memory-section";
import { ChromaSection } from "./chroma-section";
import { HealthSection } from "./health-section";
import { AggressiveModeSection } from "./aggressive-section";

interface MemoryZoneViewProps {
  subtab: string;
}

export function MemoryZoneView({ subtab }: MemoryZoneViewProps) {
  const content = (() => {
    switch (subtab) {
      case "memory":
        return <MemorySection />;
      case "chromadb":
        return <ChromaSection />;
      case "health":
        return <HealthSection />;
      case "aggressive":
        return <AggressiveModeSection />;
      case "brain":
      default:
        return <BrainSection />;
    }
  })();

  return <div className="mx-auto w-full max-w-screen-2xl">{content}</div>;
}
