import { useState } from "react";
import { Button, ScrollView, StyleSheet, Switch, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCerbos, type EngineOptions } from "@/components/CerbosContext";
import { useDemo, type DemoConfig } from "@/components/demo/DemoContext";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

/**
 * Shows the state of the embedded PDP and lets you reconfigure it at runtime:
 * the Cerbos Hub rule to load policies from, engine options and which
 * callbacks to enable. Applying a new rule ID restarts the PDP.
 */
export default function EpdpScreen() {
  const { status, metadata, error, updateError } = useCerbos();
  const { config, applyConfig } = useDemo();

  const [ruleId, setRuleId] = useState(config.ruleId);
  const [hubBaseUrl, setHubBaseUrl] = useState(config.hubBaseUrl);
  const [engineOptionsJson, setEngineOptionsJson] = useState(() =>
    JSON.stringify(config.engineOptions, null, 2)
  );
  const [logDecisions, setLogDecisions] = useState(config.logDecisions);
  const [logValidationErrors, setLogValidationErrors] = useState(
    config.logValidationErrors
  );
  const [decodeJWTs, setDecodeJWTs] = useState(config.decodeJWTs);
  const [configError, setConfigError] = useState<string | null>(null);

  const onApply = () => {
    let engineOptions: EngineOptions;
    try {
      engineOptions = JSON.parse(engineOptionsJson || "{}") as EngineOptions;
    } catch (caught) {
      setConfigError(
        `Engine options are not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`
      );
      return;
    }
    if (!ruleId.trim()) {
      setConfigError("A rule ID is required");
      return;
    }
    setConfigError(null);
    const next: DemoConfig = {
      ruleId: ruleId.trim(),
      hubBaseUrl: hubBaseUrl.trim() || "https://api.cerbos.cloud",
      engineOptions,
      logDecisions,
      logValidationErrors,
      decodeJWTs,
    };
    applyConfig(next);
  };

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      <SafeAreaView>
        <ThemedView style={styles.section}>
          <ThemedText type="title">Cerbos ePDP</ThemedText>
          <ThemedText style={styles.muted}>
            An embedded policy decision point running on this device, with
            policies from Cerbos Hub.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Status</ThemedText>
          <ThemedText>
            {status === "ready"
              ? "Ready"
              : status === "error"
                ? "Failed to load"
                : "Loading…"}
          </ThemedText>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {updateError && (
            <ThemedText style={styles.error}>
              Policy update check failed (serving the current bundle):{" "}
              {updateError}
            </ThemedText>
          )}
          {metadata && (
            <>
              <ThemedText style={styles.detail}>
                Bundle {metadata.bundle.bundleId} (revision{" "}
                {metadata.bundle.ruleRevision}), from {metadata.source}
              </ThemedText>
              <ThemedText style={styles.detail}>
                Loaded at {metadata.updatedAt}
              </ThemedText>
              <ThemedText style={styles.detail}>
                Cerbos {metadata.cerbosVersion}
              </ThemedText>
            </>
          )}
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Cerbos Hub</ThemedText>
          <ThemedText style={styles.label}>Rule ID</ThemedText>
          <TextInput
            style={styles.input}
            value={ruleId}
            onChangeText={setRuleId}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. B5LU9EVYN1MD"
          />
          <ThemedText style={styles.label}>API base URL</ThemedText>
          <TextInput
            style={styles.input}
            value={hubBaseUrl}
            onChangeText={setHubBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://api.cerbos.cloud"
          />
          <ThemedText style={styles.muted}>
            Rules downloaded directly by the app must allow public access.
            Point the base URL at a backend of your own to use client
            credentials without shipping them in the app.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Engine options</ThemedText>
          <TextInput
            style={[styles.input, styles.editor]}
            value={engineOptionsJson}
            onChangeText={setEngineOptionsJson}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
          />
          <ThemedText style={styles.muted}>
            defaultPolicyVersion, defaultScope, globals, lenientScopeSearch,
            schemaEnforcement (none, warn, reject), strictEvaluation
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="subtitle">Callbacks</ThemedText>
          <ThemedView style={styles.toggleRow}>
            <ThemedText>onDecision (decision log)</ThemedText>
            <Switch value={logDecisions} onValueChange={setLogDecisions} />
          </ThemedView>
          <ThemedView style={styles.toggleRow}>
            <ThemedText>onValidationError</ThemedText>
            <Switch
              value={logValidationErrors}
              onValueChange={setLogValidationErrors}
            />
          </ThemedView>
          <ThemedView style={styles.toggleRow}>
            <ThemedText>decodeJWTPayload (unverified, demo only)</ThemedText>
            <Switch value={decodeJWTs} onValueChange={setDecodeJWTs} />
          </ThemedView>
        </ThemedView>

        <ThemedView style={styles.section}>
          <Button title="Apply configuration" onPress={onApply} />
          {configError && (
            <ThemedText style={styles.error}>{configError}</ThemedText>
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
  label: {
    fontSize: 12,
    opacity: 0.7,
  },
  muted: {
    fontSize: 12,
    opacity: 0.7,
  },
  detail: {
    fontSize: 12,
  },
  error: {
    color: "#E53935",
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#999",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#151E26",
    backgroundColor: "#E9ECEF",
  },
  editor: {
    minHeight: 120,
    fontFamily: "SpaceMono",
    fontSize: 12,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});
