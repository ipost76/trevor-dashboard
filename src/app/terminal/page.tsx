"use client";
import dynamic from "next/dynamic";

function TerminalLoading() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d1117",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#58a6ff",
          animation: "termPulse 1.5s ease-in-out infinite",
        }}
      />
      <span style={{ color: "#8b949e", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
        Connecting to trevor-prime...
      </span>
      <style>{`@keyframes termPulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}

const TerminalView = dynamic(
  () => import("@/components/terminal/TerminalView").then((m) => ({ default: m.TerminalView })),
  { ssr: false, loading: () => <TerminalLoading /> }
);

export default function TerminalPage() {
  return <TerminalView />;
}
