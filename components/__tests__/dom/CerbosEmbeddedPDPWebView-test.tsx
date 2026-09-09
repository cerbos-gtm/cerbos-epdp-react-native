import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import { act, render, waitFor } from "@testing-library/react-native";

import CerbosEmbeddedPDPWebView from "../../CerbosEmbeddedPDPWebView";
import type { SerializedBundle } from "../../cerbosTypes";

// This test runs under the `dom` Jest project (web platform) so that the
// "use dom" module is the component itself rather than the native WebView
// proxy. The Cerbos SDK, Cerbos Hub and the WebAssembly engine are mocked.

const mockGetBundle = jest.fn();
jest.mock("@cerbos/hub/~internal", () => ({
  createClient: () => ({ getBundle: mockGetBundle }),
}));

jest.mock("@cerbos/api/cerbos/cloud/epdp/v2/epdp_pb", () => ({
  BundleService: { typeName: "cerbos.cloud.epdp.v2.BundleService" },
}));

jest.mock("@cerbos/embedded-server", () => ({
  metadata: { cerbosVersion: "0.55.0-test" },
}));

interface EmbeddedOptions {
  policies: Uint8Array;
  wasm: Promise<WebAssembly.Module>;
  onDecision?: (entry: unknown) => unknown;
}
const mockEmbeddedInstances: MockEmbedded[] = [];
const mockCheckResources = jest.fn();

class MockEmbedded {
  constructor(readonly options: EmbeddedOptions) {
    mockEmbeddedInstances.push(this);
  }

  async serverInfo() {
    await this.options.wasm;
    return { version: "0.55.0-test" };
  }

  checkResources(request: unknown) {
    return mockCheckResources(this, request);
  }
}

jest.mock("@cerbos/embedded-client", () => ({
  // Resolved lazily: the mock factory runs before the class above is initialised.
  get Embedded() {
    return MockEmbedded;
  },
}));

const contents = new Uint8Array([1, 2, 3, 4]);
const hubBundle = {
  metadata: { bundleId: "HUB1", ruleRevision: BigInt(5) },
  contents,
};
const cachedBundle: SerializedBundle = {
  metadata: { bundleId: "CACHED1", ruleRevision: "4" },
  contentsBase64: base64Encode(new Uint8Array([9, 9])),
};

const resource = { kind: "document", id: "doc1", attr: {} };
const request = {
  requestId: "req-1",
  principal: { id: "alice", roles: ["editor"], attr: {} },
  resources: [{ resource, actions: ["view"] }],
};

function createCallbacks() {
  return {
    handleBundleDownloaded: jest.fn(),
    handlePDPUpdated: jest.fn(),
    handleLoadError: jest.fn(),
    handleResponse: jest.fn(),
    handleError: jest.fn(),
    handleDecisionLog: jest.fn(),
  };
}

const wasmModule = {} as WebAssembly.Module;

beforeEach(() => {
  mockEmbeddedInstances.length = 0;
  mockGetBundle.mockReset();
  mockCheckResources.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
  jest.spyOn(WebAssembly, "compile").mockResolvedValue(wasmModule);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderWebView(
  props: Partial<React.ComponentProps<typeof CerbosEmbeddedPDPWebView>> = {}
) {
  const callbacks = createCallbacks();
  const result = await render(
    <CerbosEmbeddedPDPWebView
      ruleId="RULE1"
      refreshIntervalSeconds={0}
      requests={{}}
      {...callbacks}
      {...props}
    />
  );
  return { ...result, callbacks };
}

describe("CerbosEmbeddedPDPWebView", () => {
  it("downloads the bundle from Cerbos Hub, caches it and starts the PDP", async () => {
    mockGetBundle.mockResolvedValue({ result: { case: "bundle", value: hubBundle } });

    const { callbacks } = await renderWebView({ scopes: ["a", "b"] });

    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());

    expect(mockGetBundle).toHaveBeenCalledWith(
      { ruleId: "RULE1", scopes: ["a", "b"], ifModifiedSince: undefined },
      { signal: expect.any(AbortSignal) }
    );
    expect(callbacks.handleBundleDownloaded).toHaveBeenCalledWith({
      metadata: { bundleId: "HUB1", ruleRevision: "5" },
      contentsBase64: base64Encode(contents),
    });
    expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith({
      updatedAt: expect.any(String),
      source: "hub",
      bundle: { bundleId: "HUB1", ruleRevision: "5" },
      cerbosVersion: "0.55.0-test",
    });
    expect(callbacks.handleLoadError).not.toHaveBeenCalled();

    // The engine is fetched as a bundled asset and started with the bundle.
    expect(globalThis.fetch).toHaveBeenCalledWith("server.wasm");
    expect(mockEmbeddedInstances).toHaveLength(1);
    expect(mockEmbeddedInstances[0].options.policies).toEqual(contents);
    await expect(mockEmbeddedInstances[0].options.wasm).resolves.toBe(wasmModule);
  });

  it("starts from the cached bundle and keeps it when Cerbos Hub reports no change", async () => {
    mockGetBundle.mockResolvedValue({ result: { case: "notModified", value: {} } });

    const { callbacks } = await renderWebView({ initialBundle: cachedBundle });

    await waitFor(() => expect(mockGetBundle).toHaveBeenCalled());
    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());

    expect(callbacks.handlePDPUpdated).toHaveBeenCalledTimes(1);
    expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ source: "cache", bundle: cachedBundle.metadata })
    );
    expect(mockGetBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        ifModifiedSince: { bundleId: "CACHED1", ruleRevision: BigInt(4) },
      }),
      expect.anything()
    );
    expect(callbacks.handleBundleDownloaded).not.toHaveBeenCalled();
    expect(mockEmbeddedInstances).toHaveLength(1);
    expect(mockEmbeddedInstances[0].options.policies).toEqual(
      base64Decode(cachedBundle.contentsBase64)
    );
  });

  it("replaces the cached bundle when Cerbos Hub has a newer one", async () => {
    mockGetBundle.mockResolvedValue({ result: { case: "bundle", value: hubBundle } });

    const { callbacks } = await renderWebView({ initialBundle: cachedBundle });

    await waitFor(() =>
      expect(callbacks.handlePDPUpdated).toHaveBeenCalledTimes(2)
    );

    expect(callbacks.handlePDPUpdated.mock.calls.map(([m]) => m.source)).toEqual(
      ["cache", "hub"]
    );
    expect(callbacks.handleBundleDownloaded).toHaveBeenCalledTimes(1);
    expect(mockEmbeddedInstances).toHaveLength(2);
  });

  it("keeps serving the cached bundle when Cerbos Hub is unreachable", async () => {
    mockGetBundle.mockRejectedValue(new Error("offline"));

    const { callbacks } = await renderWebView({ initialBundle: cachedBundle });

    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());
    await waitFor(() => expect(mockGetBundle).toHaveBeenCalled());

    expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ source: "cache" })
    );
    expect(callbacks.handleLoadError).not.toHaveBeenCalled();
  });

  it("reports a load error when there is no cache and Cerbos Hub is unreachable", async () => {
    mockGetBundle.mockRejectedValue(new Error("offline"));

    const { callbacks } = await renderWebView();

    await waitFor(() =>
      expect(callbacks.handleLoadError).toHaveBeenCalledWith("offline")
    );
    expect(callbacks.handlePDPUpdated).not.toHaveBeenCalled();
  });

  it("evaluates requests once, forwarding responses and decision logs", async () => {
    mockGetBundle.mockResolvedValue({ result: { case: "bundle", value: hubBundle } });
    mockCheckResources.mockImplementation(async (embedded: MockEmbedded) => {
      await embedded.options.onDecision?.({
        callId: "CALL1",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
      });
      return {
        requestId: "req-1",
        cerbosCallId: "CALL1",
        results: [
          {
            resource: { ...resource, policyVersion: "default", scope: "" },
            actions: { view: "EFFECT_ALLOW" },
            validationErrors: [],
            metadata: undefined,
            outputs: [],
          },
        ],
      };
    });

    const { callbacks, rerender } = await renderWebView();
    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());

    const requests = { "req-1": request };
    await act(async () => {
      await rerender(
        <CerbosEmbeddedPDPWebView
          ruleId="RULE1"
          refreshIntervalSeconds={0}
          requests={requests}
          {...callbacks}
        />
      );
    });

    await waitFor(() => expect(callbacks.handleResponse).toHaveBeenCalled());
    expect(mockCheckResources).toHaveBeenCalledWith(expect.anything(), request);
    expect(callbacks.handleResponse).toHaveBeenCalledWith({
      requestId: "req-1",
      cerbosCallId: "CALL1",
      results: [
        {
          resource: { ...resource, policyVersion: "default", scope: "" },
          actions: { view: "EFFECT_ALLOW" },
          validationErrors: [],
          metadata: null,
          outputs: [],
        },
      ],
    });
    expect(callbacks.handleDecisionLog).toHaveBeenCalledWith({
      callId: "CALL1",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    // Re-sending the same batch (React Native re-renders often) does not
    // evaluate the request again.
    await act(async () => {
      await rerender(
        <CerbosEmbeddedPDPWebView
          ruleId="RULE1"
          refreshIntervalSeconds={0}
          requests={{ ...requests }}
          {...callbacks}
        />
      );
    });
    expect(mockCheckResources).toHaveBeenCalledTimes(1);
  });

  it("reports request failures", async () => {
    mockGetBundle.mockResolvedValue({ result: { case: "bundle", value: hubBundle } });
    mockCheckResources.mockRejectedValue(new Error("bad request"));

    const { callbacks, rerender } = await renderWebView();
    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());

    await act(async () => {
      await rerender(
        <CerbosEmbeddedPDPWebView
          ruleId="RULE1"
          refreshIntervalSeconds={0}
          requests={{ "req-1": request }}
          {...callbacks}
        />
      );
    });

    await waitFor(() =>
      expect(callbacks.handleError).toHaveBeenCalledWith("req-1", "bad request")
    );
    expect(callbacks.handleResponse).not.toHaveBeenCalled();
  });
});
