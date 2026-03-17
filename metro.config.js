const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const config = {
	projectRoot,
	watchFolders: [projectRoot, path.resolve(projectRoot, 'node_modules')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
