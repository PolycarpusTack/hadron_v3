import path from 'path'
import os from 'os'

const SYSTEM_PATHS = [
  '/etc', '/sys', '/proc', '/root',
  'C:\\Windows', 'C:\\System32',
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.azure'),
]

// Also include USERPROFILE-based paths on Windows when available
const EXTRA: string[] = []
if (process.env.USERPROFILE) {
  EXTRA.push(
    path.join(process.env.USERPROFILE, '.ssh'),
    path.join(process.env.USERPROFILE, '.gnupg'),
    path.join(process.env.USERPROFILE, '.aws'),
    path.join(process.env.USERPROFILE, '.azure'),
  )
}

const ALL_BLOCKED = [...SYSTEM_PATHS, ...EXTRA].filter(Boolean)

export function isSystemPath(p: unknown): boolean {
  if (!p || typeof p !== 'string') return false
  const normalized = path.resolve(p)
  // Also check the raw input for Windows-style paths (e.g. C:\Windows) which
  // path.resolve() mangles on Linux/macOS.
  const raw = p
  return ALL_BLOCKED.some(d => {
    // Resolved comparison (works for POSIX paths and Windows when running on Windows)
    if (normalized === d || normalized.startsWith(d + path.sep)) return true
    // Raw case-insensitive comparison for Windows-style paths on any OS
    const dl = d.toLowerCase()
    const rl = raw.toLowerCase()
    const sep = d.includes('\\') ? '\\' : '/'
    return rl === dl || rl.startsWith(dl + sep)
  })
}
