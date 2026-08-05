import { useEffect, useState } from 'react'
import type { Cell, CellRuntime } from '@shared/types'
import { PARTITIONS } from '../state'

type Props = {
  cell: Cell
  runtime: CellRuntime | null
  onPatch: (patch: Partial<Cell>) => void
  onClose: () => void
}

/** Per-cell settings. Docked to the side so it never overlaps a native view. */
export function CellInspector({ cell, runtime, onPatch, onClose }: Props) {
  const [url, setUrl] = useState(cell.url)
  useEffect(() => setUrl(cell.url), [cell.id, cell.url])

  return (
    <aside className="sidebar">
      <header>
        <b>Cell</b>
        <button onClick={onClose}>✕</button>
      </header>

      <label>
        URL
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onPatch({ url })
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </form>
      </label>

      <label>
        Title
        <input value={cell.title} onChange={(e) => onPatch({ title: e.target.value })} />
      </label>

      <label>
        Display
        <select value={cell.mode} onChange={(e) => onPatch({ mode: e.target.value as Cell['mode'] })}>
          <option value="page">Whole page</option>
          <option value="video">First video element</option>
          <option value="element" disabled={!cell.selector}>
            Picked element
          </option>
        </select>
      </label>
      {cell.selector && (
        <p className="hint">
          <code>{cell.selector}</code>
          <button onClick={() => onPatch({ selector: null, mode: 'page' })}>clear</button>
        </p>
      )}

      <label>
        Session
        <select value={cell.partition} onChange={(e) => onPatch({ partition: e.target.value })}>
          {PARTITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Changing the session reloads the cell, since a session is fixed for the life of a view.</p>

      <label>
        Zoom
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.05}
          value={cell.zoomFactor}
          onChange={(e) => onPatch({ zoomFactor: Number(e.target.value) })}
        />
        <span>{cell.zoomFactor.toFixed(2)}×</span>
      </label>
      <p className="hint">
        Zooming out shrinks the player, which usually makes adaptive streaming pick a lower
        rendition. It is the only reliable way to reduce a stream's decode cost from outside the
        page.
      </p>

      <label>
        Auto-reload (seconds, 0 = off)
        <input
          type="number"
          min={0}
          value={cell.refreshSec}
          onChange={(e) => onPatch({ refreshSec: Number(e.target.value) })}
        />
      </label>

      <label className="row">
        <input
          type="checkbox"
          checked={cell.pinned}
          onChange={(e) => onPatch({ pinned: e.target.checked })}
        />
        Never suspend this cell
      </label>

      <label className="row">
        <input
          type="checkbox"
          checked={cell.forceHeavy}
          onChange={(e) => onPatch({ forceHeavy: e.target.checked })}
        />
        Count as video
      </label>
      <p className="hint">
        For MJPEG cameras and canvas-based players, which do not use a video element and so are not
        detected automatically.
      </p>

      {runtime?.error && <p className="error">{runtime.error}</p>}

      <button onClick={() => window.webgrid.openDevTools(cell.id)}>Open DevTools</button>
    </aside>
  )
}
