import {
  clearCachedBundle,
  readCachedBundle,
  writeCachedBundle,
} from "../cerbosBundleCache";
import type { SerializedBundle } from "../cerbosTypes";

// In-memory stand-in for expo-file-system's `File`.
const mockFiles = new Map<string, string>();
let mockConstructorError: Error | undefined;

jest.mock("expo-file-system", () => {
  class File {
    readonly uri: string;

    constructor(directory: { uri: string }, name: string) {
      if (mockConstructorError) {
        throw mockConstructorError;
      }
      this.uri = `${directory.uri}${name}`;
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }

    async text(): Promise<string> {
      const content = mockFiles.get(this.uri);
      if (content === undefined) {
        throw new Error(`File does not exist: ${this.uri}`);
      }
      return content;
    }

    write(content: string): void {
      mockFiles.set(this.uri, content);
    }

    delete(): void {
      mockFiles.delete(this.uri);
    }
  }

  return { File, Paths: { document: { uri: "file:///documents/" } } };
});


const bundle: SerializedBundle = {
  metadata: { bundleId: "BUNDLE1", ruleRevision: "7" },
  contentsBase64: "AAEC",
};

beforeEach(() => {
  mockFiles.clear();
  mockConstructorError = undefined;
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("cerbosBundleCache", () => {
  it("returns null when nothing is cached", async () => {
    await expect(readCachedBundle("RULE1")).resolves.toBeNull();
  });

  it("round-trips a bundle per rule", async () => {
    await writeCachedBundle("RULE1", bundle);

    await expect(readCachedBundle("RULE1")).resolves.toEqual(bundle);
    await expect(readCachedBundle("RULE2")).resolves.toBeNull();
    expect([...mockFiles.keys()]).toEqual([
      "file:///documents/cerbos-policy-bundle-v1-RULE1.json",
    ]);
  });

  it("sanitises the rule ID in the file name", async () => {
    await writeCachedBundle("../weird/rule", bundle);

    expect([...mockFiles.keys()]).toEqual([
      "file:///documents/cerbos-policy-bundle-v1-___weird_rule.json",
    ]);
  });

  it("ignores malformed cached content", async () => {
    mockFiles.set("file:///documents/cerbos-policy-bundle-v1-RULE1.json", "{nope");
    await expect(readCachedBundle("RULE1")).resolves.toBeNull();

    mockFiles.set(
      "file:///documents/cerbos-policy-bundle-v1-RULE1.json",
      JSON.stringify({ metadata: { bundleId: "X" } })
    );
    await expect(readCachedBundle("RULE1")).resolves.toBeNull();
  });

  it("clears a cached bundle", async () => {
    await writeCachedBundle("RULE1", bundle);
    await clearCachedBundle("RULE1");

    await expect(readCachedBundle("RULE1")).resolves.toBeNull();
    await expect(clearCachedBundle("RULE1")).resolves.toBeUndefined();
  });

  it("never throws when the file system is unavailable", async () => {
    mockConstructorError = new Error("this.validatePath is not a function");

    await expect(readCachedBundle("RULE1")).resolves.toBeNull();
    await expect(writeCachedBundle("RULE1", bundle)).resolves.toBeUndefined();
    await expect(clearCachedBundle("RULE1")).resolves.toBeUndefined();
  });
});
