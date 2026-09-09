import { useState } from "react";
import { Button, ScrollView, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCerbos } from "@/components/CerbosContext";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

interface RpcScreenProps<Request> {
  title: string;
  description: string;
  /** The request shown in the editor initially. */
  defaultRequest: Request;
  /** Runs the request and returns something to display. */
  run: (request: Request) => Promise<unknown>;
}

/**
 * A screen with a JSON editor for a request, a button to run it against the
 * embedded PDP, and the (JSON) result.
 */
export function RpcScreen<Request>({
  title,
  description,
  defaultRequest,
  run,
}: RpcScreenProps<Request>) {
  const { isLoaded } = useCerbos();
  const [requestJson, setRequestJson] = useState(() =>
    JSON.stringify(defaultRequest, null, 2)
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      let request: Request;
      try {
        request = JSON.parse(requestJson) as Request;
      } catch (caught) {
        throw new Error(
          `Request is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`
        );
      }
      const started = Date.now();
      const response = await run(request);
      setResult(
        `${JSON.stringify(response, null, 2)}\n\n(${Date.now() - started}ms)`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      <SafeAreaView>
        <ThemedView style={styles.section}>
          <ThemedText type="title">{title}</ThemedText>
          <ThemedText style={styles.muted}>{description}</ThemedText>
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText style={styles.label}>Request (JSON)</ThemedText>
          <TextInput
            style={styles.editor}
            value={requestJson}
            onChangeText={setRequestJson}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
            testID="request-editor"
          />
          <Button
            title={running ? "Running…" : `Run ${title}`}
            onPress={onRun}
            disabled={!isLoaded || running}
          />
          {!isLoaded && (
            <ThemedText style={styles.muted}>
              Waiting for the Cerbos PDP to load…
            </ThemedText>
          )}
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText style={styles.label}>Result</ThemedText>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <ThemedText style={styles.result} selectable>
            {result ?? (error ? "" : "(no result yet)")}
          </ThemedText>
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
  editor: {
    minHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#999",
    borderRadius: 8,
    padding: 12,
    fontFamily: "SpaceMono",
    fontSize: 12,
    color: "#151E26",
    backgroundColor: "#E9ECEF",
  },
  error: {
    color: "#E53935",
  },
  result: {
    fontFamily: "SpaceMono",
    fontSize: 12,
    lineHeight: 16,
  },
});
