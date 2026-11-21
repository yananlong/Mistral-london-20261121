const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const moduleRoot = __dirname;
const forkRoot = path.resolve(moduleRoot, '../../../bitchat');
const destination = path.join(moduleRoot, 'ios', 'GeneratedSources');
const patchPath = path.join(moduleRoot, 'bitchat-fork.patch');
const patchedFiles = new Set([
  'bitchat/Services/BLE/BLEService.swift',
  'bitchat/Services/KeychainManager.swift',
  'bitchat/Protocols/NostrCarrierPacket.swift',
]);
const directories = [
  'bitchat/Services/BLE', 'bitchat/Services/Courier', 'bitchat/Services/Prekeys',
  'bitchat/Identity', 'bitchat/Noise', 'bitchat/Protocols', 'bitchat/Models',
  'bitchat/Sync', 'bitchat/Features/media', 'bitchat/Features/voice',
  'localPackages/BitFoundation/Sources/BitFoundation', 'localPackages/BitLogger/Sources',
];
const files = [
  'bitchat/Services/Gateway/BoundedIDSet.swift', 'bitchat/Services/Board/BoardStore.swift',
  ...[
    'Transport', 'MeshTransportCapabilities', 'TransportConfig', 'MessageRouter',
    'TransferProgressManager', 'RelayController', 'NotificationStreamAssembler',
    'NoiseEncryptionService', 'KeychainManager', 'FavoritesPersistenceService',
    'VerificationService', 'MeshTopologyTracker', 'MeshEchoSettings',
  ].map((name) => `bitchat/Services/${name}.swift`),
  ...['InputValidator', 'MessageDeduplicator', 'PeerDisplayNameResolver', 'String+Nickname', 'NicknameLookup', 'String+DJB2']
    .map((name) => `bitchat/Utils/${name}.swift`),
];

function prepareSources() {
  if (!fs.existsSync(path.join(forkRoot, 'bitchat/Services/BLE/BLEService.swift'))) {
    throw new Error('BitChat fork is missing. Run git submodule update --init bitchat at the repository root.');
  }
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });

  function addFile(relative) {
    const source = path.join(forkRoot, relative);
    const target = path.join(temporary, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (patchedFiles.has(relative)) {
      fs.copyFileSync(source, target);
    } else {
      // Temporary and final roots have the same parent/depth, so the link remains valid after rename.
      fs.symlinkSync(path.relative(path.dirname(target), source), target);
    }
  }

  function addDirectory(relative) {
    const source = path.join(forkRoot, relative);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) addDirectory(child);
      else if (entry.isFile() && entry.name.endsWith('.swift')) addFile(child);
    }
  }

  try {
    for (const directory of directories) addDirectory(directory);
    for (const file of files) addFile(file);
    execFileSync('patch', ['--batch', '--forward', '-p1', '-i', patchPath], { cwd: temporary, stdio: 'pipe' });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw new Error(`Could not prepare the pinned BitChat sources: ${error.message}`);
  }
}

module.exports = prepareSources;
if (require.main === module) prepareSources();
