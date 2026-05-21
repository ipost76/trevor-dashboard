"use client";

import { useState } from "react";

import type { DiscoveryV2Item } from "@/lib/scout-v3-types";
import { CATALYST_PILL_CONFIG } from "@/lib/scout-v3-types";

interface Props {
  item: DiscoveryV2Item;
  onMoreClick: () => void;
}

/**
 * DiscoveryCardV3 — single-ticker research card.
 *
 * Default state: collapsed (header + metrics + bull thesis + 4 link buttons +
 * catalyst pill). Expanded: also shows triggers, research priorities, risk flags.
 *
 * G4a scope: 4 always-on research link buttons + a non-functional "More research →"
 * button that becomes the drawer trigger in G4b. Disabled stub is documented, not
 * a placeholder.
 *
 * Catalyst pill HIDDEN when catalyst_type === "none" (label === "") — explicit
 * fix for the v2 "NO CATALYST" weasel-pill bug.
 */
export function DiscoveryCardV3({ item, onMoreClick }: Props) {
  const [expanded, setExpanded] = useState(false);

  const pill = CATALYST_PILL_CONFIG[item.catalyst_type];
  const showPill = pill.label.length > 0;

  const engineBadges = item.engines_fired.map((e) =>
    e === "position" ? "POSITION · 1-8MO" : e === "swing" ? "SWING · 1-4WK" : e.toUpperCase(),
  );

  const formattedPostedAt = item.posted_at.split("T")[0] ?? item.posted_at;
  const isMultiEngine = item.engines_fired.length > 1;

  return (
    <article
      className={`relative card-elevated p-4 ${
        isMultiEngine
          ? "border-accent-gold/40 shadow-[var(--shadow-card),var(--shadow-glow-subtle-gold)]"
          : ""
      }`}
      data-ticker={item.ticker}
    >
      {/* Header */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-accent-gold text-lg">🔍</span>
        <h3 className="font-mono text-xl font-bold tracking-wide text-fg-primary">{item.ticker}</h3>
        {item.company_name && (
          <span className="font-sans text-sm text-fg-muted truncate max-w-[200px]">
            — {item.company_name}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {engineBadges.map((b) => (
            <span
              key={b}
              className="font-sans text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border border-accent-cyan-soft/40 text-accent-cyan-soft-strong"
            >
              {b}
            </span>
          ))}
        </div>
      </header>

      <div className="font-sans text-xs text-fg-muted mb-3">
        POSTED <span className="font-mono">{formattedPostedAt}</span>
        {item.surfaced_count > 1 && (
          <span className="ml-3 text-fg-muted">
            ↑ Surfaced {item.surfaced_count}× since{" "}
            <span className="font-mono">{item.first_seen_at.split("T")[0]}</span>
          </span>
        )}
        {item.material_change_log && (
          <span className="ml-3 text-accent-gold">→ {item.material_change_log}</span>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 mb-3 border-y border-border-subtle py-3">
        <Metric
          label="PRICE"
          value={item.metrics.price != null ? `$${item.metrics.price.toFixed(2)}` : "—"}
        />
        <Metric label="MCAP" value={item.metrics.mcap_str || "—"} />
        <Metric label="SECTOR" value={item.metrics.sector || "—"} />
        <Metric
          label="RS"
          value={item.metrics.rs != null ? String(Math.round(item.metrics.rs)) : "—"}
          valueClass="text-accent-mint"
        />
        <Metric label="TREND" value={item.metrics.trend || "—"} />
        <Metric
          label="VOLUME"
          value={item.metrics.vol_mult != null ? `${item.metrics.vol_mult.toFixed(1)}x` : "—"}
        />
      </div>

      {/* Bull thesis — always visible (primary signal Ghost scans) */}
      <Section title="WHY THIS MIGHT MOVE" accentClass="border-accent-cyan-soft/40">
        <BulletList items={item.narrative.bull_thesis} accent="cyan" />
      </Section>

      {/* Expanded sections */}
      {expanded && (
        <>
          {item.narrative.triggers_to_watch?.length > 0 && (
            <Section title="TRIGGERS TO WATCH" accentClass="border-accent-gold/40">
              <BulletList items={item.narrative.triggers_to_watch} accent="gold" />
            </Section>
          )}
          {item.narrative.research_priorities?.length > 0 && (
            <Section title="RESEARCH NEXT" accentClass="border-accent-plum/40">
              <BulletList items={item.narrative.research_priorities} accent="plum" />
            </Section>
          )}
          {item.narrative.risk_flags?.length > 0 && (
            <Section title="RISK FLAGS" accentClass="border-accent-red/40">
              <BulletList items={item.narrative.risk_flags} accent="red" />
            </Section>
          )}
        </>
      )}

      {/* Expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-3 w-full text-center font-sans text-xs uppercase tracking-wider text-fg-muted hover:text-accent-cyan-soft-strong transition py-2 border-t border-border-subtle"
        aria-expanded={expanded}
      >
        {expanded ? "▲ Show less" : "▼ Triggers · Research · Risks"}
      </button>

      {/* Research link row — 4 always-on (G4a) + placeholder for drawer (G4b activates it) */}
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {item.research_links.front.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded border border-border-subtle hover:border-accent-cyan-soft/50 hover:bg-accent-cyan-soft/5 transition min-h-[44px]"
            title={link.url}
          >
            <span className="text-lg leading-none">{link.icon}</span>
            <span className="font-sans text-[9px] font-medium uppercase tracking-wider text-fg-muted text-center">
              {link.label}
            </span>
          </a>
        ))}
        <button
          type="button"
          onClick={onMoreClick}
          className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded border border-border-subtle hover:border-accent-plum/50 hover:bg-accent-plum/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent-plum"
          title={`More research sources for ${item.ticker}`}
          aria-label={`Open more research sources for ${item.ticker}`}
        >
          <span className="text-lg leading-none">➕</span>
          <span className="font-sans text-[9px] font-medium uppercase tracking-wider text-fg-primary">More</span>
        </button>
      </div>

      {/* Catalyst pill row — HIDDEN if catalyst_type === 'none' (NO CATALYST bug fix) */}
      <div className="mt-3 flex items-center justify-between">
        <div>
          {showPill && (
            <span
              className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${pill.colorClass}`}
            >
              📄 {pill.label}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          SCORE {item.unified_score.toFixed(1)}
        </div>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  valueClass = "text-fg-primary",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`font-mono text-base font-semibold ${valueClass}`}>{value}</span>
      <span className="font-sans text-[10px] font-medium uppercase tracking-wider text-fg-muted mt-0.5">
        {label}
      </span>
    </div>
  );
}

function Section({
  title,
  accentClass,
  children,
}: {
  title: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mt-3 pl-3 border-l-2 ${accentClass}`}>
      <h4 className="font-sans text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-muted mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function BulletList({
  items,
  accent,
}: {
  items: string[];
  accent: "cyan" | "gold" | "plum" | "red";
}) {
  const dotColor = {
    cyan: "bg-accent-cyan-soft",
    gold: "bg-accent-gold",
    plum: "bg-accent-plum",
    red: "bg-accent-red",
  }[accent];

  return (
    <ul className="space-y-1.5">
      {items.map((bullet, i) => (
        <li key={i} className="flex items-start gap-2 font-sans text-sm leading-relaxed text-fg-primary">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );
}
