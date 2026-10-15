"use dom";

import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import { BundleService } from "@cerbos/api/cerbos/cloud/epdp/v2/epdp_pb";
import {
  PlanExpression,
  PlanExpressionValue,
  PlanExpressionVariable,
  type CheckResourcesResponse,
  type DecisionLogEntry,
  type PlanExpressionOperand,
  type PlanResourcesResponse,
  type ValidationError,
} from "@cerbos/core";
import { Embedded } from "@cerbos/embedded-client";
import { metadata as serverMetadata } from "@cerbos/embedded-server";
import serverWasmUrl from "@cerbos/embedded-server/server.wasm";
import { createClient } from "@cerbos/hub/~internal";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  useDOMImperativeHandle,
  type DOMImperativeFactory,
  type DOMProps,
} from "expo/dom";
import { useEffect, useRef, type Ref } from "react";

import type {
  BundleMetadata,
  DecodedJWTPayload,
  EngineOptions,
  HubOptions,
  JWTToDecode,
  PDPMetadata,
  PDPRequest,
  PDPResult,
  PDPWebViewHandle,
  SerializedBundle,
  SerializedDecisionLogEntry,
  SerializedPDPResponse,
  SerializedPlanExpressionOperand,
} from "./cerbosTypes";

// An Expo DOM component: bundled for the web and run in a hidden WebView,
// because React Native has no WebAssembly runtime. It runs the Cerbos engine
// and keeps its policy bundle up to date from Cerbos Hub.
//
// React Native sends requests with `ref.evaluate(...)` (one injected call per
// batch, no re-render) and gets the results back through `handleResults`.

interface Props {
  ref: Ref<PDPWebViewHandle>;
  ruleId: string;
  /** Scopes to include in the bundle (all scopes if empty). */
  scopes?: string[];
  hub?: HubOptions;
  engineOptions?: EngineOptions;
  /** A cached bundle to start with while checking Cerbos Hub for a newer one. */
  initialBundle?: SerializedBundle | null;
  /** Seconds between checks for a newer bundle. `0` disables. */
  refreshIntervalSeconds: number;
  /** A bundle from Cerbos Hub was activated; cache it. */
  handleBundleDownloaded: (bundle: SerializedBundle) => void;
  /** A bundle was activated and requests can be evaluated. */
  handlePDPUpdated: (metadata: PDPMetadata) => void;
  /** No bundle could be loaded (loading keeps being retried). */
  handleLoadError: (message: string) => void;
  /** Outcome of each check for a newer bundle: `null` on success. */
  handleUpdateResult: (error: string | null) => void;
  /** Results of a batch passed to `evaluate`. */
  handleResults: (results: PDPResult[]) => void;
  handleDecisionLogs?: (entries: SerializedDecisionLogEntry[]) => void;
  handleValidationError?: (validationErrors: ValidationError[]) => void;
  handleDecodeJWTPayload?: (
    jwt: JWTToDecode
  ) => DecodedJWTPayload | Promise<DecodedJWTPayload>;
  dom?: DOMProps;
}

type Callbacks = Omit<
  Props,
  | "ref"
  | "ruleId"
  | "scopes"
  | "hub"
  | "engineOptions"
  | "initialBundle"
  | "refreshIntervalSeconds"
  | "dom"
>;

interface Bundle {
  metadata: BundleMetadata;
  contents: Uint8Array<ArrayBuffer>;
}

// Seconds between attempts to download the first bundle when there's no cache.
const INITIAL_RETRY_DELAYS_SECONDS = [2, 4, 8, 16, 32, 60];

const debug: (...args: unknown[]) => void = __DEV__
  ? (...args) => console.log("[CerbosWebView]", ...args)
  : () => {};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  // `crypto.subtle` needs a secure context, which the plain-HTTP dev server isn't.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    return bytesToHex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
  }
  return bytesToHex(sha256(new Uint8Array(bytes)));
}

// Compile the engine once per WebView; each bundle update only instantiates it.
function loadEngine(
  cache: { current: Promise<WebAssembly.Module> | undefined }
): Promise<WebAssembly.Module> {
  cache.current ??= (async () => {
    // Not `compileStreaming`: `file://` responses have no `application/wasm` type.
    const response = await fetch(serverWasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load ${serverWasmUrl}: HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();

    // Refuse an engine that doesn't match the one the SDK was published with.
    const checksum = await sha256Hex(bytes);
    if (checksum !== serverMetadata.wasmChecksum) {
      throw new Error(
        `Embedded PDP integrity check failed: expected SHA-256 ${serverMetadata.wasmChecksum} but got ${checksum}`
      );
    }

    return WebAssembly.compile(bytes);
  })().catch((error: unknown) => {
    cache.current = undefined; // let the next attempt retry
    throw error;
  });
  return cache.current;
}

/**
 * Download the latest bundle for the rule, or `undefined` if it hasn't
 * changed since `current`.
 */
async function fetchBundle(
  ruleId: string,
  scopes: string[],
  hub: HubOptions,
  current: BundleMetadata | undefined,
  signal: AbortSignal
): Promise<Bundle | undefined> {
  // The same API `PolicyLoader` in `@cerbos/embedded-client` uses. Calling it
  // directly lets React Native cache the bundle for offline use.
  const client = createClient(BundleService, {
    baseUrl: hub.baseUrl,
    credentials: hub.credentials,
  });

  const { result } = await client.getBundle(
    {
      ruleId,
      scopes,
      ifModifiedSince: current && {
        bundleId: current.bundleId,
        ruleRevision: BigInt(current.ruleRevision),
      },
    },
    { signal }
  );

  if (result.case !== "bundle") {
    return undefined;
  }

  const { metadata, contents } = result.value;
  return {
    metadata: {
      bundleId: metadata.bundleId,
      ruleRevision: metadata.ruleRevision.toString(),
    },
    // Copy: the engine reads the whole underlying buffer.
    contents: new Uint8Array(contents),
  };
}

function serializeCheckResourcesResponse(
  response: CheckResourcesResponse
): SerializedPDPResponse {
  return {
    kind: "checkResources",
    response: {
      requestId: response.requestId,
      cerbosCallId: response.cerbosCallId,
      results: response.results.map(
        ({ resource, actions, validationErrors, metadata, outputs }) => ({
          resource,
          actions,
          validationErrors,
          metadata: metadata ?? null,
          outputs,
        })
      ),
    },
  };
}

function serializePlanExpressionOperand(
  operand: PlanExpressionOperand
): SerializedPlanExpressionOperand {
  if (operand instanceof PlanExpression) {
    return {
      operator: operand.operator,
      operands: operand.operands.map(serializePlanExpressionOperand),
    };
  }
  if (operand instanceof PlanExpressionValue) {
    return { value: operand.value };
  }
  if (operand instanceof PlanExpressionVariable) {
    return { name: operand.name };
  }
  throw new Error("Unknown plan expression operand");
}

function serializePlanResourcesResponse(
  response: PlanResourcesResponse
): SerializedPDPResponse {
  return {
    kind: "planResources",
    response: {
      requestId: response.requestId,
      cerbosCallId: response.cerbosCallId,
      kind: response.kind,
      validationErrors: response.validationErrors,
      metadata: response.metadata ?? null,
      ...("condition" in response
        ? { condition: serializePlanExpressionOperand(response.condition) }
        : {}),
    },
  };
}

async function evaluate(
  client: Embedded,
  request: PDPRequest
): Promise<SerializedPDPResponse> {
  switch (request.kind) {
    case "checkResources":
      return serializeCheckResourcesResponse(
        await client.checkResources(request.request)
      );
    case "planResources":
      return serializePlanResourcesResponse(
        await client.planResources(request.request)
      );
  }
}

function serializeDecisionLogEntry(
  entry: DecisionLogEntry
): SerializedDecisionLogEntry {
  return { ...entry, timestamp: entry.timestamp.toISOString() };
}

// A request the engine hasn't seen, evaluated before reporting ready so the
// first real decision doesn't pay for the JIT warming up.
const WARM_UP_REQUEST = {
  requestId: "warm-up",
  principal: { id: "warm-up", roles: ["warm-up"] },
  resources: [
    { resource: { kind: "warm-up", id: "warm-up" }, actions: ["warm-up"] },
  ],
};

export default function CerbosEmbeddedPDPWebView({
  ref,
  ruleId,
  scopes = [],
  hub,
  engineOptions,
  initialBundle,
  refreshIntervalSeconds,
  ...callbackProps
}: Props) {
  // Callback props are proxies that call React Native by name, so a stale one
  // still works; keep the latest anyway, outside the effect dependencies.
  const callbacks = useRef<Callbacks>(callbackProps);
  useEffect(() => {
    callbacks.current = callbackProps;
  });

  const engine = useRef<Promise<WebAssembly.Module> | undefined>(undefined);
  const client = useRef<Embedded | null>(null);
  // Decision logs are sent after the results of the batch that produced them.
  const decisionLogs = useRef<SerializedDecisionLogEntry[]>([]);

  const handle: PDPWebViewHandle = {
    evaluate(batch) {
      const active = client.current;
      void Promise.all(
        batch.map(async ({ requestId, request }): Promise<PDPResult> => {
          if (!active) {
            return { requestId, error: "Cerbos PDP is not loaded yet" };
          }
          try {
            return { requestId, response: await evaluate(active, request) };
          } catch (error) {
            return { requestId, error: errorMessage(error) };
          }
        })
      ).then((results) => {
        callbacks.current.handleResults(results);
        const logs = decisionLogs.current.splice(0);
        if (logs.length > 0) {
          callbacks.current.handleDecisionLogs?.(logs);
        }
      });
    },
  };
  // The typing only allows JSON arguments; our requests are JSON.
  useDOMImperativeHandle(
    ref as Ref<DOMImperativeFactory>,
    () => handle as unknown as DOMImperativeFactory,
    []
  );

  // `initialBundle` only bootstraps; later bundles come from Cerbos Hub.
  const initialBundleRef = useRef(initialBundle);
  // Objects arrive as fresh JSON on every render, so compare them by value.
  const scopesKey = JSON.stringify(scopes);
  const hubKey = JSON.stringify(hub ?? {});
  const engineOptionsKey = JSON.stringify(engineOptions ?? {});
  // Absent callbacks are still proxies here, so pass their presence explicitly.
  const logDecisions = callbackProps.handleDecisionLogs !== undefined;
  const hasValidationErrorHandler =
    callbackProps.handleValidationError !== undefined;
  const hasJWTDecoder = callbackProps.handleDecodeJWTPayload !== undefined;

  // Load the engine and keep its bundle up to date.
  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    let active: BundleMetadata | undefined;
    let loading = false;
    let initialAttempt = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scopes: string[] = JSON.parse(scopesKey);
    const hub: HubOptions = JSON.parse(hubKey);
    const engineOptions: EngineOptions = JSON.parse(engineOptionsKey);

    const activate = async (
      bundle: Bundle,
      source: PDPMetadata["source"]
    ): Promise<void> => {
      debug(`Activating bundle ${bundle.metadata.bundleId} from ${source}`);

      let warmingUp = true;
      const next = new Embedded({
        ...engineOptions,
        policies: bundle.contents,
        wasm: loadEngine(engine),
        onDecision: logDecisions
          ? (entry) => {
              if (!warmingUp) {
                decisionLogs.current.push(serializeDecisionLogEntry(entry));
              }
            }
          : undefined,
        onValidationError: hasValidationErrorHandler
          ? (validationErrors) => {
              callbacks.current.handleValidationError?.(validationErrors);
            }
          : undefined,
        decodeJWTPayload: hasJWTDecoder
          ? async (jwt) => await callbacks.current.handleDecodeJWTPayload!(jwt)
          : undefined,
      });

      // Throws if the engine can't load the bundle, leaving the current one active.
      await next.checkResources(WARM_UP_REQUEST);
      warmingUp = false;

      if (signal.aborted) {
        return;
      }

      active = bundle.metadata;
      client.current = next;
      callbacks.current.handlePDPUpdated({
        updatedAt: new Date().toISOString(),
        source,
        bundle: bundle.metadata,
        cerbosVersion: serverMetadata.cerbosVersion,
      });
    };

    // Throws if Cerbos Hub can't be reached or the new bundle can't be loaded.
    const checkForUpdate = async (): Promise<void> => {
      const bundle = await fetchBundle(ruleId, scopes, hub, active, signal);
      if (signal.aborted || !bundle) {
        return;
      }
      // Cache only what the engine has loaded, so a bad download never
      // replaces a working cached bundle.
      await activate(bundle, "hub");
      if (!signal.aborted) {
        callbacks.current.handleBundleDownloaded(encodeBundle(bundle));
      }
    };

    const tryUpdate = async (): Promise<void> => {
      if (loading) {
        return;
      }
      loading = true;
      try {
        await checkForUpdate();
        if (!signal.aborted) {
          callbacks.current.handleUpdateResult(null);
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const message = errorMessage(error);
        if (!active) {
          callbacks.current.handleLoadError(message);
        }
        callbacks.current.handleUpdateResult(message);
      } finally {
        loading = false;
      }
    };

    // Until a bundle is active, retry with backoff; afterwards, poll.
    const scheduleNext = (): void => {
      clearTimeout(timeout);
      if (signal.aborted) {
        return;
      }
      let delaySeconds = refreshIntervalSeconds;
      if (!active) {
        delaySeconds =
          INITIAL_RETRY_DELAYS_SECONDS[
            Math.min(initialAttempt++, INITIAL_RETRY_DELAYS_SECONDS.length - 1)
          ];
      } else if (refreshIntervalSeconds <= 0) {
        return;
      }
      timeout = setTimeout(() => void attemptLoad(), delaySeconds * 1000);
    };

    const attemptLoad = async (): Promise<void> => {
      await tryUpdate();
      scheduleNext();
    };

    // Don't wait out the backoff once connectivity returns.
    const onOnline = (): void => {
      if (!active && !loading) {
        void attemptLoad();
      }
    };
    globalThis.addEventListener?.("online", onOnline);

    void (async () => {
      const cached = initialBundleRef.current;
      if (cached) {
        try {
          await activate(decodeBundle(cached), "cache");
        } catch (error) {
          console.warn("Failed to activate the cached bundle:", errorMessage(error));
        }
      }
      await attemptLoad();
    })();

    return () => {
      abort.abort();
      clearTimeout(timeout);
      globalThis.removeEventListener?.("online", onOnline);
    };
  }, [
    ruleId,
    scopesKey,
    hubKey,
    engineOptionsKey,
    refreshIntervalSeconds,
    logDecisions,
    hasValidationErrorHandler,
    hasJWTDecoder,
  ]);

  return null;
}

function decodeBundle(bundle: SerializedBundle): Bundle {
  return {
    metadata: bundle.metadata,
    contents: base64Decode(bundle.contentsBase64),
  };
}

function encodeBundle(bundle: Bundle): SerializedBundle {
  return {
    metadata: bundle.metadata,
    contentsBase64: base64Encode(bundle.contents),
  };
}
