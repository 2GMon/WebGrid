import { contextBridge, ipcRenderer } from 'electron'
import type { Cell, CellBounds, CellRuntime, PickResult, Store } from '@shared/types'

/**
 * Channel names are spelled out here instead of imported from @shared/ipc.
 *
 * Preloads run sandboxed, and a sandboxed preload can only require Electron's few
 * polyfilled builtins — not a relative file. Importing a module that another preload
 * entry also imports makes Rollup emit it as a shared chunk, and loading the preload
 * then fails outright. `satisfies` keeps these literals verified against the shared
 * definition at compile time while erasing completely at runtime.
 */
type Channels = typeof import('@shared/ipc').IPC

const IPC = {
  StoreLoad: 'store:load',
  StoreSave: 'store:save',
  CellSync: 'cell:sync',
  CellBounds: 'cell:bounds',
  CellReload: 'cell:reload',
  CellResume: 'cell:resume',
  CellOpenDevTools: 'cell:open-devtools',
  PickerStart: 'picker:start',
  PickerCancel: 'picker:cancel',
  SessionClear: 'session:clear',
  RuntimeUpdate: 'runtime:update',
  PickerResult: 'picker:result',
} satisfies Partial<Channels>

/** The only surface the renderer has into main. */
const api = {
  loadStore: (): Promise<Store> => ipcRenderer.invoke(IPC.StoreLoad),
  saveStore: (store: Store): Promise<void> => ipcRenderer.invoke(IPC.StoreSave, store),

  syncCells: (cells: Cell[]) => ipcRenderer.send(IPC.CellSync, cells),
  setBounds: (bounds: CellBounds[]) => ipcRenderer.send(IPC.CellBounds, bounds),
  reload: (id: string) => ipcRenderer.send(IPC.CellReload, id),
  resume: (id: string) => ipcRenderer.send(IPC.CellResume, id),
  openDevTools: (id: string) => ipcRenderer.send(IPC.CellOpenDevTools, id),

  startPicker: (id: string) => ipcRenderer.send(IPC.PickerStart, id),
  cancelPicker: (id: string) => ipcRenderer.send(IPC.PickerCancel, id),

  clearSession: (partition: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SessionClear, partition),

  onRuntime: (cb: (runtimes: CellRuntime[]) => void) => {
    const handler = (_e: unknown, runtimes: CellRuntime[]) => cb(runtimes)
    ipcRenderer.on(IPC.RuntimeUpdate, handler)
    return () => {
      ipcRenderer.off(IPC.RuntimeUpdate, handler)
    }
  },
  onPicked: (cb: (result: PickResult) => void) => {
    const handler = (_e: unknown, result: PickResult) => cb(result)
    ipcRenderer.on(IPC.PickerResult, handler)
    return () => {
      ipcRenderer.off(IPC.PickerResult, handler)
    }
  },
}

export type WebGridApi = typeof api

contextBridge.exposeInMainWorld('webgrid', api)
