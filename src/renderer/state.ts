import { nanoid } from 'nanoid'
import { CellSchema, WorkspaceSchema, type Cell, type Workspace } from '@shared/types'

export function newCell(partial: Partial<Cell> = {}): Cell {
  return CellSchema.parse({ id: nanoid(10), url: '', selector: null, ...partial })
}

export function newWorkspace(name = 'Workspace 1'): Workspace {
  const ws = WorkspaceSchema.parse({ id: nanoid(10), name })
  return { ...ws, cells: Array(ws.grid.rows * ws.grid.cols).fill(null) }
}

/**
 * Resizes the grid while keeping every cell at its (row, col). Cells that fall
 * outside the new shape are dropped, which is why the UI confirms before shrinking
 * onto occupied slots.
 */
export function resizeGrid(ws: Workspace, rows: number, cols: number): Workspace {
  const next: (Cell | null)[] = Array(rows * cols).fill(null)
  for (let r = 0; r < Math.min(rows, ws.grid.rows); r++) {
    for (let c = 0; c < Math.min(cols, ws.grid.cols); c++) {
      next[r * cols + c] = ws.cells[r * ws.grid.cols + c] ?? null
    }
  }
  return { ...ws, grid: { ...ws.grid, rows, cols }, cells: next }
}

/** Counts cells that would be lost by shrinking to the given shape. */
export function cellsLostBy(ws: Workspace, rows: number, cols: number): number {
  let lost = 0
  for (let r = 0; r < ws.grid.rows; r++) {
    for (let c = 0; c < ws.grid.cols; c++) {
      if ((r >= rows || c >= cols) && ws.cells[r * ws.grid.cols + c]) lost++
    }
  }
  return lost
}

/** Drag-and-drop reordering is a swap, so dropping onto an occupied slot is lossless. */
export function swapCells(ws: Workspace, from: number, to: number): Workspace {
  const cells = [...ws.cells]
  ;[cells[from], cells[to]] = [cells[to], cells[from]]
  return { ...ws, cells }
}

export function replaceCell(ws: Workspace, index: number, cell: Cell | null): Workspace {
  const cells = [...ws.cells]
  cells[index] = cell
  return { ...ws, cells }
}

export function updateCell(ws: Workspace, id: string, patch: Partial<Cell>): Workspace {
  return {
    ...ws,
    cells: ws.cells.map((c) => (c && c.id === id ? { ...c, ...patch } : c)),
  }
}

export const liveCells = (ws: Workspace): Cell[] => ws.cells.filter((c): c is Cell => c !== null)

/** Presets offered in the partition dropdown. */
export const PARTITIONS = [
  { value: 'persist:anon', label: 'Signed out (recommended for YouTube)' },
  { value: 'persist:default', label: 'Default profile' },
  { value: 'persist:work', label: 'Work profile' },
  { value: 'persist:alt', label: 'Alt profile' },
]
