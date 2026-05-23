"use client";
import * as React from "react";
import { TabBar, type TabBarItem } from "@/components/ui";

/**
 * A docs download category folder, as returned by GET /api/docs/categories
 * (backed by download_manager's downloads/categories.json).
 */
export interface DocsCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at?: string;
}

/** Tab key for the always-present "no category" bucket (category_id === null). */
export const UNCATEGORIZED_KEY = "uncategorized";

interface CategoryTabsProps {
  /** Categories from the API — rendered in sort_order, after Uncategorized. */
  categories: ReadonlyArray<DocsCategory>;
  /** File counts keyed by category id, plus UNCATEGORIZED_KEY. Missing → 0. */
  counts: Readonly<Record<string, number>>;
  /** Active tab key — a category id or UNCATEGORIZED_KEY. */
  active: string;
  /** Fires with the next tab key when a tab is tapped. */
  onChange: (next: string) => void;
}

/**
 * Docs › Downloads category tab strip (Wave B1).
 *
 * Reuses the shared <TabBar> primitive — the same component the zone sub-tab
 * strip uses — so the category tabs match the SIMILAR / CALIBRATION / SHADOW
 * styling exactly: horizontal scroll, 44px tap targets, cyan active underline,
 * muted count-pill badges. The responsive negative margins extend TabBar's
 * built-in `-mx-4` bleed out to the section's `md:p-6` / `lg:px-8` padding so
 * the strip stays edge-to-edge at every breakpoint.
 */
export function CategoryTabs({
  categories,
  counts,
  active,
  onChange,
}: CategoryTabsProps) {
  const items = React.useMemo<ReadonlyArray<TabBarItem<string>>>(() => {
    const categoryItems = [...categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        key: c.id,
        label: c.name,
        badge: counts[c.id] ?? 0,
      }));
    // Uncategorized is always FIRST (2026-05-23, supersedes the 2026-05-22
    // last-tab preference): Ghost wants the system bucket to lead the strip
    // so newly-arriving files are immediately visible. Uncategorized is not
    // an API category — it is the bucket for files with category_id === null
    // — so it has no sort_order; the locked position is enforced here.
    return [
      {
        key: UNCATEGORIZED_KEY,
        label: "Uncategorized",
        badge: counts[UNCATEGORIZED_KEY] ?? 0,
      },
      ...categoryItems,
    ];
  }, [categories, counts]);

  return (
    <TabBar
      items={items}
      active={active}
      onChange={onChange}
      className="md:-mx-6 md:px-6 lg:-mx-8 lg:px-8"
    />
  );
}
