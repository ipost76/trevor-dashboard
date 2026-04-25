"use client";

export default function ComingSoon({ feature, reason }: { feature: string; reason?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "60vh", padding: "2rem", textAlign: "center",
      color: "var(--text-secondary, #888)",
      fontFamily: "var(--font-mono, monospace)",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "var(--text-primary, #fff)" }}>
        {feature}
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 420, lineHeight: 1.5 }}>
        Coming soon{reason ? ` — ${reason}` : "."}
      </div>
    </div>
  );
}
