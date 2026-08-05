import { session, type Session } from 'electron'

/**
 * Cells pick a partition so that sign-in state is scoped, not global.
 *
 * This matters for YouTube in particular: a Premium individual plan only allows one
 * concurrent stream, and separate browsers count as separate streams. Signed out,
 * there is no such cap. So the default partition for new cells is `persist:anon`
 * and signing in is opt-in per cell.
 */
export const DEFAULT_PARTITION = 'persist:anon'

const configured = new Set<string>()

export function getCellSession(partition: string): Session {
  const ses = session.fromPartition(partition)
  if (!configured.has(partition)) {
    configure(ses)
    configured.add(partition)
  }
  return ses
}

function configure(ses: Session) {
  // Sites gate features (and sometimes playback) on a plausible UA. Electron's default
  // advertises itself, so strip the app tokens and keep the Chrome identity.
  const ua = ses
    .getUserAgent()
    .replace(/ Electron\/[\d.]+/, '')
    .replace(/ webgrid\/[\d.]+/i, '')
  ses.setUserAgent(ua)

  // Deny everything a passive video wall has no business asking for. Cells load
  // arbitrary third-party pages, so this is the main containment boundary.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['fullscreen', 'background-sync']
    callback(allowed.includes(permission))
  })
}

/** Wipes cookies and storage for one partition, e.g. to sign out of a profile. */
export async function clearPartition(partition: string): Promise<void> {
  const ses = session.fromPartition(partition)
  await ses.clearStorageData()
  await ses.clearCache()
}
