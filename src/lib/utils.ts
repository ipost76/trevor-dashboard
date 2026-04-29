import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// A4 — design-system typography classes are registered as font-size group
// members so tailwind-merge does not mistake them for text-color and merge
// them out when stacked alongside text-accent-*, text-fg-* color classes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-display",
        "text-h1",
        "text-h2",
        "text-h3",
        "text-body",
        "text-caption",
        "text-micro",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
