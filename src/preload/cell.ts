import { ipcRenderer } from 'electron'

/** See the note in app.ts: sandboxed preloads must be a single self-contained file. */
type Channels = typeof import('@shared/ipc').IPC

const IPC = {
  CellPickerStart: 'cell:picker:start',
  CellPickerCancel: 'cell:picker:cancel',
  CellPickerPicked: 'cell:picker:picked',
  CellApplyCrop: 'cell:apply-crop',
  CellStats: 'cell:stats',
} satisfies Partial<Channels>

/**
 * Injected into every cell. Runs in the isolated world, so it can read and style the
 * DOM without the page being able to see it.
 *
 * Limitation worth knowing: preload scripts only run in the main frame. Pages that
 * put their player inside a cross-origin iframe (an embedded YouTube player, most
 * notably) cannot be inspected or cropped from here. Those cells fall back to
 * 'page' mode, and their playback state still arrives in main via the
 * media-started-playing event, which is frame-agnostic.
 */

const STYLE_ID = '__webgrid_crop__'
const OVERLAY_ID = '__webgrid_picker__'

// ---------------------------------------------------------------------------
// Selector generation
// ---------------------------------------------------------------------------

/**
 * Class names are frequently build-hashed (CSS modules, styled-components), which
 * makes any selector built from them break on the site's next deploy.
 */
function isStableClass(name: string): boolean {
  if (name.length > 24) return false
  if (/\d{4,}/.test(name)) return false
  if (/^[a-z]{1,3}[-_][A-Za-z0-9]{5,}$/.test(name)) return false // css-modules style
  if (/^(css|sc|jsx)-[a-z0-9]+$/i.test(name)) return false
  return true
}

function isUniqueId(id: string): boolean {
  // Numeric-looking or generated ids are as brittle as hashed classes.
  return /^[A-Za-z][\w-]*$/.test(id) && !/\d{4,}/.test(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1
}

/** Builds the shortest selector that still resolves uniquely, preferring stable hooks. */
function selectorFor(el: Element): string {
  if (el.id && isUniqueId(el.id)) return `#${CSS.escape(el.id)}`

  const parts: string[] = []
  let node: Element | null = el

  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    let part = node.tagName.toLowerCase()

    if (node.id && isUniqueId(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`)
      break
    }

    // data-* attributes are the most durable hook a page usually offers.
    const dataAttr = [...node.attributes].find(
      (a) => a.name.startsWith('data-') && a.value && a.value.length < 40,
    )
    if (dataAttr) {
      part += `[${dataAttr.name}="${CSS.escape(dataAttr.value)}"]`
    } else {
      const classes = [...node.classList].filter(isStableClass).slice(0, 2)
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('')
    }

    // Disambiguate against siblings only when needed, to keep selectors short.
    const parent: Element | null = node.parentElement
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node!.tagName)
      if (sameTag.length > 1) {
        const candidate = [...parent.querySelectorAll(`:scope > ${part}`)]
        if (candidate.length !== 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
      }
    }

    parts.unshift(part)
    if (document.querySelectorAll(parts.join(' > ')).length === 1) break
    node = parent
  }

  return parts.join(' > ')
}

function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('')
  return `${tag}${id}${cls}`
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

let overlay: HTMLDivElement | null = null
let hovered: Element | null = null

function startPicker() {
  if (overlay) return
  overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: '2px solid #4f9cff',
    background: 'rgba(79,156,255,0.18)',
    borderRadius: '2px',
    transition: 'all 60ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>)
  document.documentElement.appendChild(overlay)

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
}

function stopPicker() {
  overlay?.remove()
  overlay = null
  hovered = null
  document.removeEventListener('mousemove', onMove, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKey, true)
}

function onMove(e: MouseEvent) {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el || el === hovered || el.id === OVERLAY_ID) return
  hovered = el
  const r = el.getBoundingClientRect()
  if (!overlay) return
  overlay.style.left = `${r.left}px`
  overlay.style.top = `${r.top}px`
  overlay.style.width = `${r.width}px`
  overlay.style.height = `${r.height}px`
}

function onClick(e: MouseEvent) {
  if (!hovered) return
  // Swallow the click so the page does not navigate while picking.
  e.preventDefault()
  e.stopPropagation()
  const target = hovered
  stopPicker()
  ipcRenderer.send(IPC.CellPickerPicked, {
    selector: selectorFor(target),
    label: labelFor(target),
  })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    stopPicker()
  }
}

// ---------------------------------------------------------------------------
// Crop mode
// ---------------------------------------------------------------------------

let cropSelector: string | null = null
let cropMode: 'page' | 'element' | 'video' = 'page'
let cropObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

function styleEl(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.documentElement.appendChild(el)
  }
  return el
}

function resolveTarget(): HTMLElement | null {
  if (cropMode === 'video') return document.querySelector('video')
  if (cropMode === 'element' && cropSelector) return document.querySelector(cropSelector)
  return null
}

/**
 * Scales the chosen element up to fill the viewport and hides everything else.
 *
 * The element is pinned to the top-left and transformed rather than reparented:
 * moving a node in the DOM breaks the page's own scripts (and stops video playback
 * in some players), whereas a transform leaves the document structure untouched.
 */
function applyCrop() {
  const target = resolveTarget()
  if (cropMode === 'page' || !target) {
    styleEl().textContent = ''
    target?.style.removeProperty('transform')
    return
  }

  const rect = target.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return

  // Contain rather than cover, so nothing gets cut off.
  const scale = Math.min(window.innerWidth / rect.width, window.innerHeight / rect.height)
  const offsetX = (window.innerWidth - rect.width * scale) / 2
  const offsetY = (window.innerHeight - rect.height * scale) / 2

  // Ancestors stay visible (hiding them would collapse the layout the target depends
  // on); only their own painted content is suppressed via `visibility`.
  styleEl().textContent = `
    html, body { overflow: hidden !important; background: #000 !important; margin: 0 !important; }
    body * { visibility: hidden !important; }
    [data-webgrid-target], [data-webgrid-target] * { visibility: visible !important; }
    [data-webgrid-target] {
      position: fixed !important;
      left: 0 !important; top: 0 !important;
      transform-origin: top left !important;
      transform: translate(${offsetX}px, ${offsetY}px) scale(${scale}) !important;
      z-index: 2147483646 !important;
    }
  `

  document.querySelectorAll('[data-webgrid-target]').forEach((el) => {
    if (el !== target) el.removeAttribute('data-webgrid-target')
  })
  target.setAttribute('data-webgrid-target', '')

  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => scheduleCrop())
  resizeObserver.observe(document.documentElement)
}

let cropRaf = 0
function scheduleCrop() {
  cancelAnimationFrame(cropRaf)
  cropRaf = requestAnimationFrame(applyCrop)
}

function watchTarget() {
  cropObserver?.disconnect()
  if (cropMode === 'page') return
  // Single-page apps re-render their player; re-resolve the selector when the DOM
  // changes so the crop survives navigation inside the page.
  cropObserver = new MutationObserver(() => {
    if (!document.querySelector('[data-webgrid-target]')) scheduleCrop()
  })
  cropObserver.observe(document.body, { childList: true, subtree: true })
}

// ---------------------------------------------------------------------------
// Media stats
// ---------------------------------------------------------------------------

let lastFrames = 0
let lastTime = 0

/**
 * Reports the resolution and effective frame rate of the cell's video, so the user
 * can see when adaptive bitrate has dropped a stream to a lower rendition. Only
 * works for same-origin video elements; cross-origin iframes report nothing.
 */
function pollStats() {
  const video = document.querySelector('video')
  if (!video || video.paused || !video.videoWidth) {
    ipcRenderer.send(IPC.CellStats, null)
    return
  }
  const quality = video.getVideoPlaybackQuality?.()
  const frames = quality?.totalVideoFrames ?? 0
  const now = performance.now()
  const fps = lastTime ? ((frames - lastFrames) * 1000) / (now - lastTime) : 0
  lastFrames = frames
  lastTime = now

  ipcRenderer.send(IPC.CellStats, {
    width: video.videoWidth,
    height: video.videoHeight,
    fps: Math.round(fps),
    droppedFrames: quality?.droppedVideoFrames ?? 0,
  })
}

// ---------------------------------------------------------------------------

ipcRenderer.on(IPC.CellPickerStart, startPicker)
ipcRenderer.on(IPC.CellPickerCancel, stopPicker)
ipcRenderer.on(IPC.CellApplyCrop, (_e, payload: { mode: typeof cropMode; selector: string | null }) => {
  cropMode = payload.mode
  cropSelector = payload.selector
  if (document.body) {
    watchTarget()
    scheduleCrop()
  }
})

window.addEventListener('DOMContentLoaded', () => {
  watchTarget()
  scheduleCrop()
  setInterval(pollStats, 2000)
})
window.addEventListener('resize', scheduleCrop)
