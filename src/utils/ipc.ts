/**
 * Safe Electron IPC invoke wrapper. Returns null when run outside Electron
 * or when the channel invocation throws, avoiding unhandled rejections.
 *
 * @template T 응답 타입
 * @param channel IPC 채널명
 * @param args 전달할 인자 목록
 * @returns 응답 데이터 또는 null
 */
export async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}
