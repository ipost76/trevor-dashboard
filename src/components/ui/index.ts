// A4 — Design System v1 barrel export.
// New primitives only. Existing legacy primitives (panel.tsx, empty-state.tsx,
// skeleton.tsx, tab-bar.tsx, stat-block.tsx, direction-badge.tsx,
// confidence-bar.tsx) are NOT exported from here — import them from their
// individual paths if you still need the legacy API. Future waves migrate.

export { Card, CardHeader, CardTitle } from "./card";
export type { CardProps } from "./card";

export { MetricTile } from "./metric-tile";
export type { MetricTileProps } from "./metric-tile";

export { Pill } from "./pill";
export type { PillProps } from "./pill";

export { SegmentedToggle } from "./segmented-toggle";
export type { SegmentedToggleProps, SegmentedToggleOption } from "./segmented-toggle";

export { TabBar } from "./tab-bar-v2";
export type { TabBarProps, TabBarItem } from "./tab-bar-v2";

export { EmptyState } from "./empty-state-v2";
export type { EmptyStateProps } from "./empty-state-v2";

export { Skeleton } from "./skeleton-shimmer";

export { KillswitchPill } from "./killswitch-pill";

export { LivePulse } from "./live-pulse";
export type { LivePulseProps } from "./live-pulse";

export { MoneyText } from "./money-text";
export type { MoneyTextProps } from "./money-text";

export { BottomSheet } from "./bottom-sheet";
export type { BottomSheetProps } from "./bottom-sheet";

export { HapticButton } from "./haptic-button";
export type { HapticButtonProps } from "./haptic-button";

export { CollapsibleSection } from "./collapsible-section";
export type { CollapsibleSectionProps } from "./collapsible-section";

export { FilterChips } from "./filter-chips";
export type { FilterChipsProps } from "./filter-chips";

export { ConfirmModal } from "./confirm-modal";
export type { ConfirmModalProps } from "./confirm-modal";

export { EditableField } from "./editable-field";
export type { EditableFieldProps, EditableFieldType } from "./editable-field";

export { ToggleSwitch } from "./toggle-switch";
export type { ToggleSwitchProps, ToggleSensitivity } from "./toggle-switch";

export { CompactShadowCard } from "./compact-shadow-card";
export type {
  CompactShadowCardProps,
  CompactShadowStatus,
} from "./compact-shadow-card";

export { ActivityRow } from "./activity-row";
export type { ActivityRowProps, ActivityNotePair } from "./activity-row";

export { LiveValue } from "./live-value";
export type { LiveValueProps } from "./live-value";
