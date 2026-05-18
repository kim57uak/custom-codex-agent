/**
 * Vitest global setup shim. Polyfills document.queryCommandSupported for
 * jsdom environments where it is undefined.
 */
/// <reference types="vitest" />

if (typeof document !== 'undefined' && typeof document.queryCommandSupported !== 'function') {
  document.queryCommandSupported = () => false;
}
