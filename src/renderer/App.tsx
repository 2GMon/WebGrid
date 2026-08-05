import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { CellBounds, CellRuntime, Settings, Store, Workspace } from '@shared/types'
import { CellFrame } from './components/CellFrame'
import { Toolbar } from './components/Toolbar'
import { SettingsPanel } from './components/SettingsPanel'
import { CellInspector } from './components/CellInspector'
import {
  cellsLostBy,
  liveCells,
  newCell,
  newWorkspace,
  replaceCell,
  resizeGrid,
  swapCells,
  updateCell,
} from './state'

export function App() {
  const [store, setStore] = useState<Store | null>(null)
  const [runtimes, setRuntimes] = useState<Record<string, CellRuntime>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const gridRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())

  // --- load / persist ------------------------------------------------------

  useEffect(() => {
    void window.webgrid.loadStore().then((loaded) => {
      if (loaded.workspaces.length === 0) {
        const ws = newWorkspace()
        setStore({ ...loaded, workspaces: [ws], lastWorkspaceId: ws.id })
      } else {
        setStore({
          ...loaded,
          // `restoreOnStartup: false` (or --no-restore) keeps the saved workspaces but
          // opens the first one fresh instead of the last one used.
          lastWorkspaceId:
            loaded.settings.restoreOnStartup && loaded.lastWorkspaceId
              ? loaded.lastWorkspaceId
              : loaded.workspaces[0].id,
        })
      }
    })
  }, [])

  // Debounced so that dragging a slider does not write the file on every frame.
  useEffect(() => {
    if (!store) return
    const t = setTimeout(() => void window.webgrid.saveStore(store), 400)
    return () => clearTimeout(t)
  }, [store])

  useEffect(() => window.webgrid.onRuntime((list) => {
    setRuntimes(Object.fromEntries(list.map((r) => [r.id, r])))
  }), [])

  const workspace: Workspace | null = useMemo(() => {
    if (!store) return null
    return store.workspaces.find((w) => w.id === store.lastWorkspaceId) ?? store.workspaces[0] ?? null
  }, [store])

  const mutate = useCallback((fn: (ws: Workspace) => Workspace) => {
    setStore((prev) => {
      if (!prev) return prev
      const id = prev.lastWorkspaceId ?? prev.workspaces[0]?.id
      return {
        ...prev,
        workspaces: prev.workspaces.map((w) => (w.id === id ? fn(w) : w)),
      }
    })
  }, [])

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setStore((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev))
  }, [])

  // --- picker --------------------------------------------------------------

  useEffect(() => window.webgrid.onPicked(({ cellId, selector }) => {
    mutate((ws) => updateCell(ws, cellId, { selector, mode: 'element' }))
    setPickingId(null)
  }), [mutate])

  const togglePicker = useCallback((id: string) => {
    setPickingId((current) => {
      if (current === id) {
        window.webgrid.cancelPicker(id)
        return null
      }
      if (current) window.webgrid.cancelPicker(current)
      window.webgrid.startPicker(id)
      return id
    })
  }, [])

  // --- native view sync ----------------------------------------------------

  const cells = workspace ? liveCells(workspace) : []
  const cellsKey = JSON.stringify(cells)

  useEffect(() => {
    window.webgrid.syncCells(cells)
    // `cellsKey` is the stable identity of the cell set; `cells` itself is a new
    // array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsKey])

  /**
   * Pushes the measured position of every cell viewport to main, which mirrors them
   * onto the native views. The renderer draws only the frames; the pages themselves
   * are native views floating above this document.
   */
  const pushBounds = useCallback(() => {
    const bounds: CellBounds[] = []
    for (const [id, el] of cellRefs.current) {
      const r = el.getBoundingClientRect()
      bounds.push({
        id,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
      })
    }
    window.webgrid.setBounds(bounds)
  }, [])

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(pushBounds)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    if (gridRef.current) ro.observe(gridRef.current)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [
    pushBounds,
    cellsKey,
    selectedId, // opening a sidebar narrows the grid
    showSettings,
    workspace?.grid.rows,
    workspace?.grid.cols,
    workspace?.grid.gap,
  ])

  const registerCell = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cellRefs.current.set(id, el)
    else cellRefs.current.delete(id)
  }, [])

  // --- drag and drop -------------------------------------------------------

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const from = Number(event.active.id)
    const to = Number(event.over?.id)
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) return
    mutate((ws) => swapCells(ws, from, to))
  }, [mutate])

  // --- grid shape ----------------------------------------------------------

  const resize = useCallback((rows: number, cols: number) => {
    setStore((prev) => {
      if (!prev) return prev
      const id = prev.lastWorkspaceId ?? prev.workspaces[0]?.id
      const ws = prev.workspaces.find((w) => w.id === id)
      if (!ws) return prev
      const lost = cellsLostBy(ws, rows, cols)
      if (lost > 0 && !confirm(`Shrinking the grid removes ${lost} cell(s). Continue?`)) return prev
      return { ...prev, workspaces: prev.workspaces.map((w) => (w.id === id ? resizeGrid(w, rows, cols) : w)) }
    })
  }, [])

  if (!store || !workspace) return <div className="boot">Loading…</div>

  const selected = selectedId ? cells.find((c) => c.id === selectedId) ?? null : null

  return (
    <div className="app">
      <Toolbar
        workspace={workspace}
        workspaces={store.workspaces}
        onSelectWorkspace={(id) => setStore({ ...store, lastWorkspaceId: id })}
        onAddWorkspace={() => {
          const ws = newWorkspace(`Workspace ${store.workspaces.length + 1}`)
          setStore({ ...store, workspaces: [...store.workspaces, ws], lastWorkspaceId: ws.id })
        }}
        onRename={(name) => mutate((ws) => ({ ...ws, name }))}
        onResize={resize}
        // One sidebar, so settings and the cell inspector take turns.
        onOpenSettings={() => {
          setShowSettings((open) => !open)
          setSelectedId(null)
        }}
      />

      <div className="stage">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div
          ref={gridRef}
          className="grid"
          style={{
            gridTemplateRows: `repeat(${workspace.grid.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${workspace.grid.cols}, 1fr)`,
            gap: workspace.grid.gap,
          }}
        >
          {workspace.cells.map((cell, index) => (
            <CellFrame
              key={cell?.id ?? `empty-${index}`}
              index={index}
              cell={cell}
              runtime={cell ? runtimes[cell.id] ?? null : null}
              picking={pickingId === cell?.id}
              selected={selectedId === cell?.id}
              registerViewport={registerCell}
              onSelect={() => {
                setSelectedId(cell?.id ?? null)
                if (cell) setShowSettings(false)
              }}
              onCreate={(url) => mutate((ws) => replaceCell(ws, index, newCell({ url })))}
              onRemove={() => mutate((ws) => replaceCell(ws, index, null))}
              onTogglePicker={() => cell && togglePicker(cell.id)}
              onPatch={(patch) => cell && mutate((ws) => updateCell(ws, cell.id, patch))}
            />
          ))}
        </div>
      </DndContext>

        {showSettings ? (
          <SettingsPanel
            settings={store.settings}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        ) : (
          selected && (
            <CellInspector
              cell={selected}
              runtime={runtimes[selected.id] ?? null}
              onPatch={(patch) => mutate((ws) => updateCell(ws, selected.id, patch))}
              onClose={() => setSelectedId(null)}
            />
          )
        )}
      </div>
    </div>
  )
}
