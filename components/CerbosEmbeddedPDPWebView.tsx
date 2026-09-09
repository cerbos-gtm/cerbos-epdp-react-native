"use dom";

import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import { BundleService } from "@cerbos/api/cerbos/cloud/epdp/v2/epdp_pb";
import type { CheckResourcesResponse } from "@cerbos/core";
import { Embedded } from "@cerbos/embedded-client";
import { metadata as serverMetadata } from "@cerbos/embedded-server";
import serverWasmUrl from "@cerbos/embedded-server/server.wasm";
import { createClient } from "@cerbos/hub/~internal";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { DOMProps } from "expo/dom";
import { useEffect, useRef, useState } from "react";

import type {
  BundleMetadata,
  PDPMetadata,
  SerializablePDPRequests,
  SerializedBundle,
  SerializedCheckResourcesResponse,
  SerializedDecisionLogEntry,
} from "./cerbosTypes";

// This file is an Expo DOM component: it is bundled for the web and rendered
// inside a WebView, because React Native has no WebAssembly runtime. The
// embedded Cerbos PDP (a WebAssembly module shipped in
// `@cerbos/embedded-server`) and the policy bundle from Cerbos Hub are both
// loaded here. React Native talks to it via the (JSON-serializable) props and
// callbacks below.

interface CerbosEmbeddedPDPWebViewProps {
  /** ID of the ePDP policy bundling rule in Cerbos Hub. */
  ruleId: string;
  /** Scopes to include in the policy bundle (all scopes if empty). */
  scopes?: string[];
  /** Cached bundle to activate immediately while checking Cerbos Hub for updates. */
  initialBundle?: SerializedBundle | null;
  /** How often (in seconds) to check Cerbos Hub for an updated bundle. `0` disables. */
  refreshIntervalSeconds: number;
  /** Pending requests to evaluate, keyed by request ID. */
  requests: SerializablePDPRequests;
  /** Invoked when a new bundle has been downloaded from Cerbos Hub and activated, so it can be cached. */
  handleBundleDownloaded: (bundle: SerializedBundle) => void;
  /** Invoked when a bundle has been activated in the embedded PDP. */
  handlePDPUpdated: (metadata: PDPMetadata) => void;
  /** Invoked when the embedded PDP could not be started (it will keep retrying). */
  handleLoadError: (message: string) => void;
  /** Invoked after each check for policy updates: `null` on success, otherwise the failure reason. */
  handleUpdateResult: (error: string | null) => void;
  /** Invoked with the result of a successful `checkResources` call. */
  handleResponse: (response: SerializedCheckResourcesResponse) => void;
  /** Invoked when a `checkResources` call fails. */
  handleError: (requestId: string, message: string) => void;
  /** Invoked for every decision made by the embedded PDP. */
  handleDecisionLog?: (entry: SerializedDecisionLogEntry) => void;
  dom?: DOMProps;
}

type Callbacks = Pick<
  CerbosEmbeddedPDPWebViewProps,
  | "handleBundleDownloaded"
  | "handlePDPUpdated"
  | "handleLoadError"
  | "handleUpdateResult"
  | "handleResponse"
  | "handleError"
  | "handleDecisionLog"
>;

interface Bundle {
  metadata: BundleMetadata;
  contents: Uint8Array<ArrayBuffer>;
}

interface ActivePDP {
  client: Embedded;
  bundle: BundleMetadata;
}

// Delays (in seconds) between attempts to load the first bundle from Cerbos
// Hub when there is no cached bundle to fall back on.
const INITIAL_RETRY_DELAYS_SECONDS = [2, 4, 8, 16, 32, 60];

// Request-level logging is only useful during development, and would leak
// principal and resource attributes into production logs.
const debug: (...args: unknown[]) => void = __DEV__
  ? (...args) => console.log(...args)
  : () => {};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  // `crypto.subtle` is only available in secure contexts (which excludes the
  // plain-HTTP development server), so fall back to a pure JS implementation.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    return bytesToHex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
  }
  return bytesToHex(sha256(new Uint8Array(bytes)));
}

// Holds the compiled engine so that it is only compiled once per WebView. Each
// policy bundle update creates a new `Embedded` client, which only needs to
// instantiate (not recompile) the module.
interface ServerWasmCache {
  module?: Promise<WebAssembly.Module>;
}

function loadServerWasm(cache: ServerWasmCache): Promise<WebAssembly.Module> {
  if (!cache.module) {
    const compiled = (async () => {
      // `WebAssembly.compileStreaming` requires an `application/wasm` MIME
      // type, which `file://` responses inside the WebView don't provide.
      const response = await fetch(serverWasmUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to download embedded PDP from ${serverWasmUrl}: HTTP ${response.status}`
        );
      }
      const bytes = await response.arrayBuffer();

      // Refuse to run an engine that doesn't match the one the SDK was
      // published with: this catches a corrupted or tampered asset.
      const checksum = await sha256Hex(bytes);
      if (checksum !== serverMetadata.wasmChecksum) {
        throw new Error(
          `Embedded PDP integrity check failed: expected SHA-256 ${serverMetadata.wasmChecksum} but got ${checksum}`
        );
      }

      return WebAssembly.compile(bytes);
    })();

    cache.module = compiled;
    compiled.catch(() => {
      // Allow a later attempt to retry.
      if (cache.module === compiled) {
        cache.module = undefined;
      }
    });
  }

  return cache.module;
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

/**
 * Download the latest policy bundle for the rule from Cerbos Hub.
 * Resolves to `undefined` if the bundle hasn't changed since `ifModifiedSince`.
 */
async function fetchBundle(
  ruleId: string,
  scopes: string[],
  ifModifiedSince: BundleMetadata | undefined,
  signal: AbortSignal
): Promise<Bundle | undefined> {
  // This is the same Cerbos Hub API that `PolicyLoader` from
  // `@cerbos/embedded-client` uses; calling it directly lets us hand the
  // downloaded bundle back to React Native to cache for offline use.
  const hub = createClient(BundleService);

  const { result } = await hub.getBundle(
    {
      ruleId,
      scopes,
      ifModifiedSince: ifModifiedSince && {
        bundleId: ifModifiedSince.bundleId,
        ruleRevision: BigInt(ifModifiedSince.ruleRevision),
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
    // Copy so the buffer contains exactly the bundle (the server reads the
    // whole underlying buffer).
    contents: new Uint8Array(contents),
  };
}

function serializeResponse(
  response: CheckResourcesResponse
): SerializedCheckResourcesResponse {
  return {
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
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CerbosEmbeddedPDPWebView({
  ruleId,
  scopes = [],
  initialBundle,
  refreshIntervalSeconds,
  requests,
  handleBundleDownloaded,
  handlePDPUpdated,
  handleLoadError,
  handleUpdateResult,
  handleResponse,
  handleError,
  handleDecisionLog,
}: CerbosEmbeddedPDPWebViewProps) {
  const [pdp, setPdp] = useState<ActivePDP | null>(null);
  const processedRequestIds = useRef(new Set<string>());
  const serverWasm = useRef<ServerWasmCache>({});

  // Callback props are re-created every time React Native re-renders, so keep
  // the latest versions in a ref rather than listing them as effect dependencies.
  // (They are proxies that invoke the native callback by name, so an earlier
  // instance keeps working too.)
  const callbacks = useRef<Callbacks>({
    handleBundleDownloaded,
    handlePDPUpdated,
    handleLoadError,
    handleUpdateResult,
    handleResponse,
    handleError,
    handleDecisionLog,
  });
  useEffect(() => {
    callbacks.current = {
      handleBundleDownloaded,
      handlePDPUpdated,
      handleLoadError,
      handleUpdateResult,
      handleResponse,
      handleError,
      handleDecisionLog,
    };
  }, [
    handleBundleDownloaded,
    handlePDPUpdated,
    handleLoadError,
    handleUpdateResult,
    handleResponse,
    handleError,
    handleDecisionLog,
  ]);

  // `initialBundle` is only used to bootstrap; later updates come from Cerbos Hub.
  const initialBundleRef = useRef(initialBundle);
  const scopesKey = JSON.stringify(scopes);

  // Load the embedded PDP and keep its policy bundle up to date.
  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;
    let active: ActivePDP | null = null;
    let loading = false;
    let initialAttempt = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const scopes: string[] = JSON.parse(scopesKey);

    const activate = async (
      bundle: Bundle,
      source: PDPMetadata["source"]
    ): Promise<void> => {
      debug(
        `[CerbosWebview] Activating policy bundle ${bundle.metadata.bundleId} (revision ${bundle.metadata.ruleRevision}) from ${source}`
      );

      const client = new Embedded({
        policies: bundle.contents,
        wasm: loadServerWasm(serverWasm.current),
        onDecision: (entry) => {
          const handleDecisionLog = callbacks.current.handleDecisionLog;
          if (!handleDecisionLog) {
            return;
          }
          // `JSON.stringify` turns the `Date` timestamp into an ISO string.
          // Don't await the round trip to React Native, so that logging
          // doesn't delay the decision itself.
          Promise.resolve(
            handleDecisionLog(
              JSON.parse(JSON.stringify(entry)) as SerializedDecisionLogEntry
            )
          ).catch((error: unknown) => {
            console.warn(
              "[CerbosWebview] Decision log handler failed:",
              errorMessage(error)
            );
          });
        },
      });

      // Make sure the server starts (and the bundle loads) before reporting
      // readiness. If this throws, the previously active PDP (if any) keeps
      // answering requests.
      await client.serverInfo();

      if (signal.aborted) {
        return;
      }

      active = { client, bundle: bundle.metadata };
      setPdp(active);
      callbacks.current.handlePDPUpdated({
        updatedAt: new Date().toISOString(),
        source,
        bundle: bundle.metadata,
        cerbosVersion: serverMetadata.cerbosVersion,
      });
    };

    // Check Cerbos Hub for a newer bundle and activate it. Throws on failure.
    const checkForUpdate = async (): Promise<void> => {
      const bundle = await fetchBundle(
        ruleId,
        scopes,
        active?.bundle,
        signal
      );

      if (signal.aborted) {
        return;
      }

      if (!bundle) {
        debug("[CerbosWebview] Policy bundle is up to date.");
        return;
      }

      // Only cache a bundle that the engine has successfully loaded, so a
      // bad download can never replace a working cached bundle.
      await activate(bundle, "hub");
      if (!signal.aborted) {
        callbacks.current.handleBundleDownloaded(encodeBundle(bundle));
      }
    };

    // Check for an update, reporting the outcome. Resolves to `true` on success.
    const tryUpdate = async (): Promise<boolean> => {
      if (loading) {
        return false;
      }
      loading = true;
      try {
        await checkForUpdate();
        if (!signal.aborted) {
          callbacks.current.handleUpdateResult(null);
        }
        return true;
      } catch (error) {
        if (signal.aborted) {
          return false;
        }
        const message = errorMessage(error);
        if (active) {
          console.warn(
            `[CerbosWebview] Failed to check Cerbos Hub for policy updates, continuing with the current bundle: ${message}`
          );
        } else {
          console.error(
            `[CerbosWebview] Failed to load policy bundle from Cerbos Hub: ${message}`
          );
          callbacks.current.handleLoadError(message);
        }
        callbacks.current.handleUpdateResult(message);
        return false;
      } finally {
        loading = false;
      }
    };

    const scheduleUpdateCheck = (): void => {
      clearTimeout(timeout);
      if (refreshIntervalSeconds <= 0 || signal.aborted) {
        return;
      }

      timeout = setTimeout(async () => {
        await tryUpdate();
        scheduleUpdateCheck();
      }, refreshIntervalSeconds * 1000);
    };

    // Until a bundle is active, keep trying Cerbos Hub with exponential backoff.
    const scheduleInitialRetry = (): void => {
      clearTimeout(timeout);
      if (signal.aborted) {
        return;
      }

      const delaySeconds =
        INITIAL_RETRY_DELAYS_SECONDS[
          Math.min(initialAttempt, INITIAL_RETRY_DELAYS_SECONDS.length - 1)
        ];
      initialAttempt++;
      debug(
        `[CerbosWebview] Retrying policy bundle download in ${delaySeconds}s`
      );
      timeout = setTimeout(() => {
        void attemptLoad();
      }, delaySeconds * 1000);
    };

    const attemptLoad = async (): Promise<void> => {
      await tryUpdate();
      if (signal.aborted) {
        return;
      }
      if (active) {
        scheduleUpdateCheck();
      } else {
        scheduleInitialRetry();
      }
    };

    // Retry as soon as connectivity returns rather than waiting for the backoff.
    const onOnline = (): void => {
      if (!active && !loading) {
        debug("[CerbosWebview] Back online, retrying policy bundle download");
        void attemptLoad();
      }
    };
    globalThis.addEventListener?.("online", onOnline);

    const start = async (): Promise<void> => {
      const cached = initialBundleRef.current;

      if (cached) {
        try {
          await activate(decodeBundle(cached), "cache");
        } catch (error) {
          console.warn(
            "[CerbosWebview] Failed to activate cached policy bundle:",
            errorMessage(error)
          );
        }
      }

      await attemptLoad();
    };

    // Any previously activated PDP keeps answering requests until the new
    // bundle is activated. (`CerbosProvider` remounts this component when the
    // rule ID changes, so there is no stale PDP in that case.)
    void start();

    return () => {
      abortController.abort();
      clearTimeout(timeout);
      globalThis.removeEventListener?.("online", onOnline);
    };
  }, [ruleId, scopesKey, refreshIntervalSeconds]);

  // Evaluate incoming requests.
  useEffect(() => {
    if (!pdp) {
      return;
    }

    for (const [requestId, request] of Object.entries(requests)) {
      if (processedRequestIds.current.has(requestId)) {
        continue;
      }

      processedRequestIds.current.add(requestId);
      debug(`[CerbosWebview] Processing request ${requestId}`);

      pdp.client
        .checkResources(request)
        .then((response) => {
          callbacks.current.handleResponse(serializeResponse(response));
        })
        .catch((error: unknown) => {
          console.error(
            `[CerbosWebview] Request ${requestId} failed:`,
            errorMessage(error)
          );
          callbacks.current.handleError(requestId, errorMessage(error));
        });
    }
  }, [pdp, requests]);

  // Forget request IDs once React Native has removed them from the queue, so
  // the set doesn't grow indefinitely.
  useEffect(() => {
    for (const requestId of processedRequestIds.current) {
      if (!(requestId in requests)) {
        processedRequestIds.current.delete(requestId);
      }
    }
  }, [requests]);

  // Nothing to display: this component only does background work.
  return null;
}
