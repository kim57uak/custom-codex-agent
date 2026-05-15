/**
 * electron-env.d.ts - Electron 환경 타입 선언
 *
 * preload.ts 및 메인 프로세스에서 사용되는
 * Electron 전역 API의 타입을 선언합니다.
 */

/** Electron의 preload 스크립트에서 사용 가능한 전역 API */
interface ElectronPreloadContext {
  contextBridge: {
    exposeInMainWorld: (apiName: string, api: unknown) => void;
  };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (...args: unknown[]) => void) => void;
    once: (channel: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
    send: (channel: string, ...args: unknown[]) => void;
  };
  process: {
    platform: string;
    arch: string;
    env: Record<string, string | undefined>;
    kill(pid: number, signal: string): void;
  };
}

/** preload 스크립트 환경에서 전역으로 사용 가능한 API */
declare const contextBridge: ElectronPreloadContext['contextBridge'];
declare const ipcRenderer: ElectronPreloadContext['ipcRenderer'];
declare const process: ElectronPreloadContext['process'];