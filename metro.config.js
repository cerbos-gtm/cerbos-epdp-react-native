// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle `@cerbos/embedded-server/server.wasm` as an asset the DOM component can fetch.
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
