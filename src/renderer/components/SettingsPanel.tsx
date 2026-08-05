import { useState } from 'react'
import type { Settings } from '@shared/types'
import { PARTITIONS } from '../state'

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

/**
 * App settings. Docked as a sidebar rather than a centred dialog: native cell views
 * always paint above the renderer, so anything that overlaps the grid would be
 * hidden behind them. Taking up a layout column instead keeps the cells running.
 */
export function SettingsPanel({ settings, onChange, onClose }: Props) {
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
        Each cell picks a partition, so one cell can stay signed out while another uses a signed-in
        profile. Keep YouTube cells signed out: a Premium individual plan allows only one concurrent
        stream.
      </p>
      <ul className="partitions">
        {PARTITIONS.map((p) => (
          <li key={p.value}>
            <code>{p.value}</code>
            <button
              onClick={async () => {
                if (!confirm(`Sign out and clear all data for ${p.value}?`)) return
                setClearing(p.value)
                await window.webgrid.clearSession(p.value)
                setClearing(null)
              }}
            >
              {clearing === p.value ? 'Clearing…' : 'Clear'}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
