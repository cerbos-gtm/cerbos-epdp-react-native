import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import type { SerializedBundle } from "./cerbosTypes";

// Keeps the latest bundle for each rule in the app's documents directory, so
// the PDP can start offline. Best-effort: failures are logged and ignored.

const CACHE_VERSION = 1;

// expo-file-system has no web implementation.
const isSupported = Platform.OS !== "web";

function cacheFile(ruleId: string): File {
  const safeRuleId = ruleId.replace(/[^A-Za-z0-9_-]/g, "_");
  return new File(
    Paths.document,
    `cerbos-policy-bundle-v${CACHE_VERSION}-${safeRuleId}.json`
  );
}

export async function readCachedBundle(
  ruleId: string
): Promise<SerializedBundle | null> {
  if (!isSupported) {
    return null;
  }

  try {
    const file = cacheFile(ruleId);

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

export async function writeCachedBundle(
  ruleId: string,
  bundle: SerializedBundle
): Promise<void> {
  if (!isSupported) {
    return;
  }

  try {
    const file = cacheFile(ruleId);
    file.write(JSON.stringify(bundle));
    if (__DEV__) {
      console.log(`[CerbosBundleCache] Cached bundle ${bundle.metadata.bundleId}`);
    }
  } catch (error) {
    console.warn("[CerbosBundleCache] Failed to cache bundle:", error);
  }
}

export async function clearCachedBundle(ruleId: string): Promise<void> {
  if (!isSupported) {
    return;
  }

  try {
    const file = cacheFile(ruleId);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn("[CerbosBundleCache] Failed to clear cached bundle:", error);
  }
}
