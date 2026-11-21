// Copies bitchat-android's Kotlin sources into android/src/bitchat/java so the Android mesh adapter compiles.
// bitchat-android is GPL-3.0 (unlike iOS bitchat, which is Unlicense): we do NOT commit these sources.
// Usage: node prepare-sources-android.js /path/to/bitchat-android
// The closure of BluetoothMeshService reaches into ui/, nostr/, geohash/, services/, wifi-aware/, Tor (Arti JNI)...,
// so this copies the whole com/bitchat/android tree minus the Activity/Compose UI entry points. Expect to
// trim/stub further until it compiles (see README "Android").
const fs = require('node:fs');
const path = require('node:path');

const src = process.argv[2];
if (!src) { console.error('usage: node prepare-sources-android.js /path/to/bitchat-android'); process.exit(1); }
const from = path.join(src, 'app/src/main/java');
const dest = path.join(__dirname, 'android/src/bitchat/java');
const exclude = [/MainActivity\.kt$/, /BitchatApplication\.kt$/, /\/ui\/theme\//, /\/onboarding\//];

fs.rmSync(dest, { recursive: true, force: true });
let n = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (!/\.(kt|java)$/.test(entry.name) || exclude.some(re => re.test(p))) continue;
    const out = path.join(dest, path.relative(from, p));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(p, out);
    n += 1;
  }
})(from);
console.log(`copied ${n} files into ${dest}`);
