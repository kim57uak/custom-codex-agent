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