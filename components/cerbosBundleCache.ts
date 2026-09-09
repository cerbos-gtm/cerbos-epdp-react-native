import { File, Paths } from "expo-file-system";

import type { SerializedBundle } from "./cerbosTypes";

// Persists the most recently downloaded policy bundle so the embedded PDP can
// start without a network connection. Bundles are stored per rule ID in the
// app's document directory.

const CACHE_VERSION = 1;

function cacheFile(ruleId: string): File {
  const safeRuleId = ruleId.replace(/[^A-Za-z0-9_-]/g, "_");
  return new File(
    Paths.document,
    `cerbos-policy-bundle-v${CACHE_VERSION}-${safeRuleId}.json`
  );
}

/**
 * Read the cached policy bundle for a rule, if there is one.
 */
export async function readCachedBundle(
  ruleId: string
): Promise<SerializedBundle | null> {
  const file = cacheFile(ruleId);

  try {
    if (!file.exists) {
      return null;
    }

    const bundle = JSON.parse(await file.text()) as Partial<SerializedBundle>;

    if (
      typeof bundle.contentsBase64 !== "string" ||
      typeof bundle.metadata?.bundleId !== "string" ||
      typeof bundle.metadata?.ruleRevision !== "string"
    ) {
      console.warn(
        "[CerbosBundleCache] Ignoring malformed cached bundle:",
        file.uri
      );
      return null;
    }

    return bundle as SerializedBundle;
  } catch (error) {
    console.warn("[CerbosBundleCache] Failed to read cached bundle:", error);
    return null;
  }
}

/**
 * Cache a policy bundle for a rule, replacing any previous one.
 */
export async function writeCachedBundle(
  ruleId: string,
  bundle: SerializedBundle
): Promise<void> {
  const file = cacheFile(ruleId);

  try {
    file.write(JSON.stringify(bundle));
    console.log(
      `[CerbosBundleCache] Cached policy bundle ${bundle.metadata.bundleId} at ${file.uri}`
    );
  } catch (error) {
    console.warn("[CerbosBundleCache] Failed to cache bundle:", error);
  }
}

/**
 * Remove the cached policy bundle for a rule.
 */
export async function clearCachedBundle(ruleId: string): Promise<void> {
  const file = cacheFile(ruleId);

  try {
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn("[CerbosBundleCache] Failed to clear cached bundle:", error);
  }
}
