import { CheckResourcesResponse, Effect } from "@cerbos/core";
import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";

import {
  CerbosProvider,
  isAllowedWebViewNavigation,
  useCerbos,
} from "../CerbosContext";
import type {
  SerializedBundle,
  SerializedCheckResourcesResponse,
} from "../cerbosTypes";

// Stand in for the DOM component (which runs inside a WebView on device):
// record the props the provider passes so the test can drive the callbacks.
type WebViewProps = React.ComponentProps<
  typeof import("../CerbosEmbeddedPDPWebView").default
>;
let mockWebViewProps: WebViewProps | undefined;
const mockRequestHistory: WebViewProps["requests"][] = [];

jest.mock("../CerbosEmbeddedPDPWebView", () => ({
  __esModule: true,
  default: (props: WebViewProps) => {
    if (props.requests !== mockWebViewProps?.requests) {
      mockRequestHistory.push(props.requests);
    }
    mockWebViewProps = props;
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

function serializedResponse(
  requestId: string
): SerializedCheckResourcesResponse {
  return {
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
  };
}

async function renderProvider(
  props: Partial<React.ComponentProps<typeof CerbosProvider>> = {}
) {
  const result = await render(
    <CerbosProvider ruleId="RULE1" batchInterval={5} {...props}>
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

async function waitForRequest(): Promise<string> {
  let requestId = "";
  await waitFor(() => {
    const ids = Object.keys(mockWebViewProps!.requests);
    expect(ids.length).toBeGreaterThan(0);
    requestId = ids[0];
  });
  return requestId;
}

beforeEach(() => {
  mockWebViewProps = undefined;
  mockRequestHistory.length = 0;
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
      requests: {},
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
    const requestId = await waitForRequest();
    expect(mockWebViewProps!.requests[requestId]).toEqual({ ...request, requestId });

    await act(async () => {
      mockWebViewProps!.handleResponse(serializedResponse(requestId));
    });

    const response = await promise;
    expect(response).toBeInstanceOf(CheckResourcesResponse);
    expect(response.requestId).toBe(requestId);
    expect(response.isAllowed({ resource, action: "view" })).toBe(true);
    expect(response.isAllowed({ resource, action: "edit" })).toBe(false);
    expect(response.findResult(resource)?.metadata).toBeUndefined();

    // The request is removed from the queue once answered.
    await waitFor(() => expect(mockWebViewProps!.requests).toEqual({}));
  });

  it("rejects requests that fail in the WebView", async () => {
    await renderProvider();
    await markLoaded();

    const promise = context!.checkResources(request);
    const rejection = expect(promise).rejects.toThrow("policy exploded");
    const requestId = await waitForRequest();

    await act(async () => {
      mockWebViewProps!.handleError(requestId, "policy exploded");
    });

    await rejection;
    await waitFor(() => expect(mockWebViewProps!.requests).toEqual({}));
  });

  it("rejects requests that time out", async () => {
    await renderProvider({ requestTimeout: 300 });
    await markLoaded();

    const promise = context!.checkResources(request);
    promise.catch(() => {}); // handled below, once the request ID is known
    const requestId = await waitForRequest();

    await expect(promise).rejects.toThrow(
      `Cerbos request ${requestId} timed out after 300ms`
    );
    await waitFor(() => expect(mockWebViewProps!.requests).toEqual({}));

    // A late response for the timed-out request is ignored.
    await act(async () => {
      mockWebViewProps!.handleResponse(serializedResponse(requestId));
    });
  });

  it("batches concurrent requests up to the batch size", async () => {
    await renderProvider({ maxBatchSize: 2 });
    await markLoaded();

    mockRequestHistory.length = 0;
    const promises = [1, 2, 3].map(() => context!.checkResources(request));

    // All three end up with the WebView...
    await waitFor(() =>
      expect(Object.keys(mockWebViewProps!.requests)).toHaveLength(3)
    );
    // ...but only two were handed over in the first batch.
    const firstBatch = Object.keys(mockRequestHistory[0]);
    expect(firstBatch).toHaveLength(2);

    for (const requestId of Object.keys(mockWebViewProps!.requests)) {
      await act(async () => {
        mockWebViewProps!.handleResponse(serializedResponse(requestId));
      });
    }

    const responses = await Promise.all(promises);
    expect(responses.map((r) => r.requestId).slice(0, 2)).toEqual(firstBatch);
    await waitFor(() => expect(mockWebViewProps!.requests).toEqual({}));
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
