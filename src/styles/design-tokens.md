# TREVOR Hub Design Tokens — Refined Dark Cyber (A4 v1.1)

> **Created 2026-05-21** during the Hub Design Foundation wave (A1). **Finalized 2026-05-21** after C1 (login + password + nav + cross-page + mobile). The Hub visual revamp is now end-to-end refined.
> Source of truth: `src/app/globals.css @theme inline` (A4 v1.1 — REFINED TOKENS block).
> The refined family is **additive** — A4 v1 tokens (`--color-accent-cyan`, `--shadow-glow-cyan`, the legacy `--neon-*`/`--glow-*`) stay defined and continue to work. Page-level redesigns (B1/B2/C1) opt into the refined family.
> **Standing preference (C1):** Hub aesthetic is refined dark cyber — desaturated accents, subtle glows, mono for data, sans-serif for UI labels, professional polish over arcade neon. Future surfaces should opt into refined tokens.

## Direction

- Dark cyber soul preserved — ~50% accent saturation, ~30-40% of original glow intensity.
- Mono (JetBrains) for data (prices, P&L, timestamps, hashes, ticker symbols, percentages).
- Sans (Geist) for UI labels, headings, prose, empty-state copy, form labels.
- Backgrounds unchanged — already restrained.

---

## Palette

### Backgrounds (unchanged, A4 v1)

| Token | Hex | Use |
|---|---|---|
| `--color-bg-primary` | `#0a0a0f` | Page background |
| `--color-bg-card` | `#12121a` | Card / panel surfaces |
| `--color-bg-elevated` | `#1a1a28` | Hover / pill backgrounds, slight lift |
| `--color-bg-sidebar` | `#08080d` | Sidebar, sticky tab strips, deep wells |
| `--color-bg-glass` | `rgba(18,18,26,0.85)` | Glass overlays |
| `--color-bg-overlay` | `rgba(8,8,13,0.78)` | Modal scrims |

### Refined accents (NEW, A4 v1.1)

| Token | Hex | HSL | Use |
|---|---|---|---|
| `--color-accent-cyan-soft` | `#5fb4cc` | 196° 50% 59% | **Default UI accent** — borders, default text accent, active tab underline |
| `--color-accent-cyan-soft-strong` | `#7fc8e0` | 196° 64% 69% | Focus state, hovered active tab, button hover |
| `--color-accent-cyan-soft-subtle` | `rgba(95,180,204,0.2)` | — | Default 1px borders, subtle backgrounds |
| `--color-accent-plum` | `#a067c4` | 280° 42% 59% | Mid-cap / loud tier badges, replaces magenta for restrained UI |
| `--color-accent-plum-strong` | `#b585d4` | 280° 50% 67% | Plum hover/focus |
| `--color-accent-plum-subtle` | `rgba(160,103,196,0.2)` | — | Plum borders |
| `--color-accent-mint` | `#5fcc99` | 152° 50% 59% | **Financial green** — P&L positive, LIVE, ACTIVE, RUNNING |
| `--color-accent-mint-strong` | `#7adcad` | 152° 60% 67% | Mint hover/focus |
| `--color-accent-mint-subtle` | `rgba(95,204,153,0.2)` | — | Mint borders |
| `--color-accent-gold` | `#d4a64a` | 41° 60% 56% | Refined amber — non-critical warnings, caution states |
| `--color-accent-gold-strong` | `#e0b865` | 41° 67% 64% | Gold hover/focus |
| `--color-accent-gold-subtle` | `rgba(212,166,74,0.2)` | — | Gold borders |
| `--color-accent-red` (unchanged) | `#ff3366` | 347° 100% 60% | **Critical** — error, killswitch, destructive — keep clear |
| `--color-accent-red-strong` | `#ff5577` | 347° 100% 67% | Red hover, armed state (e.g., 2-tap confirm) |
| `--color-accent-red-subtle` | `rgba(255,51,102,0.2)` | — | Red borders |

### Refined borders

| Token | Use |
|---|---|
| `--color-border-cyan-soft` | Default card border (`rgba(95,180,204,0.18)`) |
| `--color-border-plum` | Plum-accented card border |
| `--color-border-mint` | Mint-accented card border |
| `--color-border-gold` | Gold-accented card border |

### Legacy / coexisting (UNCHANGED — do not delete)

`--color-accent-cyan` `#00f0ff` · `--color-accent-magenta` `#ff00ff` · `--color-accent-green` `#00ff88` · `--color-accent-amber` `#ffaa00` · `--color-accent-violet` `#b478ff` · all `--neon-*` and `--glow-*` legacy aliases. ~108 cyan refs across `src/` — surgical migration only in B1/B2.

---

## Glow system

Default cards take **no glow** or `shadow-glow-subtle`. Active state takes `shadow-glow-active`. Focus/hover takes `shadow-glow-focus`. The heavy legacy `shadow-glow-cyan`/`-magenta`/`-green`/`-amber`/`-red` (16px @ 40% alpha) stay defined for backward compat but are not used by new primitives.

| Token | Value | Use |
|---|---|---|
| `--shadow-glow-subtle` | `0 0 6px rgba(95,180,204,0.15)` | Default card halo (cyan-soft) |
| `--shadow-glow-active` | `0 0 10px rgba(95,180,204,0.25)` | Active card / selected state |
| `--shadow-glow-focus` | `0 0 12px rgba(95,180,204,0.35)` | Focus ring / strong hover |
| `--shadow-glow-subtle-{cyan,plum,mint,gold,red}` | `0 0 6px …` @ 15-18% alpha | Per-color subtle halo |
| `--shadow-glow-active-{cyan,plum,mint,gold,red}` | `0 0 10px …` @ 25-28% alpha | Per-color active halo |

Tailwind v4 generates utilities from these tokens automatically: `shadow-glow-subtle`, `shadow-glow-active`, `shadow-glow-focus`, `shadow-glow-subtle-mint`, etc.

---

## Type system

### Loaded fonts

| Family | Loader | Variable | Use |
|---|---|---|---|
| **JetBrains Mono** (400, 700) | `@font-face` in `globals.css` (gstatic CDN) | `--font-mono` | Body default — data, numerics, code |
| **Geist Sans** (variable) | `next/font/google` in `src/app/layout.tsx` | `--font-geist-sans` → `--font-sans` | UI labels, headings, prose (opt-in) |

`<html>` carries `className={geistSans.variable}`, so `--font-geist-sans` resolves everywhere. `--font-sans` is defined in `@theme inline` to fall back to `'Geist'`, `'Inter'`, then `system-ui` — Tailwind's `font-sans` utility automatically picks it up.

### Mono vs. sans — when to use which

| Mono (`font-mono` / body default) | Sans (`font-sans` / `text-*-ui`) |
|---|---|
| Prices, P&L, change percentages | Nav labels, tab labels, button text |
| Timestamps, durations, counts | Page headings (H1/H2/H3) |
| Ticker symbols (BTC, ETH, …) | Section titles, card titles |
| Hashes, SHAs, file sizes | Descriptive prose, empty-state copy |
| Code blocks, JSON, log lines | Form labels, helper text |
| Stat values, metric tiles | Status pill labels (debatable — sans for cleaner rhythm) |

**Body font stays mono.** Geist Sans is opt-in per surface — B1/B2 prompts switch specific elements to `font-sans` or the refined `.text-*-ui` utilities. Existing pages render identically until then.

### Refined type utilities (A4 v1.1, opt-in)

Each class explicitly sets `font-family: var(--font-sans)` and forces Geist regardless of body context. Use these for UI surfaces; keep `.text-display` / `.text-h1` / `.text-body` / `.text-caption` / `.text-micro` for mono contexts (numeric headlines, terminal output).

| Class | Size / line / weight / tracking | Intended use |
|---|---|---|
| `.text-label-ui` | 11px / 16px / 500 / 0.075em / UPPERCASE | Nav, tab, button labels — tighter tracking |
| `.text-heading-ui` | 20px / 26px / 600 / -0.005em | Section headers, card titles |
| `.text-h1-ui` | 24px / 32px / 600 / -0.01em | Page H1 |
| `.text-h2-ui` | 18px / 24px / 600 / -0.005em | Subsection H2 |
| `.text-prose-ui` | 15px / 24px / 400 | Body prose — readable line-height 1.6 |
| `.text-caption-ui` | 12px / 18px / 400 / 0.005em | Helper text, captions |

### Conventions

- All-caps labels use `tracking-wider` (or the built-in 0.075em on `.text-label-ui`) — keeps a small text feeling deliberate, not crammed.
- Heading weights drop from 700→600 in the refined set — Geist's 600 reads as more authoritative than its 700, less headline-poster.
- Body line-height rises from 1.43→1.60 in `.text-prose-ui` — material-quality readability.
- Numeric runs inside a sans paragraph: wrap in `<span className="font-mono tabular-nums">…</span>`.

---

## Cards

Two paths to a refined card:

1. **`<Card>` primitive** (`src/components/ui/card.tsx`) — JSX component, existing API. Continues to work; B1/B2 may opt into the refined family by leaving `glow="none"` and composing with the new utility classes.
2. **CSS utility classes** (added in Phase 4, in `@layer utilities`) — for plain `<div>` markup that doesn't reach for the primitive.

| Class | Visual | Use |
|---|---|---|
| `.card-base` | Subtle cyan-soft 1px border, no glow, dark card bg | **Default card** — neutral state |
| `.card-elevated` | Same border + `shadow-glow-subtle` halo; hover/focus bumps to `shadow-glow-active` | Featured/header cards, hoverable list rows |
| `.card-active` | Full `--color-accent-cyan-soft` border + `shadow-glow-active` halo | Currently-selected / active state |
| `.card-warn` | `--color-accent-red-subtle` border + `shadow-glow-subtle-red` halo | Warnings, alerts, armed-to-delete state |

All four use `var(--radius-md)` on mobile (≈2px) and `var(--radius-lg)` on `≥md` (≈4px) — matches the existing `<Card>` primitive's `rounded-md md:rounded-lg`. Transitions on `box-shadow` + `border-color` use `--transition-duration-fast` (160ms).

The existing `<Card glow="cyan|magenta|green|amber|red">` API stays — it composes the legacy heavy glow shadow. Prefer the new utility classes for refined surfaces.

---

## Status pills

### Pill primitive (`src/components/ui/pill.tsx`)

Two parallel APIs on the same `<Pill>` component:

- **`tone`** — legacy A4 v1 (`neutral` | `cyan` | `green` | `amber` | `red` | `magenta` | `violet`). Unchanged.
- **`intent`** — A4 v1.1 refined. Provides domain-meaningful variants and overrides `tone` when both are passed.

### Intent variants

| `intent=` | Visual | Use |
|---|---|---|
| `blue-chip` | Cyan-soft / 10% bg / strong text / 30% border | Major-cap tickers (BTC, ETH) |
| `mid-cap` | Plum / 10% bg / strong text / 30% border | Mid-cap tickers (SOL, HYPE) |
| `meme` | Plum / 15% bg / strong text / 40% border + `shadow-glow-subtle-plum` | Loud-but-not-painful — meme tier (FARTCOIN, WIF) |
| `live` | Mint / 10% bg / strong text / 30% border | Live data, real-time stream indicator |
| `active` | Mint / 10% bg / strong text / 30% border | ACTIVE state (signal, monitor, service) |
| `running` | Mint / 10% bg / strong text / 30% border | RUNNING service (no pulse animation by default) |
| `warn` | Gold / 10% bg / strong text / 35% border | Non-critical warning |
| `error` | Red / 10% bg / red text / 30% border | Critical error (intent= forwards to red, no plum/mint substitution) |

### Sizes / behavior

- `size="sm"` (default) — 8 × 2 px padding, micro text.
- `size="md"` — 12 × 4 px padding, caption text.
- `pulse` boolean — adds the cyan pulse animation (left-side dot + ring) — use for blinking live/active indicators only.

### Migration

`watchlist-grid.tsx:31-34` already maps BLUE_CHIP / MID_CAP / MEME to the legacy `tone` values cyan / violet / magenta. To adopt refined intents:

```diff
- <Pill tone={TIER_TONE[t.tier]} size="sm">{t.tier}</Pill>
+ <Pill intent={t.tier === "BLUE_CHIP" ? "blue-chip" : t.tier === "MID_CAP" ? "mid-cap" : "meme"} size="sm">{t.tier}</Pill>
```

Existing `<Pill tone="cyan">…` callers keep rendering as today. Migration is per-surface in B1/B2.

---

## Migration policy

- **Additive only.** Existing classes (`text-accent-cyan`, `border-accent-cyan/30`, `shadow-glow-cyan`, the legacy `text-cyan-400` / `border-magenta-500` etc.) continue to work. The refined tokens are siblings, not replacements.
- **B1/B2/C1 adopt refined tokens page-by-page** — this foundation prompt only adds the tokens, the tab fade, and the new card/pill primitives.
- **Body font default stays `var(--font-mono)`.** Geist Sans (`font-sans` utility) is opt-in. Existing surfaces render identically until a future prompt switches a specific label or heading to `font-sans`.
- **Never delete an A4 v1 token without a paired A4-revision prompt** that removes every consumer first.

---

## Conventions established during C1 (2026-05-21)

- **Auth surfaces** (login, password modal, error / not-found boundaries): wrapper `card-elevated`, inline `border: 1px solid var(--color-accent-cyan-soft-subtle)` on inputs with focus `border-color: var(--color-accent-cyan-soft)` + `box-shadow: var(--shadow-glow-focus)`; submit button background `rgba(95,180,204,0.1)`, border `var(--color-accent-cyan-soft)`, color `var(--color-accent-cyan-soft-strong)`, `minHeight: 44px` (iOS HIG). Labels use `.text-label-ui`. Error messages use `text-accent-red` + `.text-caption-ui`. Success uses refined mint (`text-accent-mint-strong` + subtle mint disc).
- **Bottom nav / sidebar rail active-zone glow** uses refined `shadow-glow-active-{cyan,mint,plum,gold}` (10px @ 25-28% alpha) — not the legacy heavy `shadow-glow-{cyan,green,magenta,amber}` (16px @ 40% alpha). The `accentTextClass` / `accentGlowClass` helpers in `src/lib/navigation.ts` are the single source of truth — refine there, not at the call sites.
- **Zone-accent mapping (refined):** `cyan → cyan-soft`, `green → mint`, `violet → plum`, `magenta → plum`, `amber → gold`. Plum substitutes both violet AND magenta for restrained UI; mint replaces electric green for financial / LIVE / ACTIVE / RUNNING semantics; gold replaces amber for non-critical warnings.
- **Mobile tap-target floor:** 44×44 (iOS HIG), enforced via the `.tap-target` class (`globals.css`). Auth submit buttons set `style={{ minHeight: 44 }}` explicitly; icon-only buttons (close X, eye toggle, header icons) sit inside a `flex h-9 w-9 items-center justify-center` wrapper.
- **Standalone `/chat` page distinct from chat modal/FAB** (the latter polished in B2). `/chat` page uses a Termius-blue ambient theme (`#0d1117` bg, `#58a6ff` user accent) — kept distinct intentionally, but TREVOR-side accents refined to mint (`#5fcc99`) to match the wider refined aesthetic.
- **Status pills sized smaller than the original A4 v1 chrome.** Default `size="sm"` (8 × 2 px padding) reads as the new normal across Hub pages; reserve `size="md"` for hero/landing surfaces where the pill is the visual anchor.
