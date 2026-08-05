/**
 * /math shared surface — the ONE import path for D1–D6. [B1, 2026-08-05]
 *
 * A section file should need exactly this:
 *
 *   import { MathSection, FormulaEntry, type FormulaEntryProps } from "@/components/math";
 *
 * 🚨 Import from here, not from the individual files. Six prompts each guessing
 * their own import path is how the contract quietly forks.
 */

export { MathTex } from "./MathTex";
export type { MathTexProps } from "./MathTex";

export { StatusBadge, statusMeaning } from "./StatusBadge";
export type { StatusBadgeProps } from "./StatusBadge";

export { FormulaEntry } from "./FormulaEntry";

export { MathSection } from "./MathSection";
export type { MathSectionProps } from "./MathSection";

export {
  MATH_SECTIONS,
  MATH_VALUES_ENDPOINT,
  mathSectionAnchor,
} from "./values";
export type {
  FormulaStatus,
  FormulaSymbol,
  FormulaValue,
  FormulaEntryProps,
  MathSectionSpec,
  MathValueSource,
  MathLiveValue,
  MathValuesResponse,
} from "./values";
