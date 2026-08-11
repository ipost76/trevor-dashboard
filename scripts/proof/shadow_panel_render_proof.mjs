/**
 * shadow_panel_render_proof.mjs — RM-CUTOVER Wave C · C4 Phase 2.
 *
 * 🚨 WHY THIS EXISTS, AND WHAT IT REFUSES TO DO.
 *    The Phase 2 gate asks for proof that DRIFT / BLINDNESS / RESOURCE (and the
 *    rest) render VISIBLY DIFFERENTLY. Reading the CLASS_STYLE map and observing
 *    that it contains different colours proves nothing — it inspects the code that
 *    is *supposed* to do the job. This harness instead INJECTS a real payload of
 *    each class, RENDERS THE REAL COMPONENT to markup, and asserts on the produced
 *    HTML. If the map were bypassed, or two classes collapsed onto one style, the
 *    rendered strings would collide and this would fail.
 *
 * WHAT IS REAL HERE: the component file itself (its JSX, its CLASS_STYLE map, its
 * ordering rules, its fault-card branches) and React's real renderer. Only the
 * presentational Card/CardHeader/CardTitle/Skeleton chrome is stubbed, because it
 * contributes no class-distinguishing output.
 *
 * RUN:  node scripts/proof/shadow_panel_render_proof.mjs
 * EXIT: 0 all assertions pass · 1 any failure
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const swc = require("next/dist/build/swc");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// ── Compile the REAL component ────────────────────────────────────────────────
// SHADOW_CARD_PATH lets the NEGATIVE CONTROL point this harness at a deliberately
// broken copy, to prove the harness can actually fail. A proof that cannot fail is
// not a proof.
const CARD = process.env.SHADOW_CARD_PATH || path.join(REPO, "src/components/shadow/shadow-week-card.tsx");
const src = readFileSync(CARD, "utf8");
const { code } = swc.transformSync(src, {
  filename: "shadow-week-card.tsx",
  jsc: {
    parser: { syntax: "typescript", tsx: true },
    target: "es2022",
    transform: { react: { runtime: "automatic" } },
  },
  module: { type: "commonjs" },
});

// Minimal chrome stubs — they pass children through and add no styling of their own.
const passthrough = (tag) => ({ children, className }) =>
  React.createElement(tag, { className, "data-stub": tag }, children);
const uiStub = {
  Card: passthrough("card"),
  CardHeader: passthrough("cardheader"),
  CardTitle: passthrough("cardtitle"),
  Skeleton: passthrough("skeleton"),
};

const moduleObj = { exports: {} };
const shimRequire = (id) => {
  if (id === "@/components/ui") return uiStub;
  return require(id);
};
vm.runInNewContext(
  `(function (exports, require, module, React) { ${code}\n})`,
  { console, setInterval: () => 0, clearInterval: () => {}, fetch: async () => { throw new Error("no fetch in proof"); } }
)(moduleObj.exports, shimRequire, moduleObj, React);

const ShadowWeekCard = moduleObj.exports.ShadowWeekCard;
if (typeof ShadowWeekCard !== "function") {
  console.error("FATAL: component did not export ShadowWeekCard");
  process.exit(1);
}

// ── Injection helpers ─────────────────────────────────────────────────────────
const nowEt = new Date().toISOString().replace("Z", "-00:00");
const baseRow = (over = {}) => ({
  generated_at_et: nowEt, tz_asserted: "America/New_York", day: "2026-08-14",
  clean_days: 3, target_days: 7, day_state: "CLEAN", day_cause: null,
  harness_state: "RUNNING", last_heartbeat_age_s: 42, drift_count: 0,
  not_drift: {}, pass_conditions: [{ id: "PC1", status: "PASS", last_fail_day: null }],
  age_s: 60, ...over,
});
const ok = (row) => ({ panel_state: "OK", reason: "fresh", stale: false, row, fetch: { fetched_at_utc: nowEt, ok: 1, source: "ghostbox:panel.json", error: null } });
const render = (data) => renderToStaticMarkup(React.createElement(ShadowWeekCard, { initialData: data }));

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); failures++; }
};

// ── 1. Every class renders, and renders DISTINCTLY from every other ───────────
console.log("\n[1] Each class injected at the data end, asserted at the rendered end");
const CLASSES = ["BLINDNESS", "RESOURCE", "UNCOMPARABLE", "SUPPRESSED", "STATE_DIVERGENCE", "TERMINAL"];
const rendered = {};
rendered["DRIFT"] = render(ok(baseRow({ drift_count: 4 })));
check("DRIFT renders its own marker + count", /🔴/.test(rendered["DRIFT"]) && /DRIFT ×4/.test(rendered["DRIFT"]));
for (const c of CLASSES) {
  rendered[c] = render(ok(baseRow({ not_drift: { [c]: 2 } })));
  check(`${c} renders with its own label`, new RegExp(`${c} ×2`).test(rendered[c]));
}
// An unrecognised class must still appear, and must not be silently dropped.
rendered["NEWCLASS"] = render(ok(baseRow({ not_drift: { WOBBLE: 1 } })));
check("an UNKNOWN class still renders (never silently dropped)", /WOBBLE \(unknown\) ×1/.test(rendered["NEWCLASS"]));

console.log("\n[2] Pairwise visual distinctness (extracted style strings must differ)");
const styleOf = (html) => (html.match(/class="[^"]*(?:border-|bg-|text-)[^"]*"/g) || []).join("|");
const names = Object.keys(rendered);
let collisions = 0;
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    if (styleOf(rendered[names[i]]) === styleOf(rendered[names[j]])) {
      console.log(`  ❌ ${names[i]} and ${names[j]} render IDENTICALLY`);
      collisions++;
    }
  }
}
check(`no two classes share a rendering (${names.length} classes, ${(names.length * (names.length - 1)) / 2} pairs)`, collisions === 0);

// ── 3. The rule that matters most: non-DRIFT must never be styled as DRIFT ────
console.log("\n[3] 🚨 Non-DRIFT classes never carry DRIFT's marker, and never enter the drift number");
for (const c of CLASSES.concat(["NEWCLASS"])) {
  const html = rendered[c];
  check(`${c}: drift line still reads "none"`, /drift: none/.test(html),
        "a non-drift class leaked into the drift count");
  const notDriftBlock = html.split("not a disagreement")[1] || "";
  check(`${c}: 🔴 does not appear on its line`, !/🔴/.test(notDriftBlock));
}

// ── 4. UNCOMPARABLE is never green and never reads as agreement ──────────────
console.log("\n[4] 🚨 UNCOMPARABLE never renders as green / as a pass");
const unc = rendered["UNCOMPARABLE"];
const uncLine = (unc.match(/<div class="[^"]*"[^>]*>(?:(?!<\/div>).)*UNCOMPARABLE[^<]*/s) || [""])[0];
check("UNCOMPARABLE line carries no emerald/green class", !/emerald|green-/.test(uncLine), uncLine.slice(0, 160));
check("UNCOMPARABLE line carries no ✅", !/✅/.test(uncLine));
check("UNCOMPARABLE is labelled 'never agreement, never green'", /never agreement, never green/.test(unc));

// ── 5. harness_state outranks everything (rule 2) ────────────────────────────
console.log("\n[5] 🚨 harness_state outranks the counter");
const notStarted = render(ok(baseRow({ harness_state: "NOT-STARTED", clean_days: 6 })));
check("NOT-STARTED renders its own banner", /HARNESS NOT-STARTED/.test(notStarted));
check("NOT-STARTED shows no green RUNNING tick beside it", !/HARNESS RUNNING/.test(notStarted));
const stopped = render(ok(baseRow({ harness_state: "STOPPED" })));
check("STOPPED renders its own banner", /HARNESS STOPPED/.test(stopped));

// ── 6. HOLD is not CLEAN (rule 3) ────────────────────────────────────────────
console.log("\n[6] day_state HOLD is its own state");
const hold = render(ok(baseRow({ day_state: "HOLD" })));
const clean = render(ok(baseRow({ day_state: "CLEAN" })));
check("HOLD renders as HOLD", /today HOLD/.test(hold));
check("HOLD is styled differently from CLEAN", styleOf(hold) !== styleOf(clean));

// ── 7. NO DATA / UNREACHABLE / STALE each render as their own fault ──────────
console.log("\n[7] 🚨 NO DATA · UNREACHABLE · STALE — each its own state, none green");
const faults = {
  NO_DATA: render({ panel_state: "NO_DATA", reason: "no row yet", stale: false, row: null, fetch: null }),
  UNREACHABLE: render({ panel_state: "UNREACHABLE", reason: "ssh rc=255", stale: false, row: null, fetch: { fetched_at_utc: nowEt, ok: 0, source: "ghostbox:panel.json", error: "ssh rc=255: connection refused" } }),
  STALE: render({ panel_state: "STALE", reason: "B4 last wrote 41.2h ago (threshold 28h)", stale: true, row: baseRow(), fetch: null }),
};
check("NO DATA says the week has not started", /NO DATA — the shadow week has not started/.test(faults.NO_DATA));
check("NO DATA is not rendered as a clean day", /NOT a clean day/.test(faults.NO_DATA) && !/✅/.test(faults.NO_DATA));
check("UNREACHABLE names the one-sided view", /UNREACHABLE — ghostbox could not be read/.test(faults.UNREACHABLE) && /ONE-SIDED/.test(faults.UNREACHABLE));
check("UNREACHABLE surfaces the underlying error", /connection refused/.test(faults.UNREACHABLE));
check("UNREACHABLE is not green", !/emerald|✅/.test(faults.UNREACHABLE));
check("STALE reads as a fault, not an empty card", /STALE — the monitor has stopped writing/.test(faults.STALE));
check("STALE does NOT show last-known values", !/day 3\/7/.test(faults.STALE) && !/drift: none/.test(faults.STALE));
check("the three faults are pairwise distinct",
  new Set([faults.NO_DATA, faults.UNREACHABLE, faults.STALE].map(styleOf)).size === 3);

// ── 8. Phone width — no fixed pixel widths that would overflow 375px ─────────
console.log("\n[8] Phone screen (375px, the xs breakpoint)");
const all = Object.values(rendered).concat(Object.values(faults));
const fixedWidths = all.join("").match(/\bw-\[(\d+)px\]|\bmin-w-\[(\d+)px\]/g) || [];
const tooWide = fixedWidths.filter((m) => parseInt(m.replace(/\D/g, ""), 10) > 343);
check("no fixed width exceeds 375px minus padding", tooWide.length === 0, tooWide.join(","));
check("card is width-fluid (w-full)", /w-full/.test(rendered["DRIFT"]));

console.log(`\n${failures === 0 ? "✅ PASS" : "❌ FAIL"} — ${failures} failing assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
