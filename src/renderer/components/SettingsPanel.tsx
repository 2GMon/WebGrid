import { useState } from 'react'
import { DEFAULT_SESSION_ID, partitionFor, type Settings, type SessionProfile } from '@shared/types'

type Props = {
  settings: Settings
  sessions: SessionProfile[]
  /** Cells per session id, across every workspace. */
  usage: Record<string, number>
  onChange: (patch: Partial<Settings>) => void
  onAddSession: () => void
  onRenameSession: (id: string, name: string) => void
  onDeleteSession: (id: string) => void
  onClose: () => void
}

/**
 * App settings. Docked as a sidebar rather than a centred dialog: native cell views
 * always paint above the renderer, so anything that overlaps the grid would be
 * hidden behind them. Taking up a layout column instead keeps the cells running.
 */
export function SettingsPanel({
  settings,
  sessions,
  usage,
  onChange,
  onAddSession,
  onRenameSession,
  onDeleteSession,
  onClose,
}: Props) {
  const [clearing, setClearing] = useState<string | null>(null)

  return (
    <aside className="sidebar">
      <header>
        <b>Settings</b>
        <button onClick={onClose}>✕</button>
      </header>

      <label className="row">
        <input
          type="checkbox"
          checked={settings.restoreOnStartup}
          onChange={(e) => onChange({ restoreOnStartup: e.target.checked })}
        />
        Restore the last workspace on startup
      </label>
      <p className="hint">
        Start with <code>--no-restore</code> to skip this once without changing the setting.
      </p>

      <label className="row">
        <input
          type="checkbox"
          checked={settings.lowPowerMode}
          onChange={(e) => onChange({ lowPowerMode: e.target.checked })}
        />
        Suspend cells that are not visible
      </label>
      <p className="hint">
        Detaches the view so it stops compositing and decoding. The page stays loaded and signed
        in, so resuming is instant.
      </p>

      <label>
        Max cells decoding video at once
        <input
          type="number"
          min={0}
          max={32}
          value={settings.maxConcurrentVideo}
          onChange={(e) => onChange({ maxConcurrentVideo: Number(e.target.value) })}
        />
      </label>
      <p className="hint">
        Chromium has a limited number of hardware decoder sessions. Past that limit every stream
        falls back to software decoding at once, so it is better to suspend the extras. 0 disables
        the cap.
      </p>

      <h3>Sessions</h3>
      <p className="hint">
        Each cell picks a session, so one cell can stay signed out while another uses a signed-in
        profile. Keep YouTube cells on a session you never signed in to: a Premium individual plan
        allows only one concurrent stream.
      </p>
      <ul className="partitions">
        {sessions.map((s) => {
          const partition = partitionFor(s.id)
          const cells = usage[s.id] ?? 0
          return (
            <li key={s.id}>
              {/* Renaming only rewrites the label; the partition below keeps its cookies. */}
              <input
                className="session-name"
                value={s.name}
                aria-label={`Name of session ${s.name}`}
                onChange={(e) => onRenameSession(s.id, e.target.value)}
                onBlur={(e) => !e.target.value.trim() && onRenameSession(s.id, 'Session')}
              />
              <span className="count">{cells === 1 ? '1 cell' : `${cells} cells`}</span>
              <button
                title={`Sign out and clear all data for ${partition}`}
                onClick={async () => {
                  if (!confirm(`Sign out and clear all data for "${s.name}"?`)) return
                  setClearing(s.id)
                  await window.webgrid.clearSession(partition)
                  setClearing(null)
                }}
              >
                {clearing === s.id ? 'Clearing…' : 'Clear'}
              </button>
              <button
                // The default is where deleted sessions' cells land, so it has to stay.
                disabled={s.id === DEFAULT_SESSION_ID}
                title={
                  s.id === DEFAULT_SESSION_ID
                    ? 'The default session cannot be deleted'
                    : 'Delete this session and erase its data'
                }
                onClick={() => onDeleteSession(s.id)}
              >
                Delete
              </button>
            </li>
          )
        })}
      </ul>
      <button onClick={onAddSession}>Add session</button>
      <p className="hint">
        Renaming a session keeps it signed in — the name is only a label. Deleting one erases its
        cookies and storage for good and moves its cells to the default session.
      </p>
    </aside>
  )
}
