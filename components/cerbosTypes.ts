import type {
  CheckResourcesRequest,
  CheckResourcesResult,
  DecisionLogEntry,
} from "@cerbos/core";

// Types shared between the React Native side (`CerbosContext`) and the DOM
// component (`CerbosEmbeddedPDPWebView`). Everything that crosses the
// WebView bridge must be JSON-serializable, which is why the shapes below
// avoid class instances, `Date`s, `bigint`s and `Uint8Array`s.

/**
 * Identifies a policy bundle downloaded from Cerbos Hub. Mirrors
 * `cerbos.cloud.epdp.v2.Bundle.Metadata`, with the revision as a string so
 * that it survives JSON serialization.
 */
export interface BundleMetadata {
  bundleId: string;
  ruleRevision: string;
}

/**
 * A policy bundle downloaded from Cerbos Hub, encoded for transport across the
 * WebView bridge and for storage on disk.
 */
export interface SerializedBundle {
  metadata: BundleMetadata;
  /** Base64-encoded bundle contents. */
  contentsBase64: string;
}

/**
 * Details about the policy decision point that is currently active.
 */
export interface PDPMetadata {
  /** ISO 8601 timestamp of when this bundle was activated in the WebView. */
  updatedAt: string;
  /** Where the active bundle came from. */
  source: "hub" | "cache";
  /** The policy bundle being evaluated. */
  bundle: BundleMetadata;
  /** Version of the embedded Cerbos server (the WebAssembly module). */
  cerbosVersion: string;
}

/**
 * Pending `checkResources` requests, keyed by request ID, handed to the
 * WebView for evaluation.
 */
export type SerializablePDPRequests = Record<string, CheckResourcesRequest>;

/**
 * JSON-safe form of `CheckResourcesResponse` from `@cerbos/core`.
 */
export interface SerializedCheckResourcesResponse {
  requestId: string;
  cerbosCallId: string;
  results: SerializedCheckResourcesResult[];
}

export type SerializedCheckResourcesResult = Pick<
  CheckResourcesResult,
  "resource" | "actions" | "validationErrors" | "outputs"
> & {
  metadata: CheckResourcesResult["metadata"] | null;
};

/**
 * JSON-safe form of `DecisionLogEntry` from `@cerbos/core` (the timestamp is
 * an ISO 8601 string rather than a `Date`).
 */
export type SerializedDecisionLogEntry = Omit<DecisionLogEntry, "timestamp"> & {
  timestamp: string;
};
