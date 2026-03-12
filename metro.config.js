const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /\.local\/.*/,
  ...(config.resolver.blockList ? [config.resolver.blockList].flat() : []),
];

module.exports = config;
