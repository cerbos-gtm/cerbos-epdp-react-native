import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { act, render, waitFor } from "@testing-library/react-native";

import CerbosEmbeddedPDPWebView from "../../CerbosEmbeddedPDPWebView";
import type { SerializedBundle } from "../../cerbosTypes";

// This test runs under the `dom` Jest project (web platform) so that the
// "use dom" module is the component itself rather than the native WebView
// proxy. The Cerbos SDK, Cerbos Hub and the WebAssembly engine are mocked.

type Props = React.ComponentProps<typeof CerbosEmbeddedPDPWebView>;

const mockGetBundle = jest.fn();
jest.mock("@cerbos/hub/~internal", () => ({
  createClient: () => ({ getBundle: mockGetBundle }),
}));

jest.mock("@cerbos/api/cerbos/cloud/epdp/v2/epdp_pb", () => ({
  BundleService: { typeName: "cerbos.cloud.epdp.v2.BundleService" },
}));

// The bytes served as the engine, and the checksum the SDK claims for it.
const mockWasmBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
let mockWasmChecksum = "";
jest.mock("@cerbos/embedded-server", () => ({
  metadata: {
    cerbosVersion: "0.55.0-test",
    // Read lazily so each test can choose the expected checksum.
    get wasmChecksum() {
      return mockWasmChecksum;
    },
  },
}));

interface EmbeddedOptions {
  policies: Uint8Array;
  wasm: Promise<WebAssembly.Module>;
  onDecision?: (entry: unknown) => unknown;
}
const mockEmbeddedInstances: MockEmbedded[] = [];
const mockCheckResources = jest.fn();
const mockServerInfo = jest.fn();

class MockEmbedded {
  constructor(readonly options: EmbeddedOptions) {
    mockEmbeddedInstances.push(this);
  }

  async serverInfo() {
    await this.options.wasm;
    return mockServerInfo(this);
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
const hubResponse = { result: { case: "bundle", value: hubBundle } };
const notModified = { result: { case: "notModified", value: {} } };
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

const wasmModule = {} as WebAssembly.Module;

beforeEach(() => {
  mockEmbeddedInstances.length = 0;
  mockGetBundle.mockReset();
  mockCheckResources.mockReset();
  mockServerInfo.mockReset().mockResolvedValue({ version: "0.55.0-test" });
  mockWasmChecksum = bytesToHex(sha256(mockWasmBytes));
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => mockWasmBytes.slice().buffer,
  })) as unknown as typeof fetch;
  jest.spyOn(WebAssembly, "compile").mockResolvedValue(wasmModule);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Run a test body with fake timers. `crypto.subtle.digest` completes on a real
// thread that fake timers cannot advance, so force the synchronous JS hash.
// Real timers are restored before Testing Library's own cleanup hook runs.
async function withFakeTimers(body: () => Promise<void>): Promise<void> {
  jest.useFakeTimers();
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: undefined,
    configurable: true,
  });
  try {
    await body();
  } finally {
    delete (globalThis.crypto as { subtle?: unknown }).subtle;
    jest.useRealTimers();
  }
}

// Let the component's pending promise chains settle under fake timers.
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function createCallbacks() {
  return {
    handleBundleDownloaded: jest.fn(),
    handlePDPUpdated: jest.fn(),
    handleLoadError: jest.fn(),
    handleUpdateResult: jest.fn(),
    handleResponse: jest.fn(),
    handleError: jest.fn(),
    handleDecisionLog: jest.fn(),
  };
}

function element(
  callbacks: ReturnType<typeof createCallbacks>,
  props: Partial<Props> = {}
) {
  return (
    <CerbosEmbeddedPDPWebView
      ruleId="RULE1"
      refreshIntervalSeconds={0}
      requests={{}}
      {...callbacks}
      {...props}
    />
  );
}

async function renderWebView(props: Partial<Props> = {}) {
  const callbacks = createCallbacks();
  const result = await render(element(callbacks, props));
  return { ...result, callbacks };
}

describe("CerbosEmbeddedPDPWebView", () => {
  it("downloads the bundle from Cerbos Hub, starts the PDP and then caches it", async () => {
    mockGetBundle.mockResolvedValue(hubResponse);

    const { callbacks } = await renderWebView({ scopes: ["a", "b"] });

    await waitFor(() =>
      expect(callbacks.handleBundleDownloaded).toHaveBeenCalled()
    );

    expect(mockGetBundle).toHaveBeenCalledWith(
      { ruleId: "RULE1", scopes: ["a", "b"], ifModifiedSince: undefined },
      { signal: expect.any(AbortSignal) }
    );
    expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith({
      updatedAt: expect.any(String),
      source: "hub",
      bundle: { bundleId: "HUB1", ruleRevision: "5" },
      cerbosVersion: "0.55.0-test",
    });
    expect(callbacks.handleBundleDownloaded).toHaveBeenCalledWith({
      metadata: { bundleId: "HUB1", ruleRevision: "5" },
      contentsBase64: base64Encode(contents),
    });
    // The bundle is only cached once the engine has loaded it.
    expect(callbacks.handlePDPUpdated.mock.invocationCallOrder[0]).toBeLessThan(
      callbacks.handleBundleDownloaded.mock.invocationCallOrder[0]
    );
    expect(callbacks.handleUpdateResult).toHaveBeenCalledWith(null);
    expect(callbacks.handleLoadError).not.toHaveBeenCalled();

    // The engine is fetched as a bundled asset and started with the bundle.
    expect(globalThis.fetch).toHaveBeenCalledWith("server.wasm");
    expect(mockEmbeddedInstances).toHaveLength(1);
    expect(mockEmbeddedInstances[0].options.policies).toEqual(contents);
    await expect(mockEmbeddedInstances[0].options.wasm).resolves.toBe(
      wasmModule
    );
  });

  it("refuses to run an engine whose checksum doesn't match the SDK's", async () => {
    mockGetBundle.mockResolvedValue(hubResponse);
    mockWasmChecksum = "0".repeat(64);

    const { callbacks } = await renderWebView();

    await waitFor(() => expect(callbacks.handleLoadError).toHaveBeenCalled());
    expect(callbacks.handleLoadError.mock.calls[0][0]).toMatch(
      /integrity check failed/
    );
    expect(WebAssembly.compile).not.toHaveBeenCalled();
    expect(callbacks.handlePDPUpdated).not.toHaveBeenCalled();
    expect(callbacks.handleBundleDownloaded).not.toHaveBeenCalled();
  });

  it("does not cache a downloaded bundle that the engine fails to load", async () => {
    mockGetBundle.mockResolvedValue(hubResponse);
    mockServerInfo.mockRejectedValue(new Error("incompatible bundle"));

    const { callbacks } = await renderWebView({ initialBundle: cachedBundle });

    await waitFor(() =>
      expect(callbacks.handleUpdateResult).toHaveBeenCalledWith(
        "incompatible bundle"
      )
    );
    expect(callbacks.handleBundleDownloaded).not.toHaveBeenCalled();
    // Failing to load the cached bundle too means nothing is active.
    expect(callbacks.handlePDPUpdated).not.toHaveBeenCalled();
    expect(callbacks.handleLoadError).toHaveBeenCalledWith(
      "incompatible bundle"
    );
  });

  it("starts from the cached bundle and keeps it when Cerbos Hub reports no change", async () => {
    mockGetBundle.mockResolvedValue(notModified);

    const { callbacks } = await renderWebView({ initialBundle: cachedBundle });

    await waitFor(() =>
      expect(callbacks.handleUpdateResult).toHaveBeenCalledWith(null)
    );

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
    mockGetBundle.mockResolvedValue(hubResponse);

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

    await waitFor(() =>
      expect(callbacks.handleUpdateResult).toHaveBeenCalledWith("offline")
    );

    expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ source: "cache" })
    );
    expect(callbacks.handleLoadError).not.toHaveBeenCalled();
  });

  it("reports a load error and retries with backoff when there is no cache and Cerbos Hub is unreachable", () =>
    withFakeTimers(async () => {
      mockGetBundle.mockRejectedValue(new Error("offline"));

      const { callbacks } = await renderWebView();
      await flush();

      expect(callbacks.handleLoadError).toHaveBeenCalledWith("offline");
      expect(callbacks.handleUpdateResult).toHaveBeenCalledWith("offline");
      expect(callbacks.handlePDPUpdated).not.toHaveBeenCalled();
      expect(mockGetBundle).toHaveBeenCalledTimes(1);

      // Second attempt after 2s, third after a further 4s.
      await flush(2_000);
      expect(mockGetBundle).toHaveBeenCalledTimes(2);
      await flush(3_999);
      expect(mockGetBundle).toHaveBeenCalledTimes(2);
      await flush(1);
      expect(mockGetBundle).toHaveBeenCalledTimes(3);

      // Once Cerbos Hub responds the PDP starts and retries stop.
      mockGetBundle.mockResolvedValue(hubResponse);
      await flush(8_000);
      expect(mockGetBundle).toHaveBeenCalledTimes(4);
      expect(callbacks.handlePDPUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ source: "hub" })
      );
      expect(callbacks.handleUpdateResult).toHaveBeenLastCalledWith(null);
      await flush(120_000);
      expect(mockGetBundle).toHaveBeenCalledTimes(4);
    }));

  it("retries immediately when connectivity returns", () =>
    withFakeTimers(async () => {
      mockGetBundle.mockRejectedValue(new Error("offline"));

      await renderWebView();
      await flush();
      expect(mockGetBundle).toHaveBeenCalledTimes(1);

      mockGetBundle.mockResolvedValue(hubResponse);
      await act(async () => {
        globalThis.dispatchEvent(new Event("online"));
      });
      await flush();
      expect(mockGetBundle).toHaveBeenCalledTimes(2);
    }));

  it("checks Cerbos Hub for updates periodically", () =>
    withFakeTimers(async () => {
      mockGetBundle.mockResolvedValue(hubResponse);

      const { callbacks } = await renderWebView({
        refreshIntervalSeconds: 60,
      });
      await flush();
      expect(callbacks.handlePDPUpdated).toHaveBeenCalledTimes(1);

      mockGetBundle.mockResolvedValue(notModified);
      await flush(60_000);
      expect(mockGetBundle).toHaveBeenCalledTimes(2);
      expect(mockGetBundle).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ifModifiedSince: { bundleId: "HUB1", ruleRevision: BigInt(5) },
        }),
        expect.anything()
      );

      // A failed check is reported but the PDP stays up.
      mockGetBundle.mockRejectedValue(new Error("hub down"));
      await flush(60_000);
      expect(callbacks.handleUpdateResult).toHaveBeenLastCalledWith(
        "hub down"
      );
      expect(callbacks.handleLoadError).not.toHaveBeenCalled();
      expect(callbacks.handlePDPUpdated).toHaveBeenCalledTimes(1);
    }));

  it("evaluates requests once, forwarding responses and decision logs", async () => {
    mockGetBundle.mockResolvedValue(hubResponse);
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
      await rerender(element(callbacks, { requests }));
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
      await rerender(element(callbacks, { requests: { ...requests } }));
    });
    expect(mockCheckResources).toHaveBeenCalledTimes(1);
  });

  it("reports request failures", async () => {
    mockGetBundle.mockResolvedValue(hubResponse);
    mockCheckResources.mockRejectedValue(new Error("bad request"));

    const { callbacks, rerender } = await renderWebView();
    await waitFor(() => expect(callbacks.handlePDPUpdated).toHaveBeenCalled());

    await act(async () => {
      await rerender(element(callbacks, { requests: { "req-1": request } }));
    });

    await waitFor(() =>
      expect(callbacks.handleError).toHaveBeenCalledWith("req-1", "bad request")
    );
    expect(callbacks.handleResponse).not.toHaveBeenCalled();
  });
});
