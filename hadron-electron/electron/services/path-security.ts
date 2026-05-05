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
  )
}

const ALL_BLOCKED = [...SYSTEM_PATHS, ...EXTRA].filter(Boolean)

export function isSystemPath(p: unknown): boolean {
  if (!p || typeof p !== 'string') return false
  const normalized = path.resolve(p)
  return ALL_BLOCKED.some(d => normalized === d || normalized.startsWith(d + path.sep))
}
