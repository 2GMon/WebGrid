import { session, type Session } from 'electron'

/**
 * Cells pick a session so that sign-in state is scoped, not global. New cells start
 * on the default session, and the user adds more to keep profiles apart.
 *
 * Worth knowing when deciding where to sign in: a YouTube Premium individual plan
 * allows only one concurrent stream, and a second signed-in cell counts as a second
 * stream. Signed out there is no such cap, so a wall of YouTube cells is best left on
 * a session that was never signed in.
 */

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
