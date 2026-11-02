"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `lg` and `xl` breakpoints. Keep in step with the `lg:` / `xl:` classes in the components. */
const DESKTOP = "(min-width: 1024px)";
const WIDE = "(min-width: 1280px)";

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * True on a desktop-width screen (1024px and up). Used where the desktop layout
 * needs different markup (a table instead of a list, a chart that is only worth
 * fetching when it can be seen), not just different spacing. Server render and
 * first paint are "mobile", so phones never flash a desktop layout.
 */
export function useIsDesktop(): boolean {
  return useMedia(DESKTOP);
}

/** True from 1280px, where a pick card has room for chart and research side by side. */
export function useIsWide(): boolean {
  return useMedia(WIDE);
}
