/** Channel names shared by main, preloads and renderer. */
export const IPC = {
  // renderer -> main
  StoreLoad: 'store:load',
  StoreSave: 'store:save',
  CellSync: 'cell:sync', // full desired cell set for the active workspace
  CellBounds: 'cell:bounds', // layout tick, high frequency
  CellReload: 'cell:reload',
  CellNavigate: 'cell:navigate',
  CellSetMuted: 'cell:set-muted',
  CellSetZoom: 'cell:set-zoom',
  CellOpenDevTools: 'cell:open-devtools',
  CellResume: 'cell:resume', // manual un-suspend
  PickerStart: 'picker:start',
  PickerCancel: 'picker:cancel',
  PickerClear: 'picker:clear',
  SessionClear: 'session:clear',
  SessionList: 'session:list',

  // main -> renderer
  RuntimeUpdate: 'runtime:update',
  PickerResult: 'picker:result',

  // main <-> cell preload
  CellPickerStart: 'cell:picker:start',
  CellPickerCancel: 'cell:picker:cancel',
  CellPickerPicked: 'cell:picker:picked',
  CellApplyCrop: 'cell:apply-crop',
  CellStats: 'cell:stats',
} as const
