# Reference Implementation of a Cerbos ePDP in React Native

This is a standard [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app). Added to this is a reference implementation of running an embedded Cerbos policy decision point (ePDP) on device, with policies pulled from [Cerbos Hub](https://hub.cerbos.cloud) and cached locally, and calling `checkResources` against it.

## How it works

React Native does not have native support for WebAssembly, so the ePDP runs inside an [Expo DOM component](https://docs.expo.dev/guides/dom-components/) (a hidden `react-native-webview`). Expo bundles the DOM component, including the ePDP WebAssembly module, into the app.

- [`components/CerbosEmbeddedPDPWebView.tsx`](components/CerbosEmbeddedPDPWebView.tsx) is the DOM component. It uses [`@cerbos/embedded-client`](https://www.npmjs.com/package/@cerbos/embedded-client) and [`@cerbos/embedded-server`](https://www.npmjs.com/package/@cerbos/embedded-server) to run the ePDP, downloads the policy bundle for your rule from Cerbos Hub, evaluates requests and reports decision logs.
- [`components/CerbosContext.tsx`](components/CerbosContext.tsx) provides `CerbosProvider` and the `useCerbos` hook. It marshals requests and responses between the app and the WebView (batching requests and applying a timeout), exposes the callbacks, and caches the latest policy bundle on device.
- [`components/cerbosTypes.ts`](components/cerbosTypes.ts) defines the JSON-serializable shapes that cross the WebView bridge.
- [`components/cerbosBundleCache.ts`](components/cerbosBundleCache.ts) stores the most recently downloaded policy bundle in the app's document directory.
- [`metro.config.js`](metro.config.js) registers `.wasm` files as assets so the ePDP WebAssembly module can be bundled with the app.

Offline support is handled by caching the latest policy bundle on device. On launch, a cached bundle is activated immediately and Cerbos Hub is then checked for a newer one. By default, a check for updates is made every 5 minutes, and the app keeps serving the last available bundle whenever Cerbos Hub is unreachable.

## Using the provider

Render `CerbosProvider` once, near the root of your app:

```tsx
<CerbosProvider
  ruleId="YOUR_RULE_ID"
  // Optional:
  scopes={[]}
  hub={{ baseUrl: "https://api.cerbos.cloud" }}
  engineOptions={{ lenientScopeSearch: true, schemaEnforcement: "warn" }}
  refreshIntervalSeconds={300}
  onDecision={(entry) => audit.record(entry)}
  onValidationError={(errors) => console.warn(errors)}
  onUpdateError={(message) => console.warn(message)}
  decodeJWTPayload={async (jwt) => verifyAndDecode(jwt)}
>
  {children}
</CerbosProvider>
```

`useCerbos()` then gives you the same methods as the Cerbos JavaScript SDK, evaluated on device, plus the PDP's state:

| Member | Description |
| --- | --- |
| `checkResources(request)` | Check a principal's permissions on a set of resources. Returns a [`CheckResourcesResponse`](https://cerbos.github.io/cerbos-sdk-javascript/classes/_cerbos_core.CheckResourcesResponse.html). |
| `checkResource(request)` | Check a single resource. Returns a [`CheckResourcesResult`](https://cerbos.github.io/cerbos-sdk-javascript/classes/_cerbos_core.CheckResourcesResult.html). |
| `isAllowed(request)` | Check a single action on a single resource. Returns a boolean. |
| `planResources(request)` | Produce a query plan for the resources a principal may perform an action on. Returns a [`PlanResourcesResponse`](https://cerbos.github.io/cerbos-sdk-javascript/types/_cerbos_core.PlanResourcesResponse.html). |
| `status` | `loading`, `ready` or `error`. |
| `isLoaded` | `true` when `status` is `ready`. |
| `metadata` | The active bundle (ID and revision), where it came from, when it was activated and the Cerbos version. |
| `error` | Why the PDP failed to load, if it did. |
| `updateError` | Why the last check for policy updates failed, if it did. The current bundle keeps serving. |

All methods reject if the PDP is not ready or the request fails: treat a rejection as a denial.

```tsx
const { checkResources, isLoaded } = useCerbos();

const result = await checkResources({
  principal: { id: "alice", roles: ["USER"], attr: { department: "IT" } },
  resources: [
    {
      resource: { kind: "resource", id: "doc1", attr: { ownerId: "sally", status: "published" } },
      actions: ["view"],
    },
  ],
});
result.isAllowed({ resource: { kind: "resource", id: "doc1" }, action: "view" });
```

Requests with `auxData.jwt` need a `decodeJWTPayload` callback that verifies the token and returns its claims. Decision logs and validation errors are delivered as plain JSON because they cross the WebView bridge (`DecisionLogEntry.timestamp` is an ISO 8601 string).

Every React Native implementation has its own quirks, so this reference project should be adapted to best fit into your application - please get in touch with us for any questions or additional use cases.

## The demo app

The tabs exercise the provider against your rule:

- **ePDP**: the PDP's status and the active bundle. Change the rule ID, the Cerbos Hub base URL, the engine options (JSON) and which callbacks are enabled, then apply to restart the PDP with the new configuration.
- **Check**: pick a principal and a resource from [`constants/data.ts`](constants/data.ts) and see which actions are allowed (`checkResources`).
- **Request**: edit a `checkResource` request as JSON and run it.
- **Plan**: edit a `planResources` request as JSON and run it.
- **Audit**: the decision log entries and other events received through the callbacks.

The demo-only plumbing (runtime reconfiguration and log collection) lives in [`components/demo/`](components/demo/); your app doesn't need it.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Create an ePDP policy bundling rule in Cerbos Hub: open your deployment, go to the **Embedded PDP rules** tab and click **Create rule**. Set its authentication to **Public access** (client credentials must not be shipped in a mobile app) and copy the rule ID. See the [Cerbos Hub documentation](https://docs.cerbos.dev/cerbos-hub/deployments-epdp-rules) for details.

3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_CERBOS_HUB_RULE_ID` to the rule ID (or replace the fallback value in `components/demo/DemoContext.tsx`, or enter it in the ePDP tab at runtime).

4. Build and run the app. The ePDP relies on `react-native-webview`, which is included in [Expo Go](https://expo.dev/go), so you can start with:

   ```bash
   npx expo start
   ```

   To build a development build or a release, generate the native projects with [prebuild](https://docs.expo.dev/workflow/prebuild/) (the `ios` and `android` directories are not committed):

   ```bash
   npx expo run:ios
   npx expo run:android
   ```

## Scripts

- `npm run typecheck` runs the TypeScript compiler.
- `npm run lint` runs ESLint.
- `npm run test:ci` runs the Jest test suite once (`npm test` runs it in watch mode). The `dom` Jest project runs the DOM component on the web platform, where the `"use dom"` module is the component itself rather than the native WebView proxy.

## Hardening

The integration is designed so that the app keeps working when things go wrong, without ever trusting a bad input:

- **Engine integrity.** The DOM component hashes the bundled `server.wasm` and refuses to run it unless the SHA-256 matches the checksum published in `@cerbos/embedded-server`'s metadata.
- **Last known-good bundle.** A bundle downloaded from Cerbos Hub is only cached after the engine has loaded it, so a bad download can never replace a working cached bundle. If a new bundle fails to load, the current one keeps serving.
- **Retries.** With no cached bundle and Cerbos Hub unreachable, the download is retried with exponential backoff (2s up to 60s) and immediately when connectivity returns. Later update checks that fail are reported through `updateError` in the context and the `onUpdateError` callback, while the current bundle stays active.
- **Status.** `useCerbos()` exposes `status` (`loading`, `ready` or `error`) in addition to `isLoaded`, `error` and `updateError`. Requests made before the PDP is ready are rejected: treat a rejection as a denial.
- **WebView lockdown.** The hidden WebView uses `react-native-webview` with navigation restricted to the bundled DOM component (and the Metro dev server in development), no pop-ups, no multiple windows and no link previews. If the OS kills the WebView process, Expo reloads it and the provider reports `loading` until the PDP is ready again.
- **Logging.** Request contents and decision logs are only printed in development builds.
- **Hub credentials.** Rules downloaded directly by the app must allow public access. `hub.credentials` is supported, but anything shipped in an app can be extracted from it: prefer a backend of your own (set as `hub.baseUrl`) that holds the credentials and serves bundles to the app.
- **Dependencies.** `@cerbos/embedded-client` and `@cerbos/embedded-server` are pinned to matching versions and grouped in Renovate so they are always upgraded together. Because the engine is a DOM component asset, an [EAS Update](https://docs.expo.dev/eas-update/introduction/) can ship a new engine without an app store release.
- **CI.** The GitHub Actions workflow runs the typecheck, lint, tests and an iOS and Android export (which bundles the DOM component and the engine) on every pull request.

Decisions made on a device can be bypassed by a modified app, and the principal attributes are supplied by the app itself. Use the ePDP to gate the UI and to work offline, and enforce the same policies on your backend.

## Notes

- The policies used by the demo are in [`policies/resource.yaml`](policies/resource.yaml); this repository is connected to Cerbos Hub via [`.cerbos-hub.yaml`](.cerbos-hub.yaml).
- The ePDP WebAssembly module (`@cerbos/embedded-server/server.wasm`) is about 20 MB and is bundled into the app, so no engine download is needed at runtime. Keep `@cerbos/embedded-client` and `@cerbos/embedded-server` at matching versions when upgrading.
- Decision logs are delivered to `onDecision` as plain JSON (the `timestamp` is an ISO 8601 string) because they cross the WebView bridge.

## Further plans

- Investigate the best way to do E2E testing with simulators (the WebView path is currently verified by bundling output and unit tests, plus a browser run of the web build).
