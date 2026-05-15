/**
 * FileWatcher - 파일 시스템 변경 감지 서비스
 *
 * 기능:
 * - chokidar 기반 파일/디렉토리 변경 감지
 * - 변경 이벤트 IPC 브로드캐스트 (Renderer에 전달)
 * - 워크스페이스 디렉토리 감시
 * - 파일 필터링 (ignore 패턴)
 * - 감시 시작/중지 제어
 *
 * 설계 원칙:
 * - chokidar를 사용하여 크로스 플랫폼 파일 감시
 * - 이벤트는 EventBroker를 통해 Renderer에 전달
 * - .git, node_modules 등 불필요한 디렉토리 제외
 * - debouncing으로 빠른 연속 변경 이벤트 병합
 */

import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';

/** 파일 변경 이벤트 타입 */
export type FileChangeEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/** 파일 변경 이벤트 데이터 */
export interface FileChangeEventData {
  event: FileChangeEvent;
  filePath: string;
  timestamp: string;
}

/** 파일 감시 설정 */
export interface WatcherConfig {
  /** 감시할 경로 */
  paths: string[];
  /** 무시할 패턴 (glob) */
  ignored?: string[];
  /** 이벤트 디바운스 시간 (ms) */
  debounceMs?: number;
}

/** 기본 무시 패턴 */
const DEFAULT_IGNORED_PATTERNS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.swp',
  '**/*.swo',
  '**/*~',
  '**/.idea/**',
  '**/.vscode/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
];

/**
 * FileWatcher 클래스
 * chokidar 기반 파일 시스템 변경 감지 서비스
 */
export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private listeners: Map<string, Array<(data: FileChangeEventData) => void>> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isWatching = false;

  /** EventBroker 참조 (IPC 브로드캐스트용) */
  private eventBroker: { push: (channel: string, data: unknown) => void } | null = null;

  constructor(eventBroker?: { push: (channel: string, data: unknown) => void } | null) {
    this.eventBroker = eventBroker ?? null;
  }

  /**
   * 파일 감시 시작
   * @param config 감시 설정
   */
  startWatching(config: WatcherConfig): void {
    if (this.isWatching) {
      this.stopWatching();
    }

    const ignoredPatterns = [...DEFAULT_IGNORED_PATTERNS, ...(config.ignored ?? [])];
    const debounceMs = config.debounceMs ?? 100;

    for (const watchPath of config.paths) {
      const watcher = chokidar.watch(watchPath, {
        ignored: ignoredPatterns,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: debounceMs,
          pollInterval: 50,
        },
      });

      // 이벤트 리스너 등록
      const events: FileChangeEvent[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];

      for (const event of events) {
        watcher.on(event, (filePath: string) => {
          this.handleFileChange(event, filePath, debounceMs);
        });
      }

      watcher.on('error', (err: unknown) => {
        console.error(`[FileWatcher] Error watching ${watchPath}:`, err);
      });

      watcher.on('ready', () => {
        console.log(`[FileWatcher] Watching: ${watchPath}`);
      });

      this.watchers.set(watchPath, watcher);
    }

    this.isWatching = true;
  }

  /**
   * 파일 감시 중지
   */
  async stopWatching(): Promise<void> {
    for (const [watchPath, watcher] of this.watchers) {
      await watcher.close();
      this.watchers.delete(watchPath);
    }

    // 디바운스 타이머 정리
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isWatching = false;
  }

  /**
   * 파일 변경 이벤트 처리
   * 디바운스 적용 후 리스너 및 EventBroker에 전달
   */
  private handleFileChange(event: FileChangeEvent, filePath: string, debounceMs: number): void {
    const key = `${event}:${filePath}`;

    // 기존 디바운스 타이머 취소
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // 새 디바운스 타이머 설정
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);

      const data: FileChangeEventData = {
        event,
        filePath: path.normalize(filePath),
        timestamp: new Date().toISOString(),
      };

      // 등록된 리스너에 전달
      const pathListeners = this.listeners.get(filePath) ?? [];
      for (const listener of pathListeners) {
        try {
          listener(data);
        } catch {
          // 리스너 오류 무시
        }
      }

      // 글로벌 리스너에 전달
      const globalListeners = this.listeners.get('*') ?? [];
      for (const listener of globalListeners) {
        try {
          listener(data);
        } catch {
          // 리스너 오류 무시
        }
      }

      // EventBroker를 통해 Renderer에 IPC 브로드캐스트
      if (this.eventBroker) {
        this.eventBroker.push('file:change', data);
      }
    }, debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * 파일 변경 이벤트 리스너 등록
   * @param filePath 감시할 파일 경로 ('*' = 모든 파일)
   * @param listener 이벤트 리스너
   */
  onFileChange(filePath: string, listener: (data: FileChangeEventData) => void): void {
    if (!this.listeners.has(filePath)) {
      this.listeners.set(filePath, []);
    }
    this.listeners.get(filePath)!.push(listener);
  }

  /**
   * 파일 변경 이벤트 리스너 제거
   * @param filePath 감시 중인 파일 경로
   * @param listener 제거할 리스너
   */
  offFileChange(filePath: string, listener: (data: FileChangeEventData) => void): void {
    const listeners = this.listeners.get(filePath);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
      if (listeners.length === 0) {
        this.listeners.delete(filePath);
      }
    }
  }

  /**
   * 특정 경로 감시 추가
   * @param watchPath 추가할 감시 경로
   */
  addPath(watchPath: string): void {
    if (this.watchers.has(watchPath)) return;

    const watcher = chokidar.watch(watchPath, {
      ignored: DEFAULT_IGNORED_PATTERNS,
      persistent: true,
      ignoreInitial: true,
    });

    const events: FileChangeEvent[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];
    for (const event of events) {
      watcher.on(event, (filePath: string) => {
        this.handleFileChange(event, filePath, 100);
      });
    }

    this.watchers.set(watchPath, watcher);
  }

  /**
   * 특정 경로 감시 제거
   * @param watchPath 제거할 감시 경로
   */
  async removePath(watchPath: string): Promise<void> {
    const watcher = this.watchers.get(watchPath);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(watchPath);
    }
  }

  /**
   * 감시 중인 경로 목록 반환
   */
  getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * 감시 상태 반환
   */
  get isActive(): boolean {
    return this.isWatching && this.watchers.size > 0;
  }
}

export default FileWatcher;