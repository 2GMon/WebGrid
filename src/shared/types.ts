import { z } from 'zod'

/** How a cell renders the page it loaded. */
export const CellModeSchema = z.enum([
  'page', // the whole page, as-is
  'element', // a single element, cropped and scaled to fill the cell
  'video', // the first <video> found, cropped and scaled to fill the cell
])
export type CellMode = z.infer<typeof CellModeSchema>

/**
 * Session partition for a cell. Partitions are fully isolated cookie jars, so a
 * YouTube cell can stay signed out (no Premium concurrent-stream limit) while a
 * dashboard cell in the same grid uses a signed-in profile.
 */
export const PartitionSchema = z.string().regex(/^persist:[a-z0-9-]+$/)

/**
 * A named cookie jar that cells are assigned to. `id` is what goes into the Electron
 * partition name and is never rewritten, so renaming a session keeps every cookie and
 * sign-in it holds; only `name` is user-visible.
 */
export const SessionProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /**
   * Deliberately not `min(1)`: the rename field writes through on every keystroke, so
   * clearing it to type a new name would otherwise persist a store that fails to parse
   * on the next launch. Blank names are given one back by `reconcileSessions`.
   */
  name: z.string().default('Session'),
})
export type SessionProfile = z.infer<typeof SessionProfileSchema>

/** The one session that always exists, and where cells land when another is deleted. */
export const DEFAULT_SESSION_ID = 'default'

export const partitionFor = (id: string): string => `persist:${id}`
export const sessionIdOf = (partition: string): string => partition.replace(/^persist:/, '')

export const CellSchema = z.object({
  id: z.string(),
  url: z.string().url().or(z.literal('')),
  title: z.string().default(''),
  mode: CellModeSchema.default('page'),
  /** CSS selector captured by the element picker. Only used when mode === 'element'. */
  selector: z.string().nullable().default(null),
  partition: PartitionSchema.default(partitionFor(DEFAULT_SESSION_ID)),
  muted: z.boolean().default(true),
  zoomFactor: z.number().min(0.25).max(3).default(1),
  /** Auto-reload interval in seconds. 0 disables it. */
  refreshSec: z.number().min(0).default(0),
  /** Manual override for cells whose media we cannot auto-detect (MJPEG, canvas players). */
  forceHeavy: z.boolean().default(false),
  /** Excluded from the concurrent-decode budget; never auto-suspended. */
  pinned: z.boolean().default(false),
})
export type Cell = z.infer<typeof CellSchema>

export const GridSchema = z.object({
  rows: z.number().int().min(1).max(12).default(2),
  cols: z.number().int().min(1).max(12).default(2),
  gap: z.number().int().min(0).max(64).default(4),
})
export type Grid = z.infer<typeof GridSchema>

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().default('Untitled'),
  grid: GridSchema.default({ rows: 2, cols: 2, gap: 4 }),
  /**
   * Row-major, length === rows * cols. `null` marks an empty slot. Reordering the
   * grid is just a permutation of this array.
   */
  cells: z.array(CellSchema.nullable()).default([]),
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const SettingsSchema = z.object({
  restoreOnStartup: z.boolean().default(true),
  /**
   * Max number of cells allowed to decode video simultaneously. Above this,
   * Chromium falls back to software decoding and everything stalls at once.
   * 0 means unlimited.
   */
  maxConcurrentVideo: z.number().int().min(0).max(32).default(6),
  /** Suspend cells that are not visible (workspace switched away, window hidden). */
  lowPowerMode: z.boolean().default(true),
  /** Only one cell may be unmuted at a time. */
  exclusiveAudio: z.boolean().default(true),
})
export type Settings = z.infer<typeof SettingsSchema>

/**
 * Last window geometry. Owned by the main process (the renderer round-trips it
 * untouched), so it is stored outside `settings`. `x`/`y` are null the first time,
 * which lets the platform pick a sensible position.
 */
export const WindowStateSchema = z.object({
  x: z.number().int().nullable().default(null),
  y: z.number().int().nullable().default(null),
  width: z.number().int().min(480).default(1440),
  height: z.number().int().min(360).default(900),
  maximized: z.boolean().default(false),
  fullScreen: z.boolean().default(false),
})
export type WindowState = z.infer<typeof WindowStateSchema>

export const StoreSchema = z.object({
  version: z.literal(1).default(1),
  settings: SettingsSchema.default({}),
  /**
   * Editable by the user, but never empty: `reconcileSessions` in the store puts the
   * default back if it is missing and adopts any partition a cell still refers to.
   */
  sessions: z.array(SessionProfileSchema).default([{ id: DEFAULT_SESSION_ID, name: 'Default' }]),
  window: WindowStateSchema.default({}),
  workspaces: z.array(WorkspaceSchema).default([]),
  lastWorkspaceId: z.string().nullable().default(null),
})
export type Store = z.infer<typeof StoreSchema>

/** Where the renderer says a cell's viewport currently is, in CSS pixels. */
export type CellBounds = {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** False when scrolled out of view / behind a dialog — triggers low-power suspend. */
  visible: boolean
}

/** Live state pushed from main to the renderer for badges and overlays. */
export type CellRuntime = {
  id: string
  loading: boolean
  error: string | null
  /** webContents-level media state; fires even for cross-origin iframes. */
  playing: boolean
  audible: boolean
  /** Suspended by the concurrent-decode budget or by low-power mode. */
  suspended: boolean
  /** Frozen frame shown while suspended. */
  snapshot: string | null
  /** Measured from the page when same-origin access is possible. */
  stats: MediaStats | null
}

export type MediaStats = {
  width: number
  height: number
  fps: number
  droppedFrames: number
}

export type PickResult = {
  cellId: string
  selector: string
  label: string
}
