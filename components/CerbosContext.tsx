import {
  CheckResourceRequest,
  CheckResourcesRequest,
  CheckResourcesResponse,
  CheckResourcesResult,
  IsAllowedRequest,
  PlanExpression,
  PlanExpressionOperand,
  PlanExpressionValue,
  PlanExpressionVariable,
  PlanKind,
  PlanResourcesRequest,
  PlanResourcesResponse,
  ValidationError,
} from "@cerbos/core";
import { randomUUID } from "expo-crypto";
import type { DOMProps } from "expo/dom";
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";

import { readCachedBundle, writeCachedBundle } from "./cerbosBundleCache";
import CerbosEmbeddedPDPWebView from "./CerbosEmbeddedPDPWebView";
import type {
  DecodedJWTPayload,
  EngineOptions,
  EvaluateRequest,
  HubOptions,
  JWTToDecode,
  PDPMetadata,
  PDPRequest,
  PDPResult,
  PDPWebViewHandle,
  SerializedBundle,
  SerializedCheckResourcesResponse,
  SerializedDecisionLogEntry,
  SerializedPDPResponse,
  SerializedPlanExpressionOperand,
  SerializedPlanResourcesResponse,
} from "./cerbosTypes";

export type {
  DecodedJWTPayload,
  EngineOptions,
  HubOptions,
  JWTToDecode,
  PDPMetadata,
  SerializedDecisionLogEntry,
} from "./cerbosTypes";

/**
 * - `loading`: no bundle is active yet (starting, or the WebView is restarting).
 * - `ready`: requests are being evaluated.
 * - `error`: no bundle could be loaded; loading keeps being retried.
 */
export type CerbosStatus = "loading" | "ready" | "error";

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type PlanResourcesRequestInput = DistributiveOmit<
  PlanResourcesRequest,
  "requestId"
>;

interface CerbosContextType {
  status: CerbosStatus;
  /** `true` when `status` is `ready`. */
  isLoaded: boolean;
  /** The active bundle, once loaded. */
  metadata: PDPMetadata | undefined;
  /** Why the PDP failed to load, if it did. */
  error: string | undefined;
  /** Why the last check for a newer bundle failed, if it did. The current bundle keeps serving. */
  updateError: string | undefined;
  checkResources: (
    request: Omit<CheckResourcesRequest, "requestId">
  ) => Promise<CheckResourcesResponse>;
  checkResource: (
    request: Omit<CheckResourceRequest, "requestId">
  ) => Promise<CheckResourcesResult>;
  /** Resolves to `false` if the action isn't in the result. */
  isAllowed: (request: Omit<IsAllowedRequest, "requestId">) => Promise<boolean>;
  planResources: (
    request: PlanResourcesRequestInput
  ) => Promise<PlanResourcesResponse>;
}

const CerbosContext = createContext<CerbosContextType | undefined>(undefined);

export interface CerbosProviderProps {
  children: ReactNode;
  /** The ePDP rule ID, from your deployment's "Embedded PDP rules" tab in Cerbos Hub. */
  ruleId: string;
  /** Scopes to include in the bundle (default: all). */
  scopes?: string[];
  /** Where to download bundles from (default: the public Cerbos Hub API). */
  hub?: HubOptions;
  engineOptions?: EngineOptions;
  /** Seconds between checks for a newer bundle (default: 300). `0` disables. */
  refreshIntervalSeconds?: number;
  /** Milliseconds to wait for a decision before rejecting (default: 10000). */
  requestTimeout?: number;
  onDecision?: (decision: SerializedDecisionLogEntry) => void;
  /** A check for a newer bundle failed; the current bundle keeps serving. */
  onUpdateError?: (message: string) => void;
  /** Attributes failed schema validation (needs `engineOptions.schemaEnforcement`). */
  onValidationError?: (validationErrors: ValidationError[]) => void;
  /** Verify a JWT from `auxData.jwt` and return its claims. Required to use `auxData.jwt`. */
  decodeJWTPayload?: (
    jwt: JWTToDecode
  ) => DecodedJWTPayload | Promise<DecodedJWTPayload>;
}

interface PendingRequest {
  resolve: (value: SerializedPDPResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Request IDs only correlate responses with promises. `randomUUID` needs a
// secure context on web, so fall back to a non-cryptographic ID there.
function newRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function deserializeCheckResourcesResponse(
  response: SerializedCheckResourcesResponse
): CheckResourcesResponse {
  return new CheckResourcesResponse({
    requestId: response.requestId,
    cerbosCallId: response.cerbosCallId,
    results: response.results.map(
      ({ resource, actions, validationErrors, metadata, outputs }) =>
        new CheckResourcesResult({
          resource,
          actions,
          validationErrors,
          metadata: metadata ?? undefined,
          outputs,
        })
    ),
  });
}

function deserializePlanExpressionOperand(
  operand: SerializedPlanExpressionOperand
): PlanExpressionOperand {
  if ("operator" in operand) {
    return new PlanExpression(
      operand.operator,
      operand.operands.map(deserializePlanExpressionOperand)
    );
  }
  if ("value" in operand) {
    return new PlanExpressionValue(operand.value);
  }
  return new PlanExpressionVariable(operand.name);
}

function deserializePlanResourcesResponse(
  response: SerializedPlanResourcesResponse
): PlanResourcesResponse {
  const base = {
    requestId: response.requestId,
    cerbosCallId: response.cerbosCallId,
    validationErrors: response.validationErrors,
    metadata: response.metadata ?? undefined,
  };
  if (response.kind === PlanKind.CONDITIONAL) {
    if (!response.condition) {
      throw new Error("Conditional query plan is missing its condition");
    }
    return {
      ...base,
      kind: PlanKind.CONDITIONAL,
      condition: deserializePlanExpressionOperand(response.condition),
    };
  }
  return { ...base, kind: response.kind };
}

/**
 * The WebView may only load the bundled DOM component: from the app
 * (`file://`), or from Metro (`http://`) in development.
 */
export function isAllowedWebViewNavigation(url: string): boolean {
  if (url.startsWith("file:") || url.startsWith("about:")) {
    return true;
  }
  if (__DEV__ && /^https?:\/\//.test(url)) {
    return true;
  }
  console.warn(`[CerbosProvider] Blocked WebView navigation to ${url}`);
  return false;
}

/** Keep a value's identity while it is equal by value. */
function useStableValue<T>(value: T): T {
  const key = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key]);
}

/** A stable function that always calls the latest `fn`. */
function useLatest<Args extends unknown[], R>(
  fn: ((...args: Args) => R) | undefined
): (...args: Args) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current!(...args), []);
}

/**
 * Runs an embedded Cerbos PDP in a hidden WebView and provides it through
 * {@link useCerbos}. Bundles come from Cerbos Hub and are cached on device.
 */
export const CerbosProvider: React.FC<CerbosProviderProps> = (props) => {
  // Start from scratch when the rule changes.
  return <CerbosProviderForRule key={props.ruleId} {...props} />;
};

const CerbosProviderForRule: React.FC<CerbosProviderProps> = ({
  children,
  ruleId,
  scopes,
  hub,
  engineOptions,
  refreshIntervalSeconds = 300,
  requestTimeout = 10_000,
  onDecision,
  onUpdateError,
  onValidationError,
  decodeJWTPayload,
}) => {
  // The cached bundle (`undefined` until the cache has been read).
  const [initialBundle, setInitialBundle] = useState<
    SerializedBundle | null | undefined
  >(undefined);
  const [metadata, setMetadata] = useState<PDPMetadata | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [updateError, setUpdateError] = useState<string | undefined>(
    undefined
  );

  const webView = useRef<PDPWebViewHandle>(null);
  const pending = useRef(new Map<string, PendingRequest>());
  const queue = useRef<EvaluateRequest[]>([]);
  const isLoaded = metadata !== undefined;
  const status: CerbosStatus = isLoaded
    ? "ready"
    : error !== undefined
      ? "error"
      : "loading";

  useEffect(() => {
    let mounted = true;
    readCachedBundle(ruleId)
      .catch(() => null) // start without the cache rather than not at all
      .then((bundle) => {
        if (mounted) {
          setInitialBundle(bundle);
        }
      });
    return () => {
      mounted = false;
    };
  }, [ruleId]);

  // Send everything queued in this tick to the WebView in one call.
  const flush = useCallback(() => {
    const batch = queue.current.splice(0);
    if (batch.length > 0) {
      webView.current?.evaluate(batch);
    }
  }, []);

  const submit = useCallback(
    (requestId: string, request: PDPRequest): Promise<SerializedPDPResponse> => {
      if (!isLoaded) {
        return Promise.reject(new Error(error ?? "Cerbos PDP is not loaded yet"));
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.current.delete(requestId);
          reject(
            new Error(`Cerbos request ${requestId} timed out after ${requestTimeout}ms`)
          );
        }, requestTimeout);
        pending.current.set(requestId, { resolve, reject, timeout });

        queue.current.push({ requestId, request });
        if (queue.current.length === 1) {
          queueMicrotask(flush);
        }
      });
    },
    [isLoaded, error, requestTimeout, flush]
  );

  const checkResources = useCallback(
    async (
      request: Omit<CheckResourcesRequest, "requestId">
    ): Promise<CheckResourcesResponse> => {
      const requestId = newRequestId();
      const result = await submit(requestId, {
        kind: "checkResources",
        request: { ...request, requestId },
      });
      if (result.kind !== "checkResources") {
        throw new Error(`Unexpected ${result.kind} response`);
      }
      return deserializeCheckResourcesResponse(result.response);
    },
    [submit]
  );

  const checkResource = useCallback(
    async ({
      resource,
      actions,
      ...rest
    }: Omit<CheckResourceRequest, "requestId">): Promise<CheckResourcesResult> => {
      const response = await checkResources({
        ...rest,
        resources: [{ resource, actions }],
      });
      const result = response.findResult(resource);
      if (!result) {
        throw new Error("No result for the requested resource");
      }
      return result;
    },
    [checkResources]
  );

  const isAllowed = useCallback(
    async ({
      action,
      ...rest
    }: Omit<IsAllowedRequest, "requestId">): Promise<boolean> => {
      const result = await checkResource({ ...rest, actions: [action] });
      return result.isAllowed(action) ?? false;
    },
    [checkResource]
  );

  const planResources = useCallback(
    async (request: PlanResourcesRequestInput): Promise<PlanResourcesResponse> => {
      const requestId = newRequestId();
      const result = await submit(requestId, {
        kind: "planResources",
        request: { ...request, requestId },
      });
      if (result.kind !== "planResources") {
        throw new Error(`Unexpected ${result.kind} response`);
      }
      return deserializePlanResourcesResponse(result.response);
    },
    [submit]
  );

  // Reject anything still pending on unmount.
  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const [requestId, { reject, timeout }] of requests) {
        clearTimeout(timeout);
        reject(new Error(`Cerbos request ${requestId} cancelled: provider unmounted`));
      }
      requests.clear();
    };
  }, []);

  const handleResults = useCallback((results: PDPResult[]) => {
    for (const result of results) {
      const request = pending.current.get(result.requestId);
      if (!request) {
        continue; // timed out
      }
      pending.current.delete(result.requestId);
      clearTimeout(request.timeout);
      if ("response" in result) {
        request.resolve(result.response);
      } else {
        request.reject(new Error(result.error));
      }
    }
  }, []);

  const handleBundleDownloaded = useCallback(
    (bundle: SerializedBundle) => {
      void writeCachedBundle(ruleId, bundle);
    },
    [ruleId]
  );

  const handlePDPUpdated = useCallback((updated: PDPMetadata) => {
    setMetadata(updated);
    setError(undefined);
  }, []);

  const handleLoadError = useCallback((message: string) => {
    console.error(`[CerbosProvider] Embedded PDP failed to load: ${message}`);
    setError(message);
  }, []);

  const notifyUpdateError = useLatest(onUpdateError);
  const hasUpdateErrorHandler = onUpdateError !== undefined;
  const handleUpdateResult = useCallback(
    (message: string | null) => {
      setUpdateError(message ?? undefined);
      if (message !== null && hasUpdateErrorHandler) {
        notifyUpdateError(message);
      }
    },
    [hasUpdateErrorHandler, notifyUpdateError]
  );

  // The WebView is starting, or restarting after the OS killed it: not ready
  // until the DOM component reports a bundle again.
  const handleWebViewLoadStart = useCallback(() => {
    setMetadata(undefined);
  }, []);

  // The WebView only does background work, so lock it down.
  // `react-native-webview` (rather than Expo's DOM WebView) supports these options.
  const domProps = useMemo<DOMProps>(
    () => ({
      style: { height: 0 },
      matchContents: false,
      useExpoDOMWebView: false,
      onShouldStartLoadWithRequest: (request) =>
        isAllowedWebViewNavigation(request.url),
      onLoadStart: handleWebViewLoadStart,
      setSupportMultipleWindows: false,
      javaScriptCanOpenWindowsAutomatically: false,
      allowsBackForwardNavigationGestures: false,
      allowsLinkPreview: false,
    }),
    [handleWebViewLoadStart]
  );

  // Every render of the DOM component re-sends all of its props (including the
  // bundle) across the bridge, so only re-render it when they really change.
  const stableScopes = useStableValue(scopes);
  const stableHub = useStableValue(hub);
  const stableEngineOptions = useStableValue(engineOptions);
  const logDecisions = useLatest(
    (entries: SerializedDecisionLogEntry[]) => entries.forEach((entry) => onDecision?.(entry))
  );
  const validationErrorHandler = useLatest(onValidationError);
  const jwtDecoder = useLatest(decodeJWTPayload);
  const hasDecisionHandler = onDecision !== undefined;
  const hasValidationErrorHandler = onValidationError !== undefined;
  const hasJWTDecoder = decodeJWTPayload !== undefined;

  const pdpWebView = useMemo(
    () =>
      initialBundle !== undefined && (
        <View style={{ height: 0, width: 0, opacity: 0 }}>
          <CerbosEmbeddedPDPWebView
            ref={webView}
            ruleId={ruleId}
            scopes={stableScopes}
            hub={stableHub}
            engineOptions={stableEngineOptions}
            initialBundle={initialBundle}
            refreshIntervalSeconds={refreshIntervalSeconds}
            handleBundleDownloaded={handleBundleDownloaded}
            handlePDPUpdated={handlePDPUpdated}
            handleLoadError={handleLoadError}
            handleUpdateResult={handleUpdateResult}
            handleResults={handleResults}
            handleDecisionLogs={hasDecisionHandler ? logDecisions : undefined}
            handleValidationError={
              hasValidationErrorHandler ? validationErrorHandler : undefined
            }
            handleDecodeJWTPayload={hasJWTDecoder ? jwtDecoder : undefined}
            dom={domProps}
          />
        </View>
      ),
    [
      initialBundle,
      ruleId,
      stableScopes,
      stableHub,
      stableEngineOptions,
      refreshIntervalSeconds,
      handleBundleDownloaded,
      handlePDPUpdated,
      handleLoadError,
      handleUpdateResult,
      handleResults,
      hasDecisionHandler,
      logDecisions,
      hasValidationErrorHandler,
      validationErrorHandler,
      hasJWTDecoder,
      jwtDecoder,
      domProps,
    ]
  );

  const contextValue = useMemo<CerbosContextType>(
    () => ({
      status,
      isLoaded,
      metadata,
      error,
      updateError,
      checkResources,
      checkResource,
      isAllowed,
      planResources,
    }),
    [
      status,
      isLoaded,
      metadata,
      error,
      updateError,
      checkResources,
      checkResource,
      isAllowed,
      planResources,
    ]
  );

  return (
    <CerbosContext.Provider value={contextValue}>
      {children}
      {pdpWebView}
    </CerbosContext.Provider>
  );
};

export const useCerbos = (): CerbosContextType => {
  const context = useContext(CerbosContext);
  if (context === undefined) {
    throw new Error("useCerbos must be used within a CerbosProvider");
  }
  return context;
};
