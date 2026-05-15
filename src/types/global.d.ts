/**
 * global.d.ts - 전역 타입 선언
 *
 * 포함 내용:
 * - window.electronAPI 타입 (preload.ts에서 노출된 API)
 * - Process 타입 확장
 */

import type { ElectronAPI } from '../electron/preload';

/**
 * window 타입 확장
 * - Renderer에서 window.electronAPI 접근 시 TypeScript 오류防止
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    electronRequire: (module: string) => unknown;
  }
}

export {};