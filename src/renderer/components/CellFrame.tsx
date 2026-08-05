import { useEffect, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Cell, CellRuntime } from '@shared/types'

type Props = {
  index: number
  cell: Cell | null
  runtime: CellRuntime | null
  picking: boolean
  selected: boolean
  registerViewport: (id: string, el: HTMLElement | null) => void
  onSelect: () => void
  onCreate: (url: string) => void
  onRemove: () => void
  onTogglePicker: () => void
  onPatch: (patch: Partial<Cell>) => void
}

/**
 * One grid slot. The frame draws a header and a hole; the page itself is a native
 * view that main positions over the hole. Anything the user needs to click has to
 * live in the header, because the native view always paints above this document.
 */
export function CellFrame(props: Props) {
  const { index, cell, runtime, picking, selected } = props
  const viewportRef = useRef<HTMLDivElement>(null)

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: index })
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: index,
    disabled: !cell,
  })

  useEffect(() => {
    if (!cell) return
    props.registerViewport(cell.id, viewportRef.current)
    return () => props.registerViewport(cell.id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell?.id])

  if (!cell) return <EmptySlot setDropRef={setDropRef} isOver={isOver} onCreate={props.onCreate} />

  const host = safeHost(cell.url)
  const stats = runtime?.stats

  return (
    <div
      ref={setDropRef}
      className={['cell', selected && 'is-selected', isOver && 'is-over', isDragging && 'is-dragging']
        .filter(Boolean)
        .join(' ')}
      onMouseDown={props.onSelect}
    >
      <header className="cell-head" ref={setDragRef} {...attributes} {...listeners}>
        <span className="grip" aria-hidden>⠿</span>
        <span className="cell-title" title={cell.url}>
          {cell.title || host}
        </span>

        <span className="badges">
          {runtime?.loading && <span className="badge">…</span>}
          {runtime?.error && <span className="badge is-error" title={runtime.error}>!</span>}
          {runtime?.suspended && <span className="badge is-warn" title="Suspended to stay within the decode budget">zZ</span>}
          {cell.mode === 'element' && <span className="badge" title={cell.selector ?? ''}>elem</span>}
          {stats && (
            <span className="badge is-dim" title={`${stats.droppedFrames} dropped frames`}>
              {stats.height}p{stats.fps ? `·${stats.fps}fps` : ''}
            </span>
          )}
        </span>

        <span className="cell-actions">
          <button
            className={picking ? 'is-active' : ''}
            title="Pick an element to display (Esc to cancel)"
            onClick={props.onTogglePicker}
          >
            ⊹
          </button>
          <button
            title={cell.muted ? 'Unmute' : 'Mute'}
            onClick={() => props.onPatch({ muted: !cell.muted })}
          >
            {cell.muted ? '🔇' : '🔊'}
          </button>
          <button title="Reload" onClick={() => window.webgrid.reload(cell.id)}>
            ↻
          </button>
          <button title="Remove" onClick={props.onRemove}>
            ✕
          </button>
        </span>
      </header>

      <div className="cell-viewport" ref={viewportRef}>
        {/* Only rendered while the native view is detached, so it is never covered. */}
        {runtime?.suspended && (
          <div className="suspended">
            {runtime.snapshot && <img src={runtime.snapshot} alt="" />}
            <button onClick={() => window.webgrid.resume(cell.id)}>Resume</button>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptySlot({
  setDropRef,
  isOver,
  onCreate,
}: {
  setDropRef: (el: HTMLElement | null) => void
  isOver: boolean
  onCreate: (url: string) => void
}) {
  const [url, setUrl] = useState('')
  return (
    <div ref={setDropRef} className={`cell is-empty ${isOver ? 'is-over' : ''}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const normalised = /^https?:\/\//.test(url) ? url : `https://${url}`
          if (url.trim()) onCreate(normalised)
        }}
      >
        <input
          value={url}
          placeholder="Paste a URL…"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url || 'empty'
  }
}
