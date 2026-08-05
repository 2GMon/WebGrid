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

  const [selector, setSelector] = useState(cell.selector ?? '')
  useEffect(() => setSelector(cell.selector ?? ''), [cell.id, cell.selector])

  // Typing a selector is only ever done to display that element, so committing one
  // switches the cell into element mode — and clearing it switches back.
  const commitSelector = () => {
    const next = selector.trim()
    if (next === (cell.selector ?? '')) return
    if (next) onPatch({ selector: next, mode: 'element' })
    else onPatch({ selector: null, mode: cell.mode === 'element' ? 'page' : cell.mode })
  }

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
      <label>
        Selector
        <form onSubmit={(e) => { e.preventDefault(); commitSelector() }}>
          <input
            value={selector}
            placeholder="CSS selector or XPath"
            spellCheck={false}
            onChange={(e) => setSelector(e.target.value)}
            onBlur={commitSelector}
          />
        </form>
      </label>
      <p className="hint">
        Filled in by the picker, and editable for elements it cannot reach. Anything
        starting with <code>/</code> or <code>(</code> is evaluated as XPath, everything
        else as a CSS selector.
        {cell.selector && (
          <button onClick={() => onPatch({ selector: null, mode: 'page' })}>clear</button>
        )}
      </p>

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
