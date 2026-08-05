import type { WebGridApi } from '../preload/app'

declare global {
  interface Window {
    webgrid: WebGridApi
  }
}

export {}
