// Required by jest-expo's per-platform presets (used for the `native` and
// `dom` Jest projects); Expo's Metro config applies the same preset.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
