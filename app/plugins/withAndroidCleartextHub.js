// Dev hub link: the Android app talks plain HTTP to the hub at 127.0.0.1 (adb reverse)
// or 10.0.2.2 (emulator). Android blocks cleartext by default in release builds,
// so allow it on the <application> element. Applied at `expo prebuild` / `expo run:android`.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAndroidCleartextHub(config) {
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
