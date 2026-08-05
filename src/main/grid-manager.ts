import { WebContentsView, type BaseWindow } from 'electron'
import { join } from 'node:path'
import { getCellSession } from './sessions'
import { IPC } from '@shared/ipc'
import type { Cell, CellBounds, CellRuntime, MediaStats, Settings } from '@shared/types'

const CELL_PRELOAD = join(__dirname, '../preload/cell.cjs')

type Managed = {
  spec: Cell
  view: WebContentsView
  bounds: CellBounds | null
  /** True while the view is a child of the window, i.e. actually rendering. */
  attached: boolean
  suspendedBy: 'budget' | 'lowpower' | null
  snapshot: string | null
  playing: boolean
  loading: boolean
  error: string | null
  stats: MediaStats | null
  /** Monotonic counter used to pick suspend victims: oldest activation loses. */
  activatedAt: number
  refreshTimer: NodeJS.Timeout | null
}

/**
 * Owns one WebContentsView per cell and keeps their bounds in sync with the grid
 * the renderer draws. The renderer only lays out empty frames; the actual pages are
 * native child views positioned on top of it.
 */
export class GridManager {
  private cells = new Map<string, Managed>()
  private settings: Settings
  private tick = 0
  private onRuntime: (runtimes: CellRuntime[]) => void
  private onPicked: (cellId: string, selector: string, label: string) => void

  constructor(
    private win: BaseWindow,
    settings: Settings,
    handlers: {
      onRuntime: (runtimes: CellRuntime[]) => void
      onPicked: (cellId: string, selector: string, label: string) => void
    },
  ) {
    this.settings = settings
    this.onRuntime = handlers.onRuntime
    this.onPicked = handlers.onPicked
  }

  updateSettings(settings: Settings) {
    this.settings = settings
    this.enforceBudget()
    this.emitRuntime()
  }

  /**
   * Reconciles the live views against the cells of the active workspace: creates
   * what is new, destroys what is gone, and applies changed properties in place so
   * that reordering the grid never reloads a page.
   */
  sync(specs: Cell[]) {
    const wanted = new Set(specs.map((s) => s.id))
    for (const [id, managed] of this.cells) {
      if (!wanted.has(id)) this.destroyCell(id, managed)
    }
    for (const spec of specs) {
      const existing = this.cells.get(spec.id)
      if (existing) this.applySpec(existing, spec)
      else this.createCell(spec)
    }
    this.emitRuntime()
  }

  /**
   * `bounds` is passed only when replacing an existing view, whose geometry the new
   * one inherits. The renderer re-measures on layout changes alone, and swapping a
   * cell's session changes neither the grid shape nor the slot order — so without
   * this the replacement would sit at no size, never attach, and show as black until
   * something else moved.
   */
  private createCell(spec: Cell, bounds: CellBounds | null = null) {
    // Ensure the partition exists and has its user agent and permission policy applied
    // before any page in it starts loading.
    getCellSession(spec.partition)

    const view = new WebContentsView({
      webPreferences: {
        partition: spec.partition,
        preload: CELL_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Cells are passive viewers; nothing in them should be able to open windows.
        webSecurity: true,
      },
    })

    const managed: Managed = {
      spec,
      view,
      bounds,
      attached: false,
      suspendedBy: null,
      snapshot: null,
      playing: false,
      loading: false,
      error: null,
      stats: null,
      activatedAt: 0,
      refreshTimer: null,
    }
    this.cells.set(spec.id, managed)
    this.wire(managed)

    view.setBackgroundColor('#000000')
    view.webContents.setAudioMuted(spec.muted)
    if (spec.url) void view.webContents.loadURL(spec.url).catch(() => {})
    this.scheduleRefresh(managed)

    if (bounds) {
      this.applyBounds(managed)
      this.reconcileAttachment()
    }
  }

  private applyBounds(managed: Managed) {
    const b = managed.bounds
    if (!b) return
    managed.view.setBounds({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(1, Math.round(b.width)),
      height: Math.max(1, Math.round(b.height)),
    })
  }

  private wire(managed: Managed) {
    const wc = managed.view.webContents
    const id = managed.spec.id

    wc.on('did-start-loading', () => {
      managed.loading = true
      this.emitRuntime()
    })
    wc.on('did-stop-loading', () => {
      managed.loading = false
      this.applyCrop(managed)
      this.emitRuntime()
    })
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      // -3 is ERR_ABORTED, which fires for ordinary in-page navigations.
      if (!isMainFrame || code === -3) return
      managed.error = `${desc} (${code})`
      this.emitRuntime()
    })
    wc.on('did-finish-load', () => {
      managed.error = null
    })
    wc.on('render-process-gone', (_e, details) => {
      managed.error = `renderer gone: ${details.reason}`
      this.emitRuntime()
    })

    // Fires per webContents, so it also covers cross-origin iframes such as embedded
    // YouTube players, which preload scripts cannot reach.
    wc.on('media-started-playing', () => {
      managed.playing = true
      managed.activatedAt = ++this.tick
      this.enforceBudget()
      this.emitRuntime()
    })
    wc.on('media-paused', () => {
      managed.playing = false
      this.enforceBudget()
      this.emitRuntime()
    })

    // Cells never navigate the app away or spawn windows.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))

    wc.ipc.on(IPC.CellPickerPicked, (_e, payload: { selector: string; label: string }) => {
      this.onPicked(id, payload.selector, payload.label)
    })
    wc.ipc.on(IPC.CellStats, (_e, stats: MediaStats | null) => {
      managed.stats = stats
      this.emitRuntime()
    })
  }

  private applySpec(managed: Managed, next: Cell) {
    const prev = managed.spec
    managed.spec = next

    // A partition change is the one property that cannot be applied in place: the
    // session is bound to the webContents at construction time.
    if (prev.partition !== next.partition) {
      const bounds = managed.bounds
      this.destroyCell(next.id, managed)
      this.createCell(next, bounds)
      return
    }
    if (prev.url !== next.url && next.url) {
      void managed.view.webContents.loadURL(next.url).catch(() => {})
    }
    if (prev.muted !== next.muted) managed.view.webContents.setAudioMuted(next.muted)
    if (prev.zoomFactor !== next.zoomFactor) managed.view.webContents.setZoomFactor(next.zoomFactor)
    if (prev.selector !== next.selector || prev.mode !== next.mode) this.applyCrop(managed)
    if (prev.refreshSec !== next.refreshSec) this.scheduleRefresh(managed)
    if (prev.forceHeavy !== next.forceHeavy || prev.pinned !== next.pinned) this.enforceBudget()
  }

  private destroyCell(id: string, managed: Managed) {
    if (managed.refreshTimer) clearInterval(managed.refreshTimer)
    // On app teardown the window (and its child views) may already be gone.
    if (managed.attached && !this.win.isDestroyed()) this.win.contentView.removeChildView(managed.view)
    if (!managed.view.webContents.isDestroyed()) managed.view.webContents.close()
    this.cells.delete(id)
  }

  private scheduleRefresh(managed: Managed) {
    if (managed.refreshTimer) clearInterval(managed.refreshTimer)
    managed.refreshTimer = null
    const sec = managed.spec.refreshSec
    if (sec <= 0) return
    managed.refreshTimer = setInterval(() => {
      if (managed.attached) managed.view.webContents.reload()
    }, sec * 1000)
  }

  /** Applies the layout the renderer measured. Called at animation-frame rate. */
  setBounds(list: CellBounds[]) {
    for (const b of list) {
      const managed = this.cells.get(b.id)
      if (!managed) continue
      managed.bounds = b
      this.applyBounds(managed)
    }
    this.enforceBudget()
    this.reconcileAttachment()
  }

  /**
   * Decides which cells may decode video. Chromium has a hard limit on concurrent
   * hardware decoder sessions; past it every stream silently falls back to software
   * decoding and the whole wall stutters. So we cap it ourselves and suspend the
   * least recently started cells instead.
   */
  private enforceBudget() {
    const max = this.settings.maxConcurrentVideo
    const heavy = [...this.cells.values()].filter(
      (c) => (c.playing || c.spec.forceHeavy) && this.isVisible(c),
    )

    // Nothing to do when unlimited or under the cap: release everything we suspended.
    if (max === 0 || heavy.length <= max) {
      for (const c of this.cells.values()) {
        if (c.suspendedBy === 'budget') c.suspendedBy = null
      }
      return
    }

    // Pinned and audible cells are what the user is actually watching; they are the
    // last to be dropped, then the oldest activation loses.
    const ranked = [...heavy].sort((a, b) => {
      const score = (c: Managed) =>
        (c.spec.pinned ? 2 : 0) + (c.view.webContents.isCurrentlyAudible() ? 1 : 0)
      const diff = score(b) - score(a)
      return diff !== 0 ? diff : b.activatedAt - a.activatedAt
    })

    ranked.forEach((c, i) => {
      if (i < max) {
        if (c.suspendedBy === 'budget') c.suspendedBy = null
      } else if (!c.spec.pinned) {
        c.suspendedBy = 'budget'
      }
    })
  }

  private isVisible(managed: Managed) {
    return managed.bounds?.visible ?? false
  }

  /**
   * Attaches or detaches views to match the desired state. Detaching is the actual
   * low-power mechanism: a view that is not a child of the window stops compositing
   * and decoding, while its webContents stays alive so resuming is instant and does
   * not re-authenticate or re-buffer from scratch.
   */
  private reconcileAttachment() {
    for (const managed of this.cells.values()) {
      const wantsAttach =
        this.isVisible(managed) &&
        managed.suspendedBy !== 'budget' &&
        !(this.settings.lowPowerMode && managed.suspendedBy === 'lowpower')

      if (wantsAttach && !managed.attached) {
        this.win.contentView.addChildView(managed.view)
        managed.attached = true
        managed.snapshot = null
        managed.view.webContents.setAudioMuted(managed.spec.muted)
        managed.activatedAt = ++this.tick
        this.emitRuntime()
      } else if (!wantsAttach && managed.attached) {
        void this.suspend(managed)
      }
    }
  }

  private async suspend(managed: Managed) {
    // Grab the last frame first: a detached view can no longer be captured, and the
    // still image is what the cell shows in place of the live page.
    try {
      const image = await managed.view.webContents.capturePage()
      if (!image.isEmpty()) managed.snapshot = image.toDataURL()
    } catch {
      // Capture can fail while the page is mid-navigation; a missing snapshot only
      // costs us a placeholder.
    }
    if (!managed.attached) return
    managed.view.webContents.setAudioMuted(true)
    this.win.contentView.removeChildView(managed.view)
    managed.attached = false
    this.emitRuntime()
  }

  /** Marks a cell as user-requested visible again, overriding a budget suspend. */
  resume(id: string) {
    const managed = this.cells.get(id)
    if (!managed) return
    managed.suspendedBy = null
    managed.activatedAt = ++this.tick
    this.enforceBudget()
    this.reconcileAttachment()
  }

  /** Called when the whole window is hidden or minimised. */
  setWindowVisible(visible: boolean) {
    for (const managed of this.cells.values()) {
      managed.suspendedBy = visible ? null : 'lowpower'
    }
    this.enforceBudget()
    this.reconcileAttachment()
  }

  private applyCrop(managed: Managed) {
    const { mode, selector } = managed.spec
    managed.view.webContents.send(IPC.CellApplyCrop, { mode, selector })
  }

  startPicker(id: string) {
    this.cells.get(id)?.view.webContents.send(IPC.CellPickerStart)
  }

  cancelPicker(id: string) {
    this.cells.get(id)?.view.webContents.send(IPC.CellPickerCancel)
  }

  reload(id: string) {
    this.cells.get(id)?.view.webContents.reload()
  }

  openDevTools(id: string) {
    this.cells.get(id)?.view.webContents.openDevTools({ mode: 'detach' })
  }

  private emitRuntime() {
    this.onRuntime(
      [...this.cells.values()].map((c) => ({
        id: c.spec.id,
        loading: c.loading,
        error: c.error,
        playing: c.playing,
        audible: c.view.webContents.isCurrentlyAudible(),
        suspended: !c.attached && this.isVisible(c),
        snapshot: c.snapshot,
        stats: c.stats,
      })),
    )
  }

  destroy() {
    for (const [id, managed] of this.cells) this.destroyCell(id, managed)
  }
}
