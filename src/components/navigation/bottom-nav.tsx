"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ZONES,
  type Zone,
  accentTextClass,
  accentGlowClass,
  zoneFromPath,
} from "@/lib/navigation";
import { useLongPress } from "@/hooks/useLongPress";
import { BottomSheet, HapticButton } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * 5-tab bottom navigation, mobile-first.
 * Hidden on lg+ widths (desktop uses SidebarRail).
 *
 * Long-press a tab → BottomSheet with sub-tabs for that zone.
 * Long-press suppresses the Link navigation so opening the sheet does not
 * also push the user to the zone landing page.
 */
export function BottomNav() {
  const pathname = usePathname();
  const activeZone = zoneFromPath(pathname || "");
  const [sheetZoneId, setSheetZoneId] = React.useState<string | null>(null);

  return (
    <>
      <nav
        role="navigation"
        aria-label="Primary"
        className={cn(
          "safe-pb fixed inset-x-0 bottom-0 z-40 lg:hidden",
          "border-t border-border-subtle bg-bg-sidebar/95 backdrop-blur",
        )}
      >
        <ul className="flex items-stretch justify-around">
          {ZONES.map((zone) => {
            const isActive = activeZone?.id === zone.id;
            return (
              <BottomNavItem
                key={zone.id}
                zone={zone}
                isActive={isActive}
                onLongPress={() => setSheetZoneId(zone.id)}
              />
            );
          })}
        </ul>
      </nav>

      <BottomSheet
        open={sheetZoneId !== null}
        onClose={() => setSheetZoneId(null)}
        title={ZONES.find((z) => z.id === sheetZoneId)?.label ?? ""}
      >
        <SubTabSheetContent
          zoneId={sheetZoneId}
          onClose={() => setSheetZoneId(null)}
        />
      </BottomSheet>
    </>
  );
}

function BottomNavItem({
  zone,
  isActive,
  onLongPress,
}: {
  zone: Zone;
  isActive: boolean;
  onLongPress: () => void;
}) {
  const longPressFiredRef = React.useRef(false);
  const longPress = useLongPress(() => {
    longPressFiredRef.current = true;
    onLongPress();
  }, 450);
  const Icon = zone.icon;

  const onPressStart = () => {
    longPressFiredRef.current = false;
  };
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
    }
  };

  return (
    <li className="flex-1">
      <Link
        href={zone.href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "tap-target relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors duration-fast",
          isActive ? accentTextClass(zone.accent) : "text-fg-muted",
        )}
        onClick={onClick}
        onMouseDown={() => {
          onPressStart();
          longPress.onMouseDown();
        }}
        onMouseUp={longPress.onMouseUp}
        onMouseLeave={longPress.onMouseLeave}
        onTouchStart={() => {
          onPressStart();
          longPress.onTouchStart();
        }}
        onTouchEnd={longPress.onTouchEnd}
        onTouchCancel={longPress.onTouchCancel}
      >
        <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} />
        <span className="text-label-ui" style={{ fontSize: "10px" }}>{zone.shortLabel}</span>
        {isActive && (
          <span
            className={cn(
              "absolute inset-x-3 top-0 h-0.5 rounded-full bg-current",
              accentGlowClass(zone.accent),
            )}
          />
        )}
      </Link>
    </li>
  );
}

function SubTabSheetContent({
  zoneId,
  onClose,
}: {
  zoneId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone || !zone.subTabs) {
    return (
      <p className="text-caption text-fg-muted">No sub-tabs for this zone.</p>
    );
  }
  return (
    <div className="space-y-2">
      {zone.subTabs.map((sub) => (
        <HapticButton
          key={sub.key}
          variant="ghost"
          fullWidth
          onClick={() => {
            router.push(`${zone.href}?tab=${sub.key}`);
            onClose();
          }}
        >
          {sub.label}
        </HapticButton>
      ))}
    </div>
  );
}
