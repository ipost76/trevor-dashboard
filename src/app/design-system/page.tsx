"use client";
import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  SegmentedToggle,
  TabBar,
  EmptyState,
  Skeleton,
  LivePulse,
  MoneyText,
  BottomSheet,
  HapticButton,
  KillswitchPill,
} from "@/components/ui";
import { Activity } from "lucide-react";

type System = "auto" | "scalp";
type DemoTab = "a" | "b" | "c";

export default function DesignSystemShowcasePage() {
  const [system, setSystem] = useState<System>("auto");
  const [tab, setTab] = useState<DemoTab>("a");
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="min-h-screen space-y-8 p-4 md:p-8">
      <header className="space-y-2">
        <div className="text-micro text-fg-muted">TREVOR // DESIGN SYSTEM v1</div>
        <h1 className="text-h1">Component primitives</h1>
        <p className="text-caption text-fg-muted">
          Mobile-first preview. Resize browser to test breakpoints
          (xs 375 / sm 640 / mm 430 / md 768 / lg 1024 / xl 1280). Tailwind v4
          defaults preserved for sm/md/lg/xl; only xs and mm are A4 additions.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LivePulse tone="cyan" label="Live" />
          <KillswitchPill />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-h2">Cards</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Default</CardTitle>
            </CardHeader>
            Standard card body.
          </Card>
          <Card glow="cyan">
            <CardHeader>
              <CardTitle>Glow Cyan</CardTitle>
            </CardHeader>
            Primary highlight.
          </Card>
          <Card glow="green">
            <CardHeader>
              <CardTitle>Glow Green</CardTitle>
            </CardHeader>
            SCALPER tone.
          </Card>
          <Card glow="amber">
            <CardHeader>
              <CardTitle>Glow Amber</CardTitle>
            </CardHeader>
            Warning.
          </Card>
          <Card glow="red">
            <CardHeader>
              <CardTitle>Glow Red</CardTitle>
            </CardHeader>
            Destructive.
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Metric tiles</h2>
        <Card>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricTile label="Capital" value="$50.00" tone="cyan" />
            <MetricTile
              label="Today P&L"
              value={<MoneyText value={1.42} unit="$" showSign />}
              sub="2 trades"
            />
            <MetricTile label="Win Rate" value="62.5%" tone="positive" sub="10W · 6L" />
            <MetricTile label="Streak" value="🔥 5" tone="warn" />
          </div>
        </Card>
        <Card glow="cyan">
          <MetricTile
            label="Total P&L"
            value={<MoneyText value={-58.12} unit="%" showSign />}
            size="hero"
            align="center"
          />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Pills</h2>
        <div className="flex flex-wrap gap-2">
          <Pill tone="neutral">Neutral</Pill>
          <Pill tone="cyan" pulse>Live</Pill>
          <Pill tone="green">Active</Pill>
          <Pill tone="amber" pulse>Standby</Pill>
          <Pill tone="red">Halted</Pill>
          <Pill tone="violet">Shadow</Pill>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Segmented Toggle</h2>
        <SegmentedToggle
          ariaLabel="System"
          options={[
            { value: "auto", label: "Auto" },
            { value: "scalp", label: "Scalp" },
          ]}
          value={system}
          onChange={setSystem}
          full
        />
        <p className="text-caption text-fg-muted">
          Selected: <code>{system}</code>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Tab Bar</h2>
        <TabBar
          items={[
            { key: "a", label: "Lessons", badge: 12 },
            { key: "b", label: "Journal" },
            { key: "c", label: "Similar Trades" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <p className="text-caption text-fg-muted">
          Active tab: <code>{tab}</code>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Buttons</h2>
        <div className="flex flex-wrap gap-2">
          <HapticButton variant="primary">Primary</HapticButton>
          <HapticButton variant="secondary">Secondary</HapticButton>
          <HapticButton variant="ghost">Ghost</HapticButton>
          <HapticButton variant="destructive">Destructive</HapticButton>
        </div>
        <HapticButton variant="primary" fullWidth onClick={() => setSheetOpen(true)}>
          Open Bottom Sheet
        </HapticButton>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Empty State</h2>
        <Card padding="none">
          <EmptyState
            icon={<Activity size={32} />}
            title="No active positions"
            body="Awaiting next signal."
            action={
              <HapticButton variant="primary" size="sm">
                Refresh
              </HapticButton>
            }
          />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Skeleton</h2>
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-h2">Money Text</h2>
        <div className="flex flex-wrap items-baseline gap-4">
          <MoneyText value={123.45} size="hero" showSign />
          <MoneyText value={-58.12} unit="%" size="lg" showSign />
          <MoneyText value={0} size="md" />
          <MoneyText value={1.42} size="sm" showSign />
        </div>
      </section>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Sample Action Menu">
        <div className="space-y-3">
          <HapticButton variant="ghost" fullWidth>
            Action one
          </HapticButton>
          <HapticButton variant="ghost" fullWidth>
            Action two
          </HapticButton>
          <HapticButton variant="destructive" fullWidth>
            Destructive action
          </HapticButton>
        </div>
      </BottomSheet>

      <footer className="pt-8 text-center text-micro text-fg-faint">
        DESIGN SYSTEM v1 · A4 · {new Date().toISOString().slice(0, 10)}
      </footer>
    </div>
  );
}
