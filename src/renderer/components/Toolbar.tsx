import type { Workspace } from '@shared/types'

type Props = {
  workspace: Workspace
  workspaces: Workspace[]
  onSelectWorkspace: (id: string) => void
  onAddWorkspace: () => void
  onRename: (name: string) => void
  onResize: (rows: number, cols: number) => void
  onOpenSettings: () => void
}

export function Toolbar({
  workspace,
  workspaces,
  onSelectWorkspace,
  onAddWorkspace,
  onRename,
  onResize,
  onOpenSettings,
}: Props) {
  const { rows, cols } = workspace.grid

  return (
    <div className="toolbar">
      {/* Drag region so the frameless title bar area still moves the window. */}
      <div className="drag-region" />

      <select value={workspace.id} onChange={(e) => onSelectWorkspace(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <button onClick={onAddWorkspace} title="New workspace">
        +
      </button>

      <input
        className="ws-name"
        value={workspace.name}
        onChange={(e) => onRename(e.target.value)}
      />

      <div className="spacer" />

      <div className="stepper">
        <span>rows</span>
        <button onClick={() => onResize(Math.max(1, rows - 1), cols)}>−</button>
        <b>{rows}</b>
        <button onClick={() => onResize(Math.min(12, rows + 1), cols)}>+</button>
      </div>
      <div className="stepper">
        <span>cols</span>
        <button onClick={() => onResize(rows, Math.max(1, cols - 1))}>−</button>
        <b>{cols}</b>
        <button onClick={() => onResize(rows, Math.min(12, cols + 1))}>+</button>
      </div>

      <button onClick={onOpenSettings} title="Settings">
        ⚙
      </button>
    </div>
  )
}
