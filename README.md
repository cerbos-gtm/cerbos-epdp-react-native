# Cerbos ePDP for React Native

A reference [Expo](https://expo.dev) app that runs the Cerbos embedded policy decision point (ePDP) on the device. Policies come from [Cerbos Hub](https://hub.cerbos.cloud) and are cached, so authorization decisions are made locally and keep working offline.

## Quick start

1. In Cerbos Hub, open your deployment, go to **Embedded PDP rules** and click **Create rule**. Set authentication to **Public access** and copy the rule ID. See [the Hub docs](https://docs.cerbos.dev/cerbos-hub/deployments-epdp-rules).
2. Install and configure:

   ```sh
   npm install
   cp .env.example .env   # then set EXPO_PUBLIC_CERBOS_HUB_RULE_ID
   ```

3. Run it:

   ```sh
   npx expo run:ios       # or: npx expo run:android
   ```

The **ePDP** tab shows the loaded bundle. **Check** runs `checkResources` for the demo users and documents in [`constants/data.ts`](constants/data.ts), using the policy in [`policies/resource.yaml`](policies/resource.yaml).

## Add it to your app

Copy these into your project:

- [`components/CerbosContext.tsx`](components/CerbosContext.tsx): `CerbosProvider` and `useCerbos`.
- [`components/CerbosEmbeddedPDPWebView.tsx`](components/CerbosEmbeddedPDPWebView.tsx): runs the engine.
- [`components/cerbosTypes.ts`](components/cerbosTypes.ts) and [`components/cerbosBundleCache.ts`](components/cerbosBundleCache.ts).
- The `wasm` line in [`metro.config.js`](metro.config.js) and [`types/wasm.d.ts`](types/wasm.d.ts).

Install the dependencies they use:

```sh
npx expo install @cerbos/embedded-client @cerbos/embedded-server @cerbos/core @cerbos/api @cerbos/hub \
  @bufbuild/protobuf @noble/hashes expo-crypto expo-file-system react-native-webview react-dom react-native-web
```

Keep `@cerbos/embedded-client` and `@cerbos/embedded-server` pinned to versions that match.

Wrap your app in the provider:

```tsx
import { CerbosProvider } from "@/components/CerbosContext";

export default function RootLayout() {
  return (
    <CerbosProvider ruleId="YOUR_RULE_ID">
      <Stack />
    </CerbosProvider>
  );
}
```

Then check permissions anywhere below it:

```tsx
const { checkResources, isLoaded } = useCerbos();

const decision = await checkResources({
  principal: { id: "alice", roles: ["USER"], attr: {} },
  resources: [
    { resource: { kind: "resource", id: "doc1", attr: { ownerId: "alice" } }, actions: ["read", "update"] },
  ],
});
decision.isAllowed({ resource: { kind: "resource", id: "doc1" }, action: "update" });
```

### `useCerbos()`

| Member | |
| --- | --- |
| `checkResources`, `checkResource`, `isAllowed`, `planResources` | Same as the [Cerbos JavaScript SDK](https://cerbos.github.io/cerbos-sdk-javascript/), evaluated on the device. |
| `status` | `loading`, `ready` or `error`. `isLoaded` is `status === "ready"`. |
| `metadata` | The active bundle and where it came from (`hub` or `cache`). |
| `error` | Why no bundle could be loaded. Loading keeps retrying. |
| `updateError` | Why the last check for a newer bundle failed. The current bundle keeps serving. |

Methods reject while the PDP isn't ready or when a request fails. Treat a rejection as a denial.

### `CerbosProvider` props

| Prop | Default | |
| --- | --- | --- |
| `ruleId` | | Required. |
| `scopes` | all | Scopes to include in the bundle. |
| `hub` | public Hub API | `{ baseUrl, credentials }`. Don't ship credentials in an app; point `baseUrl` at your own backend instead. |
| `engineOptions` | | `defaultPolicyVersion`, `defaultScope`, `globals`, `lenientScopeSearch`, `schemaEnforcement`, `strictEvaluation`. |
| `refreshIntervalSeconds` | `300` | How often to check Hub for a newer bundle. `0` disables. |
| `requestTimeout` | `10000` | Milliseconds before a request rejects. |
| `onDecision` | | Receives each decision log entry (`timestamp` is an ISO string). |
| `onValidationError` | | Receives schema validation errors. |
| `onUpdateError` | | Called when a check for a newer bundle fails. |
| `decodeJWTPayload` | | Verify a JWT from `auxData.jwt` and return its claims. Required to use `auxData.jwt`. |

## How it works

React Native has no WebAssembly runtime, so the engine runs in a hidden WebView, as an [Expo DOM component](https://docs.expo.dev/guides/dom-components/).

```
useCerbos().checkResources()
  → CerbosProvider      queues requests made in the same tick
  → one injected call   ref.evaluate([...])           (no React re-render)
  → WebView             @cerbos/embedded-client + server.wasm
  → one message back    handleResults([...])
```

- **Startup.** The engine (`server.wasm`, ~20 MB) is bundled with the app and checked against the SDK's SHA-256. A cached bundle starts the PDP immediately. Hub is then checked for a newer one.
- **Updates.** Hub is polled every `refreshIntervalSeconds`. A new bundle is only cached after the engine has loaded it, so a bad download never replaces a working bundle.
- **Offline.** With no cache and no network, the download retries with backoff (2 s to 60 s) and again as soon as the device comes back online.
- **Restarts.** If the OS kills the WebView, it reloads and `status` goes back to `loading` until the bundle is active again.

### Latency

Batch what a screen needs into one `checkResources` call where you can. Calls made in the same tick are sent together anyway, so rendering a list of components that each call `isAllowed` costs one round trip, not one per item.

To measure decision latency (from calling the method to the promise resolving), tap **Run benchmark** on the ePDP tab, or set `EXPO_PUBLIC_CERBOS_BENCH=1` to run it at startup and log the result.

## Security

- Decisions made on a device can be bypassed by a modified app, and the app supplies the principal's attributes. Use the ePDP to drive the UI and to work offline, and enforce the same policies on your backend.
- The WebView can only load the bundled DOM component (plus the Metro dev server in development). Pop-ups, new windows and link previews are disabled.
- Request contents and decision logs are only logged in development builds.

## Development

```sh
npm run typecheck
npm run lint
npm run test:ci        # `npm test` watches
```

The `dom` Jest project runs the DOM component itself on the web platform. CI also exports the iOS and Android bundles, which include the DOM component and the engine.

Everything under [`components/demo/`](components/demo/) is only for the demo app: runtime reconfiguration, the audit log and the benchmark.

To upgrade Cerbos, bump `@cerbos/embedded-client` and `@cerbos/embedded-server` together. Renovate groups them. Because the engine is part of the JS bundle, an [EAS Update](https://docs.expo.dev/eas-update/introduction/) can ship a new one without a store release.
