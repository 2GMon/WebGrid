# WebGrid

Arrange live streams, public webcams and arbitrary web page elements in a resizable
grid. Cross-platform (macOS / Windows / Linux), built on Electron.

Unlike a browser with a lot of tabs, every cell is a real Chromium view with its own
cookie jar, so a signed-in dashboard and a signed-out YouTube stream can sit side by
side in the same wall.

## Features

- **Grid of live web views** — any URL, not just a fixed list of stream providers
- **Per-cell sessions** — each cell picks an isolated partition, so sign-in state is
  scoped rather than global
- **Element picker** — hover and click a page element like in devtools; the cell then
  shows only that element, scaled to fill. The selector is editable in the inspector for
  elements the picker cannot reach — CSS, or XPath when it starts with `/` or `(`
- **Reorderable grid** — drag cells to swap them; add or remove rows and columns
- **Workspaces** — save page/grid combinations and switch between them; restore the
  last one on startup (or not)
- **Concurrent-decode budget** — caps how many cells decode video at once and suspends
  the rest, instead of letting every stream drop to software decoding

## Development

```sh
npm install
npm run dev

# with devtools for the app shell (noisy: devtools logs its own protocol errors)
WEBGRID_DEVTOOLS=1 npm run dev
```

Build installers for the current platform:

```sh
npm run dist
```

Cross-building is possible but limited: Windows installers need Wine on macOS/Linux,
and macOS builds must run on macOS. So all three are built on CI instead: pushing a
`v*` tag runs `.github/workflows/release.yml`, which builds on a matrix of the three
runners and collects the installers into a draft GitHub Release.

Builds are unsigned. A locally built `.app` runs as-is, but a downloaded release is
quarantined by the browser, and since macOS 15 right-click → Open no longer gets past
that. Either clear the attribute or use the "Open Anyway" button under System Settings
→ Privacy & Security:

```sh
xattr -d com.apple.quarantine /Applications/WebGrid.app
```

## Notes and limitations

**YouTube and sign-in.** YouTube Premium limits concurrent streams (one on the
individual plan), and separate browser sessions count separately. Signed out there is
no such cap, so new cells default to the `persist:anon` partition. Sign in only for
cells that need it (members-only streams, private dashboards).

**Element picking and iframes.** The picker runs in the cell's main frame. Pages that
put their player in a cross-origin iframe — an embedded YouTube player, most notably —
cannot be inspected or cropped. Those cells work in `page` mode. Playback state is
still detected, because it is reported per view rather than per frame.

**Reducing load.** There is no API to set a frame rate or resolution on a `<video>`
from outside the page. What does work:

1. keep hardware decoding enabled (the default)
2. make cells physically smaller, or zoom them out — adaptive streaming picks its
   rendition from the player's real pixel size
3. suspend cells that are not visible (low-power mode)
4. cap the number of cells decoding video simultaneously

Streams without adaptive bitrate (a plain MP4, an MJPEG camera) offer no lever at all
beyond running fewer of them.

**Detecting which cells are heavy.** Cells are counted as video when Chromium reports
media playback, which covers cross-origin iframes. MJPEG cameras and canvas/WebCodecs
players are invisible to that; mark those cells "Count as video" by hand.

## License

MIT
