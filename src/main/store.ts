import { app } from 'electron'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SESSION_ID, StoreSchema, sessionIdOf, type Store } from '@shared/types'

const FILE = () => join(app.getPath('userData'), 'webgrid.json')

const EMPTY: Store = StoreSchema.parse({})

/**
 * Restores the two invariants the session UI depends on: the default session exists,
 * and every partition a cell points at is named by some session.
 *
 * Stores written before sessions were editable have no session list at all, while
 * their cells already sit on `persist:anon` and the other old presets. Those are
 * adopted under their own id rather than collapsed into the default, so a cell that
 * was signed in to one of them keeps both its cookies and a way to select it.
 */
function reconcileSessions(store: Store): Store {
  // A name left blank in the rename field would otherwise show as an empty dropdown row.
  let changed = store.sessions.some((s) => !s.name.trim())
  const sessions = store.sessions.map((s) => (s.name.trim() ? s : { ...s, name: 'Session' }))
  const has = (id: string) => sessions.some((s) => s.id === id)

  if (!has(DEFAULT_SESSION_ID)) {
    sessions.unshift({ id: DEFAULT_SESSION_ID, name: 'Default' })
    changed = true
  }
  for (const ws of store.workspaces) {
    for (const cell of ws.cells) {
      if (!cell) continue
      const id = sessionIdOf(cell.partition)
      if (has(id)) continue
      sessions.push({ id, name: id.charAt(0).toUpperCase() + id.slice(1) })
      changed = true
    }
  }

  return changed ? { ...store, sessions } : store
}

/**
 * Reads the persisted store. A corrupt or outdated file must never prevent the app
 * from starting, so any failure falls back to defaults and the bad file is kept
 * on disk (renamed) for the user to inspect.
 */
export async function loadStore(): Promise<Store> {
  const path = FILE()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return EMPTY
  }
  const parsed = StoreSchema.safeParse(JSON.parse(raw))
  if (parsed.success) return reconcileSessions(parsed.data)

  console.error('[store] invalid store file, starting fresh:', parsed.error.message)
  await rename(path, `${path}.corrupt`).catch(() => {})
  return EMPTY
}

let writeQueue: Promise<void> = Promise.resolve()

/** Serialises writes so overlapping saves cannot interleave into a truncated file. */
export function saveStore(store: Store): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const path = FILE()
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
    await rename(tmp, path)
  })
  return writeQueue
}
