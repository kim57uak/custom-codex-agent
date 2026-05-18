/**
 * Vite config for the Electron main process bundle. Externalises Electron,
 * better-sqlite3, and node-pty so they remain Node.js runtime requires.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'better-sqlite3', 'node-pty'],
    },
  },
  resolve: {
    browserField: false,
    mainFields: ['module', 'jsnext:main', 'jsnext', 'main'],
  },
});