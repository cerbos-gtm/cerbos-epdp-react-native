import { useCerbos } from "@/components/CerbosContext";
import { PrincipalPicker } from "@/components/PrincipalPicker";
import { ResourcePicker } from "@/components/ResourcePicker";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { principals, resources } from "@/constants/data";
import type { CheckResourcesResponse, Principal, Resource } from "@cerbos/core";

import { useState } from "react";
import { Button, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function HomeScreen() {
  const { isLoaded, metadata, error } = useCerbos(); // Access Cerbos context
  const [principal, setPrincipal] = useState<Principal>(principals[0]); // Selected principal
  const [resource, setResource] = useState<Resource>(resources[0]); // Selected resource

  return (
    <ScrollView style={{ flex: 1 }}>
      <SafeAreaView>
        <ThemedView style={styles.titleContainer}>
          <ThemedText type="title">Cerbos ePDP Demo</ThemedText>
        </ThemedView>

        {/* Dropdowns for selecting principal and resource */}
        <ThemedView style={styles.dropdownContainer}>
          <PrincipalPicker principal={principal} setPrincipal={setPrincipal} />
          <ResourcePicker resource={resource} setResource={setResource} />
        </ThemedView>

        {/* Cerbos PDP loading state */}
        {!isLoaded && !error && (
          <ThemedText style={styles.statusText}>Loading Cerbos PDP...</ThemedText>
        )}
        {error && (
          <ThemedText style={[styles.statusText, styles.deniedText]}>
            Failed to load Cerbos PDP: {error}
          </ThemedText>
        )}

        {/* Authorization check example */}
        <SampleAuthCheck
          principal={principal}
          resource={resource}
          actions={["create", "read", "update", "delete"]}
        />

        {/* Display details of the active policy bundle */}
        {metadata && (
          <>
            <ThemedText style={styles.timestampText}>
              Policy bundle loaded at: {metadata.updatedAt} (from{" "}
              {metadata.source})
            </ThemedText>
            <ThemedText style={styles.timestampText}>
              Bundle: {metadata.bundle.bundleId} (revision{" "}
              {metadata.bundle.ruleRevision})
            </ThemedText>
            <ThemedText style={styles.timestampText}>
              Cerbos version: {metadata.cerbosVersion}
            </ThemedText>
          </>
        )}
      </SafeAreaView>
    </ScrollView>
  );
}

// Component to perform and display authorization checks
function SampleAuthCheck({
  principal,
  resource,
  actions,
}: {
  principal: Principal;
  resource: Resource;
  actions: string[];
}) {
  const { checkResources, isLoaded } = useCerbos(); // Access Cerbos context
  // The latest outcome, remembering which inputs it was for so that it is only
  // shown while those inputs are still selected.
  const [outcome, setOutcome] = useState<{
    principal: Principal;
    resource: Resource;
    result: CheckResourcesResponse | null;
    error: string | null;
  } | null>(null);

  // Function to check permissions
  const checkAccess = async () => {
    try {
      const result = await checkResources({
        principal,
        resources: [{ resource, actions }],
      });
      console.log("[App] Auth check result:", JSON.stringify(result));
      setOutcome({ principal, resource, result, error: null });
    } catch (err) {
      console.error("[App] Auth check failed:", err);
      setOutcome({
        principal,
        resource,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Ignore results for a different principal or resource
  const current =
    outcome?.principal === principal && outcome.resource === resource
      ? outcome
      : null;
  const result = current?.result ?? null;
  const checkError = current?.error ?? null;

  return (
    <ThemedView style={styles.stepContainer}>
      <Button
        title="Check Permissions"
        onPress={checkAccess}
        disabled={!isLoaded}
      />
      {actions.map((action) => (
        <ThemedView style={styles.actionRow} key={action}>
          <ThemedText>{action}:</ThemedText>
          {result ? (
            result.isAllowed({ resource, action }) ? (
              <ThemedText style={styles.allowedText}>Allowed</ThemedText>
            ) : (
              <ThemedText style={styles.deniedText}>Denied</ThemedText>
            )
          ) : (
            <ThemedText>-</ThemedText>
          )}
        </ThemedView>
      ))}
      {checkError && (
        <ThemedText style={styles.deniedText}>{checkError}</ThemedText>
      )}
    </ThemedView>
  );
}

// Styles for the component
const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    gap: 8,
    padding: 16,
  },
  dropdownContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  statusText: {
    padding: 16,
    textAlign: "center",
  },
  stepContainer: {
    gap: 8,
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  allowedText: {
    color: "#43A047",
  },
  deniedText: {
    color: "#E53935",
  },
  timestampText: {
    fontSize: 12,
    textAlign: "center",
  },
});
