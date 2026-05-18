/**
 * Global ambient type declarations. Augments the Window interface with
 * electronAPI (from the preload script) and electronRequire for renderer
 * process Node.js access.
 */
/// <reference types="vite/client" />

import type { ElectronAPI } from '../electron/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    electronRequire: (module: string) => unknown;
  }
}

export {};
