const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /\.local\/.*/,
  ...(config.resolver.blockList ? [config.resolver.blockList].flat() : []),
];

// expo-av is deprecated in SDK 54 and its Video.types module fails to resolve
// on web. Intercept that specific request and return the actual file path.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === './Video.types' &&
    context.originModulePath &&
    context.originModulePath.includes('expo-av')
  ) {
    return {
      filePath: path.resolve(__dirname, 'node_modules/expo-av/build/Video.types.js'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
