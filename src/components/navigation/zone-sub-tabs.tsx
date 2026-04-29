"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TabBar, type TabBarItem } from "@/components/ui";
import { ZONES, zoneFromPath } from "@/lib/navigation";

/**
 * Renders the sub-tab strip for the current zone, reading/writing `?tab=...`.
 * Mounted once at the AppShell level; auto-hides on zones without sub-tabs.
 */
export function ZoneSubTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const zone = zoneFromPath(pathname || "");

  if (!zone || !zone.subTabs || zone.subTabs.length === 0) return null;

  const activeFromQuery =
    searchParams?.get("tab") ?? zone.defaultSubTab ?? zone.subTabs[0].key;

  const items: ReadonlyArray<TabBarItem<string>> = zone.subTabs.map((sub) => ({
    key: sub.key,
    label: sub.label,
    badge: sub.badge,
  }));

  return (
    <TabBar
      items={items}
      active={activeFromQuery}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("tab", next);
        router.push(`${zone.href}?${params.toString()}`);
      }}
      className="px-4"
    />
  );
}

/**
 * ZONES is re-exported from this module path for convenience to consumers
 * that want the zone list along with the strip component.
 */
export { ZONES };
