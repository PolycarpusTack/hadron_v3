import path from 'path'
import Store from 'electron-store'
import log from 'electron-log'

// '_system' is a renderer-write-blocked store (see settings.ts isRendererWritable).
const STORE_NAME = '_system'
const STORE_KEY = 'allowed_export_dir'

// Exact file paths authorised by saveFile dialogs this session.
const allowedExactPaths = new Set<string>()

// Directories authorised by openFile(directory) dialogs.
// Writes to any file directly inside these directories are permitted.
const allowedDirectories = new Set<string>()

export function allowExactPath(p: string): void {
  if (p) allowedExactPaths.add(path.resolve(p))
}

export function allowDirectory(p: string): void {
  if (!p) return
  const resolved = path.resolve(p)
  allowedDirectories.add(resolved)
  // Persist so the next session can pre-authorise the same directory.
  try {
    new Store({ name: STORE_NAME }).set(STORE_KEY, resolved)
  } catch (err) {
    log.warn('dialogAllowlist: failed to persist export dir', err)
  }
}

/** Call once at startup to re-authorise the user's previously chosen export directory. */
export function preloadSavedExportDir(): void {
  try {
    const saved = new Store({ name: STORE_NAME }).get(STORE_KEY) as string | undefined
    if (saved) allowedDirectories.add(path.resolve(saved))
  } catch (err) {
    log.warn('dialogAllowlist: failed to load saved export dir', err)
  }
}

export function isWriteAllowed(p: string): boolean {
  const resolved = path.resolve(p)
  if (allowedExactPaths.has(resolved)) return true
  return [...allowedDirectories].some(
    dir => resolved.startsWith(dir + path.sep) || resolved === dir
  )
}
