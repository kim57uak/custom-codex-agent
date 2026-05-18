/**
 * Vite config for the Electron preload script bundle. Externalises Electron
 * so the preload can still access the main process APIs.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});