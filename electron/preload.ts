/**
 * preload.ts - Electron Renderer IPC 브릿지
 *
 * 목적:
 * - contextBridge를 통해 Renderer에 안전한 IPC API 노출
 * - Main Process의 Node.js API와 Renderer 완전 분리
 * - IPC 채널 유효성 검증 (IPC_CHANNELS 기준)
 *
 * 보안 모델:
 * - contextIsolation: true → preload는 Renderer의 window 객체에 접근 불가
 * - window.electronAPI만 노출 (필요한 API만 white-list 방식)
 * - 모든 invoke/on 채널은 IPC_CHANNELS에서 사전 정의
 *
 * IPC 프로토콜:
 * - invoke: Renderer → Main (비동기 요청/응답)
 * - on: Renderer ← Main (이벤트 구독)
 * - send: Renderer → Main (단방향 메시지, version-check만)
 *
 * 사용 예:
 * ```typescript
 * // Renderer에서
 * const runId = await window.electronAPI.invoke('run:agent', options);
 * window.electronAPI.on('log:entry', (entry) => console.log(entry));
 * ```
 */

/** IPC 채널 정의 (Main Process와 공유) - Zod 의존성 없음 */
import { IPC_CHANNELS, IPC_VERSION, type IpcVersionCheck } from '../types/ipc-channels';
import { ipcRenderer, contextBridge } from 'electron';

/**
 * electronAPI 타입 정의
 * - Renderer에서 window.electronAPI로 접근
 */
const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (event: Electron.IpcRendererEvent, ...args: unknown[]) => void>>();

const electronAPI = {
  /**
   * IPC invoke (비동기 요청/응답)
   * - Renderer → Main: 'channel', ...args
   * - Returns: Promise<unknown>
   *
   * @param channel IPC 채널 (IPC_CHANNELS.invoke 목록)
   * @param args 채널별 인자
   * @returns Promise<응답 데이터>
   * @throws Invalid IPC invoke channel: ${channel}
   */
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    // 채널 유효성 검증 (IPC_CHANNELS.invoke 목록과 대조)
    const validInvoke = Object.values(IPC_CHANNELS.invoke) as string[];
    if (!validInvoke.includes(channel)) {
      throw new Error(`Invalid IPC invoke channel: ${channel}`);
    }
    // ipcRenderer.invoke()는 Promise 반환
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * IPC 이벤트 구독
   * - Renderer ← Main: 'channel', callback
   * - 구독 해제 함수 반환 (cleanup 용도)
   *
   * @param channel IPC 채널 (IPC_CHANNELS.on 목록)
   * @param callback 이벤트 수신 시 호출될 콜백
   * @returns 구독 해제 함수 () => void
   * @throws Invalid IPC on channel: ${channel}
   */
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    // 채널 유효성 검증 (IPC_CHANNELS.on 목록과 대조)
    const validOn = Object.values(IPC_CHANNELS.on) as string[];
    if (!validOn.includes(channel)) {
      throw new Error(`Invalid IPC on channel: ${channel}`);
    }

    // 콜백 래퍼: Electron.IpcRendererEvent에서 데이터 추출
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);

    // ipcRenderer.on()으로 구독
    ipcRenderer.on(channel, listener);

    // callback→listener 매핑 저장 (off()에서 lookup용)
    let channelMap = listenerMap.get(channel);
    if (!channelMap) {
      channelMap = new Map();
      listenerMap.set(channel, channelMap);
    }
    channelMap.set(callback, listener);

    // 구독 해제 함수 반환
    return () => {
      ipcRenderer.removeListener(channel, listener);
      channelMap?.delete(callback);
    };
  },

  /**
   * IPC 이벤트 구독 해제
   * - 명시적 구독 해제 (on()의 반환값 대신手動 해제)
   *
   * @param channel IPC 채널
   * @param callback previously registered listener
   */
  off: (channel: string, callback: (...args: unknown[]) => void): void => {
    const channelMap = listenerMap.get(channel);
    const listener = channelMap?.get(callback);
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
      channelMap?.delete(callback);
    }
  },

  /**
   * IPC 단방향 메시지 전송
   * - Renderer → Main: 'channel', ...args
   * - 응답 없음 (fire-and-forget)
   * - 현재는 'ipc:version-check'만 사용
   *
   * @param channel IPC 채널 (유효한 send 채널만)
   * @param args 채널별 인자
   * @throws Invalid IPC send channel: ${channel}
   */
  send: (channel: string, ...args: unknown[]): void => {
    const validSend = Object.values(IPC_CHANNELS.send) as string[];
    if (!validSend.includes(channel)) {
      throw new Error(`Invalid IPC send channel: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },

  /**
   * IPC 버전 확인 핸드셰이크
   * - Renderer → Main: 'ipc:version-check' (IPC_VERSION)
   * - Main → Renderer: 'ipc:version-match' 또는 'ipc:version-mismatch'
   * - 5초 타임아웃
   *
   * @returns Promise<IpcVersionCheck> (version, minVersion)
   */
  versionCheck: (): Promise<IpcVersionCheck> => {
    return new Promise((resolve) => {
      // 5초 타임아웃
      const timeoutId = setTimeout(() => {
        resolve({ version: 'unknown', minVersion: '1.0.0' });
      }, 5000);

      // 'ipc:version-match' 수신 시 해결
      ipcRenderer.once('ipc:version-match', (_event: Electron.IpcRendererEvent, data: unknown) => {
        clearTimeout(timeoutId);
        resolve(data as IpcVersionCheck);
      });

      // 'ipc:version-mismatch' 수신 시 해결 (버전 불일치)
      ipcRenderer.once('ipc:version-mismatch', (_event: Electron.IpcRendererEvent, data: unknown) => {
        clearTimeout(timeoutId);
        resolve(data as IpcVersionCheck);
      });

      // 버전 확인 요청 전송
      ipcRenderer.send('ipc:version-check', IPC_VERSION);
    });
  },

  /** 현재 실행 중인 플랫폼 (process.platform) */
  platform: process.platform,

  /** 현재 실행 중인 아키텍처 (process.arch) */
  arch: process.arch,
};

/**
 * contextBridge.exposeInMainWorld()
 * - window.electronAPI로 electronAPI 객체 노출
 * - Renderer에서 window.electronAPI.invoke(), window.electronAPI.on() 등 호출 가능
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

/** electronAPI 타입 export (TypeScript용) */
export type ElectronAPI = typeof electronAPI;