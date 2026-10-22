const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  '@vfm/form-engine': path.resolve(workspaceRoot, 'packages/form-engine/src'),
  '@vfm/form-renderer': path.resolve(workspaceRoot, 'packages/form-renderer/src'),
  '@vfm/shared': path.resolve(workspaceRoot, 'packages/shared/src'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (!moduleName.endsWith('.js')) throw error;
    return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
  }
};

module.exports = config;
