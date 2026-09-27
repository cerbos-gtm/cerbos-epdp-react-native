import type { CheckResourcesResponse, Principal, Resource } from "@cerbos/core";
import { useState } from "react";
import { Button, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCerbos } from "@/components/CerbosContext";
import { Picker } from "@/components/demo/Picker";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { principals, resources } from "@/constants/data";

const actions = ["create", "read", "update", "delete"];

/**
 * Pick a principal and a resource, and see which actions are allowed.
 */
export default function CheckResourcesScreen() {
  const { checkResources, isLoaded, error } = useCerbos();
  const [principal, setPrincipal] = useState<Principal>(principals[0]);
  const [resource, setResource] = useState<Resource>(resources[0]);
  // The latest outcome, and the inputs it was for.
  const [outcome, setOutcome] = useState<{
    principal: Principal;
    resource: Resource;
    result?: CheckResourcesResponse;
    error?: string;
  } | null>(null);

  const check = async () => {
    try {
      const result = await checkResources({
        principal,
        resources: [{ resource, actions }],
      });
      setOutcome({ principal, resource, result });
    } catch (caught) {
      setOutcome({
        principal,
        resource,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  // Only show the outcome while its inputs are still selected.
  const current =
    outcome?.principal === principal && outcome.resource === resource
      ? outcome
      : null;

  return (
    <ScrollView style={{ flex: 1 }}>
      <SafeAreaView>
        <ThemedView style={styles.section}>
          <ThemedText type="title">checkResources</ThemedText>
        </ThemedView>

        <ThemedView style={styles.pickers}>
          <Picker
            label="Principal"
            items={principals}
            selected={principal}
            onSelect={setPrincipal}
          />
          <Picker
            label="Resource"
            items={resources}
            selected={resource}
            onSelect={setResource}
          />
        </ThemedView>

        {!isLoaded && !error && (
          <ThemedText style={styles.status}>Loading Cerbos PDP...</ThemedText>
        )}
        {error && (
          <ThemedText style={[styles.status, styles.denied]}>
            Failed to load Cerbos PDP: {error}
          </ThemedText>
        )}

        <ThemedView style={styles.section}>
          <Button title="Check Permissions" onPress={check} disabled={!isLoaded} />
          {actions.map((action) => (
            <ThemedView style={styles.row} key={action}>
              <ThemedText>{action}:</ThemedText>
              {current?.result ? (
                current.result.isAllowed({ resource, action }) ? (
                  <ThemedText style={styles.allowed}>Allowed</ThemedText>
                ) : (
                  <ThemedText style={styles.denied}>Denied</ThemedText>
                )
              ) : (
                <ThemedText>-</ThemedText>
              )}
            </ThemedView>
          ))}
          {current?.error && (
            <ThemedText style={styles.denied}>{current.error}</ThemedText>
          )}
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
  pickers: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  status: {
    padding: 16,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  allowed: {
    color: "#43A047",
  },
  denied: {
    color: "#E53935",
  },
});
