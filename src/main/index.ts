import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { join } from 'node:path'
import { GridManager } from './grid-manager'
import { loadStore, saveStore } from './store'
import { clearPartition } from './sessions'
import { IPC } from '@shared/ipc'
import { StoreSchema, type Cell, type CellBounds, type Store } from '@shared/types'

/** `--no-restore` starts with an empty workspace without touching the saved state. */
const noRestore = process.argv.includes('--no-restore')

let win: BrowserWindow | null = null
let grid: GridManager | null = null
let store: Store

/**
 * The app shell is itself a WebContentsView rather than the window's main contents,
 * so cell views can be layered above it with explicit z-order.
 */
let shell: WebContentsView | null = null

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#101014',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  shell = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/app.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.contentView.addChildView(shell)

  const fit = () => {
    const { width, height } = win!.getContentBounds()
    shell!.setBounds({ x: 0, y: 0, width, height })
  }
  fit()
  win.on('resize', fit)

  grid = new GridManager(win, store.settings, {
    onRuntime: (runtimes) => shell?.webContents.send(IPC.RuntimeUpdate, runtimes),
    onPicked: (cellId, selector, label) =>
      shell?.webContents.send(IPC.PickerResult, { cellId, selector, label }),
  })

  // Suspending on hide is the cheap half of low-power mode: an occluded window has
  // no reason to keep decoding video.
  win.on('hide', () => grid?.setWindowVisible(false))
  win.on('minimize', () => grid?.setWindowVisible(false))
  win.on('show', () => grid?.setWindowVisible(true))
  win.on('restore', () => grid?.setWindowVisible(true))

  win.on('closed', () => {
    grid?.destroy()
    grid = null
    win = null
    shell = null
  })

  // Surface renderer errors instead of leaving a blank window to guess at.
  shell.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${source}:${line})`)
  })
  shell.webContents.on('did-fail-load', (_e, code, desc) =>
    console.error(`[renderer] failed to load: ${desc} (${code})`),
  )

  // Opt-in: the devtools window logs a stream of its own harmless protocol errors,
  // which drowns out anything the app actually reports.
  if (process.env.WEBGRID_DEVTOOLS) shell.webContents.openDevTools({ mode: 'detach' })

  if (process.env.ELECTRON_RENDERER_URL) {
    await shell.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await shell.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.show()
}

function registerIpc() {
  ipcMain.handle(IPC.StoreLoad, () => ({
    ...store,
    lastWorkspaceId: noRestore ? null : store.lastWorkspaceId,
  }))

  ipcMain.handle(IPC.StoreSave, async (_e, next: unknown) => {
    const parsed = StoreSchema.safeParse(next)
    if (!parsed.success) {
      console.error('[store] refusing to save invalid state:', parsed.error.message)
      return
    }
    store = parsed.data
    grid?.updateSettings(store.settings)
    await saveStore(store)
  })

  ipcMain.on(IPC.CellSync, (_e, cells: Cell[]) => grid?.sync(cells))
  ipcMain.on(IPC.CellBounds, (_e, bounds: CellBounds[]) => grid?.setBounds(bounds))
  ipcMain.on(IPC.CellReload, (_e, id: string) => grid?.reload(id))
  ipcMain.on(IPC.CellResume, (_e, id: string) => grid?.resume(id))
  ipcMain.on(IPC.CellOpenDevTools, (_e, id: string) => grid?.openDevTools(id))
  ipcMain.on(IPC.PickerStart, (_e, id: string) => grid?.startPicker(id))
  ipcMain.on(IPC.PickerCancel, (_e, id: string) => grid?.cancelPicker(id))
  ipcMain.handle(IPC.SessionClear, (_e, partition: string) => clearPartition(partition))
}

// A single instance keeps one set of session partitions authoritative; a second
// process would fight the first over the same cookie jars on disk.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    store = await loadStore()
    registerIpc()
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
