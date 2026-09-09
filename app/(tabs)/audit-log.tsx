import { Button, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDemo } from "@/components/demo/DemoContext";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Shows the decision log entries and other events received from the embedded
 * PDP through the provider's callbacks.
 */
export default function AuditLogScreen() {
  const { decisionLog, clearDecisionLog, eventLog, clearEventLog } = useDemo();

  return (
    <ScrollView style={{ flex: 1 }}>
      <SafeAreaView>
        <ThemedView style={styles.section}>
          <ThemedText type="title">Audit</ThemedText>
          <ThemedText style={styles.muted}>
            Decision log entries come from the `onDecision` callback (enable it
            in the ePDP tab). In a real app, ship them to your audit pipeline.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedView style={styles.headerRow}>
            <ThemedText type="subtitle">
              Decisions ({decisionLog.length})
            </ThemedText>
            <Button title="Clear" onPress={clearDecisionLog} />
          </ThemedView>
          {decisionLog.length === 0 && (
            <ThemedText style={styles.muted}>(no entries yet)</ThemedText>
          )}
          {decisionLog.map((item, index) => (
            <ThemedView key={`${item.at}-${index}`} style={styles.entry}>
              <ThemedText type="defaultSemiBold">{item.at}</ThemedText>
              <ThemedText style={styles.json} selectable>
                {stringify(item.entry)}
              </ThemedText>
            </ThemedView>
          ))}
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedView style={styles.headerRow}>
            <ThemedText type="subtitle">Events ({eventLog.length})</ThemedText>
            <Button title="Clear" onPress={clearEventLog} />
          </ThemedView>
          {eventLog.length === 0 && (
            <ThemedText style={styles.muted}>(no events yet)</ThemedText>
          )}
          {eventLog.map((item, index) => (
            <ThemedView key={`${item.at}-${index}`} style={styles.entry}>
              <ThemedText type="defaultSemiBold">
                {item.at} · {item.type}
              </ThemedText>
              <ThemedText style={styles.json} selectable>
                {stringify(item.payload)}
              </ThemedText>
            </ThemedView>
          ))}
        </ThemedView>
      </SafeAreaView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  muted: {
    fontSize: 12,
    opacity: 0.7,
  },
  entry: {
    gap: 4,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#999",
  },
  json: {
    fontFamily: "SpaceMono",
    fontSize: 11,
    lineHeight: 15,
  },
});
