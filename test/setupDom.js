// jsdom does not provide the encoding API, which @bufbuild/protobuf needs to
// decode message descriptors when @cerbos/core is imported.
const { TextDecoder, TextEncoder } = require("node:util");

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder;
}
