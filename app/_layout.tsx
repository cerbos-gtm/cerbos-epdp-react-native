import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/useColorScheme";

import { CerbosProvider } from "@/components/CerbosContext";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// The ID of the ePDP policy bundling rule to load policies from. Create one in
// the "Embedded PDP rules" tab of your deployment in Cerbos Hub, and set
// EXPO_PUBLIC_CERBOS_HUB_RULE_ID in a `.env` file (see `.env.example`) or
// replace the fallback value below.
export const CERBOS_HUB_RULE_ID =
  process.env.EXPO_PUBLIC_CERBOS_HUB_RULE_ID ?? "REPLACE_WITH_YOUR_RULE_ID";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <CerbosProvider
        ruleId={CERBOS_HUB_RULE_ID}
        refreshIntervalSeconds={300}
        onDecision={(entry) => {
          // Decision logs contain principal and resource attributes: only
          // print them during development. In production, ship them to your
          // audit pipeline instead.
          if (__DEV__) {
            console.log("Audit Log", entry);
          }
        }}
        onUpdateError={(message) => {
          console.warn("Cerbos policy update failed", message);
        }}
      >
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style="auto" />
      </CerbosProvider>
    </ThemeProvider>
  );
}
