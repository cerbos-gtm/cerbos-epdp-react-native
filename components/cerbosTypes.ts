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

// Types shared by `CerbosContext` (React Native) and `CerbosEmbeddedPDPWebView`
// (the WebView). Everything that crosses the bridge is JSON, so no class
// instances, `Date`s, `bigint`s or `Uint8Array`s.

/** Identifies a bundle. The revision is a string because JSON has no `bigint`. */
export interface BundleMetadata {
  bundleId: string;
  ruleRevision: string;
}

/** A policy bundle, as sent across the bridge and cached on disk. */
export interface SerializedBundle {
  metadata: BundleMetadata;
  /** Base64-encoded bundle contents. */
  contentsBase64: string;
}

/** The active bundle. */
export interface PDPMetadata {
  /** When the bundle was activated (ISO 8601). */
  updatedAt: string;
  source: "hub" | "cache";
  bundle: BundleMetadata;
  /** Version of the Cerbos engine. */
  cerbosVersion: string;
}

/** The JSON-serializable subset of `@cerbos/embedded-client`'s options. */
export type EngineOptions = Pick<
  EmbeddedOptions,
  | "defaultPolicyVersion"
  | "defaultScope"
  | "globals"
  | "lenientScopeSearch"
  | "schemaEnforcement"
  | "strictEvaluation"
>;

export interface HubOptions {
  /** Default: `https://api.cerbos.cloud`. */
  baseUrl?: string;
  /**
   * For rules that aren't public. Anything shipped in an app can be extracted
   * from it, so prefer a public rule, or a backend of your own (as `baseUrl`)
   * that holds the credentials.
   */
  credentials?: { clientId: string; clientSecret: string };
}

/** A JWT passed as auxiliary data, to be verified and decoded by the app. */
export type JWTToDecode = JWT;

/** The decoded payload (claims) of a JWT. */
export type DecodedJWTPayload = Record<string, Value>;

export type PDPRequest =
  | { kind: "checkResources"; request: CheckResourcesRequest }
  | { kind: "planResources"; request: PlanResourcesRequest };

export interface EvaluateRequest {
  requestId: string;
  request: PDPRequest;
}

export type PDPResult =
  | { requestId: string; response: SerializedPDPResponse }
  | { requestId: string; error: string };

/** What React Native can call on the DOM component (through its `ref`). */
export interface PDPWebViewHandle {
  /** Evaluate a batch of requests; the results arrive in one `handleResults` call. */
  evaluate: (batch: EvaluateRequest[]) => void;
}

/** JSON form of `CheckResourcesResponse`. */
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

/** JSON form of `PlanExpressionOperand` (class instances in `@cerbos/core`). */
export type SerializedPlanExpressionOperand =
  | { operator: string; operands: SerializedPlanExpressionOperand[] }
  | { value: Value }
  | { name: string };

/** JSON form of `PlanResourcesResponse`. */
export interface SerializedPlanResourcesResponse {
  requestId: string;
  cerbosCallId: string;
  kind: PlanKind;
  validationErrors: ValidationError[];
  metadata: PlanResourcesMetadata | null;
  /** Only present when `kind` is `PlanKind.CONDITIONAL`. */
  condition?: SerializedPlanExpressionOperand;
}


export type SerializedPDPResponse =
  | { kind: "checkResources"; response: SerializedCheckResourcesResponse }
  | { kind: "planResources"; response: SerializedPlanResourcesResponse };

/** JSON form of `DecisionLogEntry`: the timestamp is an ISO 8601 string. */
export type SerializedDecisionLogEntry = Omit<DecisionLogEntry, "timestamp"> & {
  timestamp: string;
};
