const { withDangerousMod, withInfoPlist } = require('@expo/config-plugins');
const prepareSources = require('./prepare-sources');

module.exports = function withBitchatMesh(config) {
  config = withInfoPlist(config, (mod) => {
    const info = mod.modResults;
    info.NSBluetoothAlwaysUsageDescription ||= 'Bluetooth connects you to the nearby offline mesh.';
    info.NSBluetoothPeripheralUsageDescription ||= 'Bluetooth lets nearby mesh peers find and message you.';
    info.UIBackgroundModes = Array.from(new Set([
      ...(info.UIBackgroundModes || []),
      'bluetooth-central',
      'bluetooth-peripheral',
    ]));
    return mod;
  });
  return withDangerousMod(config, ['ios', async (mod) => {
    prepareSources();
    return mod;
  }]);
};
