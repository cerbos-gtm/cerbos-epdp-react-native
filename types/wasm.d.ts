// `.wasm` files are registered as Metro assets (see metro.config.js). In DOM
// components (bundled for the web) an asset import resolves to its URL.
declare module "*.wasm" {
  const uri: string;
  export default uri;
}
