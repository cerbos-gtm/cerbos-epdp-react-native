// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The embedded Cerbos PDP is a WebAssembly module (`@cerbos/embedded-server/server.wasm`).
// Treat `.wasm` files as assets so the DOM component can `require()` it and fetch it at runtime.
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
