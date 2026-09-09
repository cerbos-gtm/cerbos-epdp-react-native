import { useColorScheme as useRNColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

/**
 * The active color scheme, falling back to light when the OS doesn't specify one.
 */
export function useColorScheme(): ColorScheme {
  const scheme = useRNColorScheme();
  return scheme === "dark" ? "dark" : "light";
}
