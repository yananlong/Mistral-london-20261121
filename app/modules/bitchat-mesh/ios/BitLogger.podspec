Pod::Spec.new do |s|
  s.name = 'BitLogger'
  s.version = '0.1.0'
  s.summary = 'BitChat logging package'
  s.homepage = 'https://github.com/cole-dorrestein/bitchat'
  s.license = { :type => 'Unlicense' }
  s.author = 'BitChat contributors'
  s.source = { :git => 'https://github.com/cole-dorrestein/bitchat.git', :commit => '04995f68e470a18d1fc99f86fa326c2a87bab4f2' }
  s.platform = :ios, '16.0'
  s.swift_version = '5.9'
  s.source_files = 'GeneratedSources/localPackages/BitLogger/Sources/**/*.swift'
end
