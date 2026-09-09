import {
  CheckResourcesRequest,
  CheckResourcesResponse,
  CheckResourcesResult,
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
  PDPMetadata,
  SerializablePDPRequests,
  SerializedBundle,
  SerializedCheckResourcesResponse,
  SerializedDecisionLogEntry,
} from "./cerbosTypes";

export type { PDPMetadata, SerializedDecisionLogEntry } from "./cerbosTypes";

/**
 * Lifecycle of the embedded PDP.
 *
 * - `loading`: no policy bundle is active yet (starting up, or the WebView is
 *   restarting after being killed by the OS). Requests are rejected.
 * - `ready`: a bundle is active and requests are being evaluated.
 * - `error`: no bundle could be loaded (no cache and Cerbos Hub unreachable).
 *   Loading keeps being retried in the background.
 */
export type CerbosStatus = "loading" | "ready" | "error";

// The shape of the context provided to consumers.
interface CerbosContextType {
  /** Current lifecycle state of the embedded PDP. */
  status: CerbosStatus;
  /** `true` once the embedded PDP has loaded a policy bundle and can answer requests. */
  isLoaded: boolean;
  /** Details about the active policy bundle, once loaded. */
  metadata: PDPMetadata | undefined;
  /** The reason the embedded PDP failed to start, if it did. */
  error: string | undefined;
  /**
   * The reason the most recent check for policy updates failed, if it did.
   * `undefined` once a check succeeds. While set, the active bundle may be stale.
   */
  updateError: string | undefined;
  /** Check a principal's permissions on a set of resources. */
  checkResources: (
    request: Omit<CheckResourcesRequest, "requestId">
  ) => Promise<CheckResourcesResponse>;
}

const CerbosContext = createContext<CerbosContextType | undefined>(undefined);

export interface CerbosProviderProps {
  children: ReactNode;
  /**
   * ID of the ePDP policy bundling rule, from the "Embedded PDP rules" tab of
   * your deployment in Cerbos Hub.
   */
  ruleId: string;
  /** Scopes to include in the policy bundle (default: all scopes). */
  scopes?: string[];
  /** How often (in seconds) to check Cerbos Hub for policy updates (default: 300). `0` disables. */
  refreshIntervalSeconds?: number;
  /** Max time (in milliseconds) to wait for a `checkResources` response (default: 10000). */
  requestTimeout?: number;
  /** Time (in milliseconds) to wait for further requests before sending a batch to the WebView (default: 50). */
  batchInterval?: number;
  /** Max number of requests per batch (default: 10). */
  maxBatchSize?: number;
  /** Callback for decision logs produced by the embedded PDP. */
  onDecision?: (decision: SerializedDecisionLogEntry) => void;
  /** Callback invoked when a check for policy updates fails (the current bundle stays active). */
  onUpdateError?: (message: string) => void;
}

// A `checkResources` call that is waiting for the WebView to answer.
interface PendingRequest {
  request: CheckResourcesRequest;
  resolve: (value: CheckResourcesResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
}

// Request-level logging is only useful during development, and would leak
// principal and resource attributes into production logs.
const debug: (...args: unknown[]) => void = __DEV__
  ? (...args) => console.log(...args)
  : () => {};

// Request IDs only need to be unique within this app session (they correlate
// responses from the WebView with pending promises). `randomUUID` is native on
// iOS/Android, but on web it requires a secure context, so fall back to a
// non-cryptographic ID there.
function newRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _, ...remaining } = record;
  return remaining;
}

function deserializeResponse(
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

/**
 * The WebView only ever loads the DOM component bundled with the app: from
 * the app bundle (`file://`) in release builds and OTA updates, or from the
 * Metro development server (`http://`) in development. Refuse anything else.
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

/**
 * Runs an embedded Cerbos PDP (in a hidden WebView) and exposes it to the
 * component tree via {@link useCerbos}.
 *
 * The policy bundle is downloaded from Cerbos Hub and cached on device, so
 * that the PDP keeps working offline and starts quickly on subsequent launches.
 */
export const CerbosProvider: React.FC<CerbosProviderProps> = (props) => {
  // Remount (and so reset all state) when the rule changes.
  return <CerbosProviderForRule key={props.ruleId} {...props} />;
};

const CerbosProviderForRule: React.FC<CerbosProviderProps> = ({
  children,
  ruleId,
  scopes,
  refreshIntervalSeconds = 300,
  requestTimeout = 10_000,
  batchInterval = 50,
  maxBatchSize = 10,
  onDecision,
  onUpdateError,
}) => {
  // The cached bundle read from disk at startup (`undefined` while reading).
  const [initialBundle, setInitialBundle] = useState<
    SerializedBundle | null | undefined
  >(undefined);
  const [metadata, setMetadata] = useState<PDPMetadata | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [updateError, setUpdateError] = useState<string | undefined>(
    undefined
  );
  // Requests currently handed to the WebView for evaluation.
  const [batchedRequests, setBatchedRequests] =
    useState<SerializablePDPRequests>({});

  const pendingRequests = useRef(new Map<string, PendingRequest>());
  const queuedRequestIds = useRef<string[]>([]);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Batching settings, readable from the stable `flushQueue` below.
  const batching = useRef({ batchInterval, maxBatchSize });
  useEffect(() => {
    batching.current = { batchInterval, maxBatchSize };
  }, [batchInterval, maxBatchSize]);
  const onUpdateErrorRef = useRef(onUpdateError);
  useEffect(() => {
    onUpdateErrorRef.current = onUpdateError;
  }, [onUpdateError]);

  const isLoaded = metadata !== undefined;
  const status: CerbosStatus = isLoaded
    ? "ready"
    : error !== undefined
      ? "error"
      : "loading";

  // Load the cached bundle (if any) before starting the WebView, so that the
  // PDP can start offline.
  useEffect(() => {
    let mounted = true;

    readCachedBundle(ruleId)
      // A cache failure must not stop the PDP from loading from Cerbos Hub.
      .catch((caught: unknown) => {
        console.warn("[CerbosProvider] Failed to read cached bundle:", caught);
        return null;
      })
      .then((bundle) => {
        if (mounted) {
          debug(
            bundle
              ? `[CerbosProvider] Found cached policy bundle ${bundle.metadata.bundleId}`
              : "[CerbosProvider] No cached policy bundle"
          );
          setInitialBundle(bundle);
        }
      });

    return () => {
      mounted = false;
    };
  }, [ruleId]);

  // Settle a pending request and remove it from the queue.
  const settleRequest = useCallback(
    (
      requestId: string,
      outcome:
        | { response: CheckResourcesResponse }
        | { error: Error; status: "failure" | "timeout" }
    ) => {
      const pending = pendingRequests.current.get(requestId);
      if (!pending) {
        console.warn(
          `[CerbosProvider] Received result for unknown or already settled request ${requestId}`
        );
        return;
      }

      pendingRequests.current.delete(requestId);
      clearTimeout(pending.timeout);
      queuedRequestIds.current = queuedRequestIds.current.filter(
        (id) => id !== requestId
      );
      setBatchedRequests((current) => omit(current, requestId));

      const elapsed = Date.now() - pending.createdAt;
      if ("response" in outcome) {
        debug(`[CerbosProvider] Request ${requestId} succeeded in ${elapsed}ms`);
        pending.resolve(outcome.response);
      } else {
        debug(
          `[CerbosProvider] Request ${requestId} ${outcome.status} after ${elapsed}ms`
        );
        pending.reject(outcome.error);
      }
    },
    []
  );

  // Hand the next batch of queued requests to the WebView.
  const flushQueue = useMemo(() => {
    function flush(): void {
      batchTimer.current = null;

      const batch = queuedRequestIds.current.splice(
        0,
        batching.current.maxBatchSize
      );
      if (batch.length === 0) {
        return;
      }

      setBatchedRequests((current) => {
        const next = { ...current };
        for (const requestId of batch) {
          const pending = pendingRequests.current.get(requestId);
          if (pending) {
            next[requestId] = pending.request;
          }
        }
        debug(
          `[CerbosProvider] Sending batch of ${batch.length} request(s) to the WebView`
        );
        return next;
      });

      if (queuedRequestIds.current.length > 0) {
        batchTimer.current = setTimeout(flush, batching.current.batchInterval);
      }
    }

    return flush;
  }, []);

  const checkResources = useCallback(
    (
      requestData: Omit<CheckResourcesRequest, "requestId">
    ): Promise<CheckResourcesResponse> => {
      if (!isLoaded) {
        return Promise.reject(
          new Error(error ?? "Cerbos PDP is not loaded yet")
        );
      }

      const requestId = newRequestId();
      const request: CheckResourcesRequest = { ...requestData, requestId };

      return new Promise<CheckResourcesResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          settleRequest(requestId, {
            status: "timeout",
            error: new Error(
              `Cerbos request ${requestId} timed out after ${requestTimeout}ms`
            ),
          });
        }, requestTimeout);

        pendingRequests.current.set(requestId, {
          request,
          resolve,
          reject,
          timeout,
          createdAt: Date.now(),
        });
        queuedRequestIds.current.push(requestId);
        debug(
          `[CerbosProvider] Queued request ${requestId} (queue size: ${queuedRequestIds.current.length})`
        );

        if (!batchTimer.current) {
          batchTimer.current = setTimeout(
            flushQueue,
            batching.current.batchInterval
          );
        }
      });
    },
    [isLoaded, error, requestTimeout, settleRequest, flushQueue]
  );

  // Reject anything still pending when the provider unmounts.
  useEffect(() => {
    const pending = pendingRequests.current;
    return () => {
      if (batchTimer.current) {
        clearTimeout(batchTimer.current);
      }
      for (const [requestId, request] of pending) {
        clearTimeout(request.timeout);
        request.reject(
          new Error(`Cerbos request ${requestId} cancelled: provider unmounted`)
        );
      }
      pending.clear();
    };
  }, []);

  const handleResponse = useCallback(
    (response: SerializedCheckResourcesResponse) => {
      try {
        settleRequest(response.requestId, {
          response: deserializeResponse(response),
        });
      } catch (caught) {
        settleRequest(response.requestId, {
          status: "failure",
          error: caught instanceof Error ? caught : new Error(String(caught)),
        });
      }
    },
    [settleRequest]
  );

  const handleError = useCallback(
    (requestId: string, message: string) => {
      settleRequest(requestId, { status: "failure", error: new Error(message) });
    },
    [settleRequest]
  );

  const handleBundleDownloaded = useCallback(
    (bundle: SerializedBundle) => {
      debug(
        `[CerbosProvider] Downloaded policy bundle ${bundle.metadata.bundleId} (revision ${bundle.metadata.ruleRevision})`
      );
      void writeCachedBundle(ruleId, bundle);
    },
    [ruleId]
  );

  const handlePDPUpdated = useCallback((updated: PDPMetadata) => {
    debug(
      `[CerbosProvider] Embedded PDP ready with bundle ${updated.bundle.bundleId} (from ${updated.source})`
    );
    setMetadata(updated);
    setError(undefined);
  }, []);

  const handleLoadError = useCallback((message: string) => {
    console.error(`[CerbosProvider] Embedded PDP failed to load: ${message}`);
    setError(message);
  }, []);

  const handleUpdateResult = useCallback((message: string | null) => {
    if (message === null) {
      setUpdateError(undefined);
      return;
    }
    console.warn(`[CerbosProvider] Policy update check failed: ${message}`);
    setUpdateError(message);
    onUpdateErrorRef.current?.(message);
  }, []);

  // The WebView is (re)loading: either starting up, or restarting after the
  // OS killed its process. Either way the PDP is not ready until the DOM
  // component reports a bundle again.
  const handleWebViewLoadStart = useCallback(() => {
    setMetadata((current) => {
      if (current !== undefined) {
        console.warn(
          "[CerbosProvider] Cerbos WebView is reloading; waiting for the PDP to become ready again"
        );
      }
      return undefined;
    });
  }, []);

  // The WebView does background work only and never shows user content, so
  // lock it down: no navigation away from the bundled DOM component, no
  // pop-ups, no link previews. `react-native-webview` (rather than Expo's
  // lighter DOM WebView) is used because it exposes these controls.
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

  const contextValue = useMemo<CerbosContextType>(
    () => ({
      checkResources,
      metadata,
      status,
      isLoaded,
      error,
      updateError,
    }),
    [checkResources, metadata, status, isLoaded, error, updateError]
  );

  return (
    <CerbosContext.Provider value={contextValue}>
      {children}
      {/* Wait for the cache lookup so the WebView can start with the cached bundle. */}
      {initialBundle !== undefined && (
        // The WebView does background work only, so keep it out of sight.
        <View style={{ height: 0, width: 0, opacity: 0 }}>
          <CerbosEmbeddedPDPWebView
            ruleId={ruleId}
            scopes={scopes}
            initialBundle={initialBundle}
            refreshIntervalSeconds={refreshIntervalSeconds}
            requests={batchedRequests}
            handleBundleDownloaded={handleBundleDownloaded}
            handlePDPUpdated={handlePDPUpdated}
            handleLoadError={handleLoadError}
            handleUpdateResult={handleUpdateResult}
            handleResponse={handleResponse}
            handleError={handleError}
            handleDecisionLog={onDecision}
            dom={domProps}
          />
        </View>
      )}
    </CerbosContext.Provider>
  );
};

/**
 * Access the embedded Cerbos PDP provided by the nearest {@link CerbosProvider}.
 */
export const useCerbos = (): CerbosContextType => {
  const context = useContext(CerbosContext);
  if (context === undefined) {
    throw new Error("useCerbos must be used within a CerbosProvider");
  }
  return context;
};
