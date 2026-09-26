import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

import type { ColorScheme } from "./useColorScheme";

const subscribe = () => () => {};

/**
 * Static web rendering has no color scheme, so render "light" on the server
 * and switch to the real value once hydrated on the client.
 */
export function useColorScheme(): ColorScheme {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme === "dark" ? "dark" : "light";
  }

  return "light";
}
