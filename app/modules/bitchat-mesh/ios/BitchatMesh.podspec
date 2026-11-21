Pod::Spec.new do |s|
  s.name = 'BitchatMesh'
  s.version = '0.1.0'
  s.summary = 'Expo interface to the BitChat Bluetooth mesh'
  s.homepage = 'https://github.com/cole-dorrestein/bitchat'
  s.license = { :type => 'Unlicense' }
  s.author = 'BitChat contributors'
  s.source = { :git => 'https://github.com/cole-dorrestein/bitchat.git', :commit => '04995f68e470a18d1fc99f86fa326c2a87bab4f2' }
  s.platform = :ios, '16.0'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.dependency 'BitFoundation'
  s.dependency 'BitLogger'
  s.frameworks = 'CoreBluetooth', 'CryptoKit', 'Security', 'Combine', 'UIKit', 'AVFoundation', 'UniformTypeIdentifiers', 'ImageIO'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) BITCHAT_MESH_EXPO'
  }

  fork = 'GeneratedSources/bitchat'
  s.source_files = [
    '*.swift',
    "#{fork}/Services/BLE/*.swift", "#{fork}/Services/Courier/*.swift", "#{fork}/Services/Prekeys/*.swift",
    "#{fork}/Services/Gateway/BoundedIDSet.swift", "#{fork}/Services/Board/BoardStore.swift",
    "#{fork}/Services/Transport.swift", "#{fork}/Services/MeshTransportCapabilities.swift", "#{fork}/Services/TransportConfig.swift",
    "#{fork}/Services/MessageRouter.swift", "#{fork}/Services/TransferProgressManager.swift", "#{fork}/Services/RelayController.swift",
    "#{fork}/Services/NotificationStreamAssembler.swift", "#{fork}/Services/NoiseEncryptionService.swift", "#{fork}/Services/KeychainManager.swift",
    "#{fork}/Services/FavoritesPersistenceService.swift", "#{fork}/Services/VerificationService.swift", "#{fork}/Services/MeshTopologyTracker.swift",
    "#{fork}/Services/MeshEchoSettings.swift", "#{fork}/Identity/*.swift", "#{fork}/Noise/*.swift", "#{fork}/Protocols/*.swift",
    "#{fork}/Models/*.swift", "#{fork}/Sync/*.swift", "#{fork}/Utils/InputValidator.swift", "#{fork}/Utils/MessageDeduplicator.swift",
    "#{fork}/Utils/PeerDisplayNameResolver.swift", "#{fork}/Utils/String+Nickname.swift", "#{fork}/Utils/NicknameLookup.swift",
    "#{fork}/Utils/String+DJB2.swift", "#{fork}/Features/media/**/*.swift", "#{fork}/Features/voice/**/*.swift"
  ]
end
