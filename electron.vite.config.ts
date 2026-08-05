import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const PROD_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"

/**
 * The dev server needs inline scripts (react-refresh's preamble) and a websocket for
 * HMR, neither of which the shipped policy allows. Without this split the dev window
 * renders nothing at all.
 */
const DEV_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*"

/**
 * Sandboxed preloads cannot require relative files, so a shared chunk breaks them at
 * load time with nothing but a console warning. Fail the build instead.
 */
const noPreloadChunks = (): Plugin => ({
  name: 'webgrid-no-preload-chunks',
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'chunk' && !file.isEntry) {
        this.error(
          `preload build emitted the shared chunk "${file.fileName}". Sandboxed preloads ` +
            `must be self-contained — inline the shared value instead of importing it.`,
        )
      }
    }
  },
})

const csp = (): Plugin => ({
  name: 'webgrid-csp',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, ctx) => html.replace('%CSP%', ctx.server ? DEV_CSP : PROD_CSP),
  },
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), noPreloadChunks()],
    build: {
      rollupOptions: {
        // Two separate preloads: one for the app shell, one injected into every cell.
        input: {
          app: resolve('src/preload/app.ts'),
          cell: resolve('src/preload/cell.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [csp(), react()],
  },
})
