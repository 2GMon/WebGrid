import { app } from 'electron'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { StoreSchema, type Store } from '@shared/types'

const FILE = () => join(app.getPath('userData'), 'webgrid.json')

const EMPTY: Store = StoreSchema.parse({})

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
  if (parsed.success) return parsed.data

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
