import type {
  CheckResourcesRequest,
  CheckResourcesResult,
  DecisionLogEntry,
  JWT,
  PlanKind,
  PlanResourcesMetadata,
  PlanResourcesRequest,
  ValidationError,
  Value,
} from "@cerbos/core";
import type { Options as EmbeddedOptions } from "@cerbos/embedded-client";

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
 * Engine settings for the embedded PDP: the JSON-serializable subset of
 * `@cerbos/embedded-client`'s options.
 */
export type EngineOptions = Pick<
  EmbeddedOptions,
  | "defaultPolicyVersion"
  | "defaultScope"
  | "globals"
  | "lenientScopeSearch"
  | "schemaEnforcement"
  | "strictEvaluation"
>;

/**
 * How to reach Cerbos Hub to download policy bundles.
 */
export interface HubOptions {
  /** Base URL of the Cerbos Hub API (default: `https://api.cerbos.cloud`). */
  baseUrl?: string;
  /**
   * Client credentials, for rules that are not public.
   *
   * @remarks
   * Anything shipped in a mobile app can be extracted from it. Prefer public
   * rules, or a backend of your own (set as `baseUrl`) that holds the
   * credentials and serves bundles to the app.
   */
  credentials?: { clientId: string; clientSecret: string };
}

/** A JWT passed as auxiliary data, to be verified and decoded by the app. */
export type JWTToDecode = JWT;

/** The decoded payload (claims) of a JWT. */
export type DecodedJWTPayload = Record<string, Value>;

/**
 * A request handed to the WebView for evaluation.
 */
export type PDPRequest =
  | { kind: "checkResources"; request: CheckResourcesRequest }
  | { kind: "planResources"; request: PlanResourcesRequest };

/**
 * Pending requests, keyed by request ID, handed to the WebView for evaluation.
 */
export type SerializablePDPRequests = Record<string, PDPRequest>;

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
 * JSON-safe form of a `PlanExpressionOperand` from `@cerbos/core` (which are
 * class instances there).
 */
export type SerializedPlanExpressionOperand =
  | { operator: string; operands: SerializedPlanExpressionOperand[] }
  | { value: Value }
  | { name: string };

/**
 * JSON-safe form of `PlanResourcesResponse` from `@cerbos/core`.
 */
export interface SerializedPlanResourcesResponse {
  requestId: string;
  cerbosCallId: string;
  kind: PlanKind;
  validationErrors: ValidationError[];
  metadata: PlanResourcesMetadata | null;
  /** Only present when `kind` is `PlanKind.CONDITIONAL`. */
  condition?: SerializedPlanExpressionOperand;
}

/**
 * The result of a request, matching the `kind` of the {@link PDPRequest}.
 */
export type SerializedPDPResponse =
  | { kind: "checkResources"; response: SerializedCheckResourcesResponse }
  | { kind: "planResources"; response: SerializedPlanResourcesResponse };

/**
 * JSON-safe form of `DecisionLogEntry` from `@cerbos/core` (the timestamp is
 * an ISO 8601 string rather than a `Date`).
 */
export type SerializedDecisionLogEntry = Omit<DecisionLogEntry, "timestamp"> & {
  timestamp: string;
};
