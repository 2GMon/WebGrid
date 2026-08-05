import { app, BrowserWindow, ipcMain, screen, WebContentsView } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { GridManager } from './grid-manager'
import { loadStore, saveStore } from './store'
import { clearPartition } from './sessions'
import { IPC } from '@shared/ipc'
import {
  StoreSchema,
  type Cell,
  type CellBounds,
  type Store,
  type WindowState,
} from '@shared/types'

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

/**
 * Records the window geometry into the store. `getNormalBounds()` is the un-maximised
 * size, so restoring after un-maximising gives back the size the user actually chose.
 */
function persistWindowState() {
  if (!win || win.isDestroyed()) return
  const { x, y, width, height } = win.getNormalBounds()
  store = {
    ...store,
    window: { x, y, width, height, maximized: win.isMaximized(), fullScreen: win.isFullScreen() },
  }
  void saveStore(store)
}

/**
 * A saved position is only usable if the display it was on still exists — an external
 * monitor that has since been unplugged would otherwise strand the window off-screen.
 */
function visibleOnSomeDisplay(state: WindowState) {
  if (state.x === null || state.y === null) return false
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      state.x! + state.width > a.x &&
      state.x! < a.x + a.width &&
      state.y! + state.height > a.y &&
      state.y! < a.y + a.height
    )
  })
}

async function createWindow() {
  const saved = store.window
  const usePosition = visibleOnSomeDisplay(saved)

  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(usePosition ? { x: saved.x!, y: saved.y! } : {}),
    backgroundColor: '#101014',
    // Packaged builds take the icon from the app bundle (macOS, Windows) or the
    // generated .desktop entry (Linux). Development runs have neither, so they fall
    // back to the Electron icon unless pointed at the source file.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build', 'icon.png') }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })
  if (saved.maximized) win.maximize()
  if (saved.fullScreen) win.setFullScreen(true)

  // Debounced: resizing and dragging fire continuously, and each save rewrites the file.
  let saveTimer: NodeJS.Timeout | null = null
  const rememberBounds = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistWindowState, 400)
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)
  win.on('maximize', rememberBounds)
  win.on('unmaximize', rememberBounds)
  win.on('enter-full-screen', rememberBounds)
  win.on('leave-full-screen', rememberBounds)
  // `close` still has a live window to measure; `closed` does not.
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowState()
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
    // The renderer holds a copy taken at load time; the live window geometry is the
    // main process's to own, so it is never taken from a renderer save.
    store = { ...parsed.data, window: store.window }
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

/**
 * Development runs take their name from package.json (`webgrid`) while packaged builds
 * take it from electron-builder's productName (`WebGrid`), which would otherwise split
 * the two across separate userData directories. Renaming the old directory carries the
 * workspace *and* the session partitions over, so logged-in cells stay logged in.
 *
 * On a case-insensitive filesystem both names are already the same directory, and the
 * `existsSync` on the new path makes this a no-op there.
 */
function migrateLegacyUserData() {
  const parent = app.getPath('appData')
  const legacy = join(parent, 'webgrid')
  const next = join(parent, 'WebGrid')
  if (!existsSync(legacy) || existsSync(next)) return
  try {
    renameSync(legacy, next)
    console.log(`[store] migrated user data from ${legacy} to ${next}`)
  } catch (err) {
    // A failed migration only costs the previous state, so it must not block startup.
    console.error('[store] could not migrate user data:', err)
  }
}

// Must run before the name is set, since `appData` is name-independent but `userData`
// is not, and before anything resolves `userData` for the first time.
migrateLegacyUserData()
app.setName('WebGrid')

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
