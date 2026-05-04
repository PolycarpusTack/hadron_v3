const config = {
  appId: 'com.hadron.electron',
  productName: 'Hadron',
  copyright: 'Copyright © 2026 Hadron Team',
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: [
    'out/**/*',
    'resources/**/*',
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
    artifactName: 'hadron-electron-setup-${version}.exe',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Hadron',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'resources/icon.icns',
    category: 'public.app-category.developer-tools',
    artifactName: 'hadron-electron-${version}.dmg',
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: 'resources/icon.png',
    category: 'Development',
    artifactName: 'hadron-electron-${version}.AppImage',
  },
  publish: null,
  asar: true,
  asarUnpack: [
    '**/node_modules/better-sqlite3/**',
    '**/node_modules/keytar/**',
  ],
}

module.exports = config
