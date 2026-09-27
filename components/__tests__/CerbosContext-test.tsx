import {
  CheckResourcesResponse,
  CheckResourcesResult,
  Effect,
  PlanExpression,
  PlanExpressionValue,
  PlanExpressionVariable,
  PlanKind,
} from "@cerbos/core";
import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect, useImperativeHandle as mockUseImperativeHandle } from "react";

import {
  CerbosProvider,
  isAllowedWebViewNavigation,
  useCerbos,
} from "../CerbosContext";
import type {
  EvaluateRequest,
  SerializedBundle,
  SerializedPDPResponse,
} from "../cerbosTypes";

// Stand in for the DOM component (which runs inside a WebView on device):
// record its props and the batches sent to `ref.evaluate`, so the test can
// answer them through the callbacks.
type WebViewProps = React.ComponentProps<
  typeof import("../CerbosEmbeddedPDPWebView").default
>;
let mockWebViewProps: WebViewProps | undefined;
let mockRenderCount = 0;
const mockBatches: EvaluateRequest[][] = [];

jest.mock("../CerbosEmbeddedPDPWebView", () => ({
  __esModule: true,
  default: function MockWebView(props: WebViewProps) {
    mockWebViewProps = props;
    mockRenderCount++;
    mockUseImperativeHandle(props.ref, () => ({
      evaluate: (batch: EvaluateRequest[]) => {
        mockBatches.push(batch);
      },
    }));
    return null;
  },
}));

const mockReadCachedBundle = jest.fn<Promise<SerializedBundle | null>, [string]>();
const mockWriteCachedBundle = jest.fn<Promise<void>, [string, SerializedBundle]>();
jest.mock("../cerbosBundleCache", () => ({
  readCachedBundle: (...args: [string]) => mockReadCachedBundle(...args),
  writeCachedBundle: (...args: [string, SerializedBundle]) =>
    mockWriteCachedBundle(...args),
}));

let mockNextId = 0;
jest.mock("expo-crypto", () => ({
  randomUUID: () => `request-${++mockNextId}`,
}));

type Context = ReturnType<typeof useCerbos>;
let context: Context | undefined;

function Consumer() {
  const value = useCerbos();
  useEffect(() => {
    context = value;
  });
  return null;
}

const bundle: SerializedBundle = {
  metadata: { bundleId: "BUNDLE1", ruleRevision: "3" },
  contentsBase64: "AAEC",
};

const pdpMetadata = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "hub" as const,
  bundle: bundle.metadata,
  cerbosVersion: "0.55.0",
};

const resource = { kind: "document", id: "doc1", attr: {} };
const request = {
  principal: { id: "alice", roles: ["editor"], attr: {} },
  resources: [{ resource, actions: ["view", "edit"] }],
};

function serializedResponse(requestId: string): SerializedPDPResponse {
  return {
    kind: "checkResources",
    response: {
      requestId,
      cerbosCallId: "CALL1",
      results: [
        {
          resource: { ...resource, policyVersion: "default", scope: "" },
          actions: { view: Effect.ALLOW, edit: Effect.DENY },
          validationErrors: [],
          metadata: null,
          outputs: [],
        },
      ],
    },
  };
}

async function renderProvider(
  props: Partial<React.ComponentProps<typeof CerbosProvider>> = {}
) {
  const result = await render(
    <CerbosProvider ruleId="RULE1" {...props}>
      <Consumer />
    </CerbosProvider>
  );
  // The WebView is only rendered once the cache has been checked.
  await waitFor(() => expect(mockWebViewProps).toBeDefined());
  return result;
}

async function markLoaded() {
  await act(async () => {
    mockWebViewProps!.handlePDPUpdated(pdpMetadata);
  });
  await waitFor(() => expect(context?.isLoaded).toBe(true));
}

// The requests sent to the WebView so far.
function sentRequests(): EvaluateRequest[] {
  return mockBatches.flat();
}

async function waitForRequest(): Promise<EvaluateRequest> {
  await waitFor(() => expect(sentRequests().length).toBeGreaterThan(0));
  return sentRequests()[0];
}

async function respond(requestId: string, response = serializedResponse(requestId)) {
  await act(async () => {
    mockWebViewProps!.handleResults([{ requestId, response }]);
  });
}

beforeEach(() => {
  mockWebViewProps = undefined;
  mockRenderCount = 0;
  mockBatches.length = 0;
  context = undefined;
  mockReadCachedBundle.mockReset().mockResolvedValue(null);
  mockWriteCachedBundle.mockReset().mockResolvedValue(undefined);
});

describe("CerbosProvider", () => {
  it("starts the WebView with the cached bundle and rule settings", async () => {
    mockReadCachedBundle.mockResolvedValue(bundle);

    await renderProvider({ scopes: ["a"], refreshIntervalSeconds: 42 });

    expect(mockReadCachedBundle).toHaveBeenCalledWith("RULE1");
    expect(mockWebViewProps).toMatchObject({
      ruleId: "RULE1",
      scopes: ["a"],
      initialBundle: bundle,
      refreshIntervalSeconds: 42,
    });
    expect(context?.isLoaded).toBe(false);
    expect(context?.metadata).toBeUndefined();
  });

  it("still starts the WebView when reading the cache fails", async () => {
    mockReadCachedBundle.mockRejectedValue(new Error("disk on fire"));

    await renderProvider();

    expect(mockWebViewProps?.initialBundle).toBeNull();
  });

  it("rejects requests until the PDP has loaded", async () => {
    await renderProvider();

    await expect(context!.checkResources(request)).rejects.toThrow(
      "Cerbos PDP is not loaded yet"
    );
  });

  it("exposes the reason the PDP failed to load", async () => {
    await renderProvider();

    await act(async () => {
      mockWebViewProps!.handleLoadError("no network");
    });

    await waitFor(() => expect(context?.error).toBe("no network"));
    await expect(context!.checkResources(request)).rejects.toThrow(
      "no network"
    );
  });

  it("exposes metadata once the PDP has loaded", async () => {
    await renderProvider();
    await markLoaded();

    expect(context?.metadata).toEqual(pdpMetadata);
    expect(context?.error).toBeUndefined();
  });

  it("caches bundles downloaded by the WebView", async () => {
    await renderProvider();

    await act(async () => {
      mockWebViewProps!.handleBundleDownloaded(bundle);
    });

    expect(mockWriteCachedBundle).toHaveBeenCalledWith("RULE1", bundle);
  });

  it("sends requests to the WebView and resolves with the response", async () => {
    await renderProvider();
    await markLoaded();

    const promise = context!.checkResources(request);
    const { requestId, request: sent } = await waitForRequest();
    expect(sent).toEqual({
      kind: "checkResources",
      request: { ...request, requestId },
    });

    await respond(requestId);

    const response = await promise;
    expect(response).toBeInstanceOf(CheckResourcesResponse);
    expect(response.requestId).toBe(requestId);
    expect(response.isAllowed({ resource, action: "view" })).toBe(true);
    expect(response.isAllowed({ resource, action: "edit" })).toBe(false);
    expect(response.findResult(resource)?.metadata).toBeUndefined();
  });

  it("rejects requests that fail in the WebView", async () => {
    await renderProvider();
    await markLoaded();

    const promise = context!.checkResources(request);
    const rejection = expect(promise).rejects.toThrow("policy exploded");
    const { requestId } = await waitForRequest();

    await act(async () => {
      mockWebViewProps!.handleResults([{ requestId, error: "policy exploded" }]);
    });

    await rejection;
  });

  it("rejects requests that time out", async () => {
    await renderProvider({ requestTimeout: 300 });
    await markLoaded();

    const promise = context!.checkResources(request);
    promise.catch(() => {}); // handled below, once the request ID is known
    const { requestId } = await waitForRequest();

    await expect(promise).rejects.toThrow(
      `Cerbos request ${requestId} timed out after 300ms`
    );

    // A late response for the timed-out request is ignored.
    await respond(requestId);
  });

  it("sends requests made in the same tick as one batch", async () => {
    await renderProvider();
    await markLoaded();

    const promises = [1, 2, 3].map(() => context!.checkResources(request));

    await waitFor(() => expect(mockBatches).toHaveLength(1));
    expect(mockBatches[0]).toHaveLength(3);

    await act(async () => {
      mockWebViewProps!.handleResults(
        mockBatches[0].map(({ requestId }) => ({
          requestId,
          response: serializedResponse(requestId),
        }))
      );
    });

    const responses = await Promise.all(promises);
    expect(responses.map((r) => r.requestId)).toEqual(
      mockBatches[0].map((r) => r.requestId)
    );
  });

  it("doesn't re-render the WebView for requests or parent re-renders", async () => {
    const { rerender } = await renderProvider({ hub: { baseUrl: "https://hub" } });
    await markLoaded();
    const renders = mockRenderCount;

    const promise = context!.checkResources(request);
    const { requestId } = await waitForRequest();
    await respond(requestId);
    await promise;

    // Equal (but new) objects and callbacks from the parent.
    await rerender(
      <CerbosProvider
        ruleId="RULE1"
        hub={{ baseUrl: "https://hub" }}
        onDecision={() => {}}
      >
        <Consumer />
      </CerbosProvider>
    );
    const withDecisions = mockRenderCount;
    await rerender(
      <CerbosProvider
        ruleId="RULE1"
        hub={{ baseUrl: "https://hub" }}
        onDecision={() => {}}
      >
        <Consumer />
      </CerbosProvider>
    );

    // Only adding `onDecision` changed what the WebView needs to know.
    expect(withDecisions).toBe(renders + 1);
    expect(mockRenderCount).toBe(withDecisions);
  });

  it("delivers decision logs to onDecision", async () => {
    const onDecision = jest.fn();
    await renderProvider({ onDecision });

    const entry = { callId: "CALL1", timestamp: "2026-01-01T00:00:00.000Z" };
    await act(async () => {
      mockWebViewProps!.handleDecisionLogs!([entry as never, entry as never]);
    });

    expect(onDecision).toHaveBeenCalledTimes(2);
    expect(onDecision).toHaveBeenCalledWith(entry);
  });

  it("doesn't ask the WebView for decision logs without onDecision", async () => {
    await renderProvider();

    expect(mockWebViewProps!.handleDecisionLogs).toBeUndefined();
  });
});

describe("CerbosProvider other RPCs", () => {
  it("answers checkResource from a checkResources round trip", async () => {
    await renderProvider();
    await markLoaded();

    const promise = context!.checkResource({
      principal: request.principal,
      resource,
      actions: ["view", "edit"],
    });
    const { requestId, request: sent } = await waitForRequest();
    expect(sent).toEqual({
      kind: "checkResources",
      request: { ...request, requestId },
    });

    await respond(requestId);

    const result = await promise;
    expect(result).toBeInstanceOf(CheckResourcesResult);
    expect(result.isAllowed("view")).toBe(true);
    expect(result.isAllowed("edit")).toBe(false);
  });

  it("answers isAllowed", async () => {
    await renderProvider();
    await markLoaded();

    const allowed = context!.isAllowed({
      principal: request.principal,
      resource,
      action: "view",
    });
    const denied = context!.isAllowed({
      principal: request.principal,
      resource,
      action: "edit",
    });
    await waitFor(() => expect(sentRequests()).toHaveLength(2));
    for (const { requestId } of sentRequests()) {
      await respond(requestId);
    }

    expect(await allowed).toBe(true);
    expect(await denied).toBe(false);
  });

  it("sends planResources requests and rebuilds the query plan", async () => {
    await renderProvider();
    await markLoaded();

    const promise = context!.planResources({
      principal: request.principal,
      resource: { kind: "document" },
      action: "view",
    });
    const { requestId, request: sent } = await waitForRequest();
    expect(sent).toEqual({
      kind: "planResources",
      request: {
        principal: request.principal,
        resource: { kind: "document" },
        action: "view",
        requestId,
      },
    });

    await respond(requestId, {
        kind: "planResources",
        response: {
          requestId,
          cerbosCallId: "CALL2",
          kind: PlanKind.CONDITIONAL,
          validationErrors: [],
          metadata: null,
          condition: {
            operator: "eq",
            operands: [{ name: "request.resource.attr.owner" }, { value: "alice" }],
          },
        },
      });

    const plan = await promise;
    expect(plan.kind).toBe(PlanKind.CONDITIONAL);
    if (plan.kind !== PlanKind.CONDITIONAL) {
      throw new Error("expected a conditional plan");
    }
    expect(plan.condition).toBeInstanceOf(PlanExpression);
    const condition = plan.condition as PlanExpression;
    expect(condition.operator).toBe("eq");
    expect(condition.operands[0]).toBeInstanceOf(PlanExpressionVariable);
    expect(condition.operands[1]).toBeInstanceOf(PlanExpressionValue);
    expect(plan.metadata).toBeUndefined();
  });

  it("passes Hub, engine and callback settings to the WebView", async () => {
    const onValidationError = jest.fn();
    const decodeJWTPayload = jest.fn();
    await renderProvider({
      hub: { baseUrl: "https://hub.example.com" },
      engineOptions: { lenientScopeSearch: true },
      onValidationError,
      decodeJWTPayload,
    });

    expect(mockWebViewProps).toMatchObject({
      hub: { baseUrl: "https://hub.example.com" },
      engineOptions: { lenientScopeSearch: true },
    });
    mockWebViewProps!.handleValidationError!([]);
    expect(onValidationError).toHaveBeenCalledWith([]);
    mockWebViewProps!.handleDecodeJWTPayload!({ token: "t" });
    expect(decodeJWTPayload).toHaveBeenCalledWith({ token: "t" });
  });
});

describe("CerbosProvider status and update reporting", () => {
  it("reports the lifecycle status", async () => {
    await renderProvider();
    expect(context?.status).toBe("loading");

    await act(async () => {
      mockWebViewProps!.handleLoadError("no network");
    });
    await waitFor(() => expect(context?.status).toBe("error"));

    await markLoaded();
    expect(context?.status).toBe("ready");
    expect(context?.error).toBeUndefined();
  });

  it("exposes failed update checks and notifies the app", async () => {
    const onUpdateError = jest.fn();
    await renderProvider({ onUpdateError });
    await markLoaded();

    await act(async () => {
      mockWebViewProps!.handleUpdateResult("hub down");
    });
    await waitFor(() => expect(context?.updateError).toBe("hub down"));
    expect(onUpdateError).toHaveBeenCalledWith("hub down");
    // The PDP stays usable on the current bundle.
    expect(context?.isLoaded).toBe(true);

    await act(async () => {
      mockWebViewProps!.handleUpdateResult(null);
    });
    await waitFor(() => expect(context?.updateError).toBeUndefined());
    expect(onUpdateError).toHaveBeenCalledTimes(1);
  });

  it("is not ready while the WebView is reloading", async () => {
    await renderProvider();
    await markLoaded();

    await act(async () => {
      mockWebViewProps!.dom!.onLoadStart!({} as never);
    });
    await waitFor(() => expect(context?.isLoaded).toBe(false));
    expect(context?.status).toBe("loading");
    await expect(context!.checkResources(request)).rejects.toThrow(
      "Cerbos PDP is not loaded yet"
    );

    // The DOM component announces the bundle again once it has restarted.
    await markLoaded();
  });

  it("locks the WebView down", async () => {
    await renderProvider();

    expect(mockWebViewProps!.dom).toMatchObject({
      useExpoDOMWebView: false,
      setSupportMultipleWindows: false,
      javaScriptCanOpenWindowsAutomatically: false,
      allowsBackForwardNavigationGestures: false,
      allowsLinkPreview: false,
    });
    const shouldStart = mockWebViewProps!.dom!.onShouldStartLoadWithRequest!;
    expect(shouldStart({ url: "file:///app/www.bundle/x.html" } as never)).toBe(
      true
    );
    expect(shouldStart({ url: "https://example.com/" } as never)).toBe(
      __DEV__
    );
  });
});

describe("isAllowedWebViewNavigation", () => {
  const dev = __DEV__;
  afterEach(() => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  });

  it("only allows the bundled DOM component and, in development, the dev server", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});

    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    expect(isAllowedWebViewNavigation("file:///app/www.bundle/x.html")).toBe(true);
    expect(isAllowedWebViewNavigation("about:blank")).toBe(true);
    expect(isAllowedWebViewNavigation("http://localhost:8081/x")).toBe(false);
    expect(isAllowedWebViewNavigation("https://example.com/")).toBe(false);
    expect(isAllowedWebViewNavigation("javascript:alert(1)")).toBe(false);

    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
    expect(isAllowedWebViewNavigation("http://localhost:8081/x")).toBe(true);
    expect(isAllowedWebViewNavigation("javascript:alert(1)")).toBe(false);
  });
});

describe("useCerbos", () => {
  it("throws outside of a CerbosProvider", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(render(<Consumer />)).rejects.toThrow(
      "useCerbos must be used within a CerbosProvider"
    );
    spy.mockRestore();
  });
});
