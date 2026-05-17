/**
 * Electron Main Process 진입점
 *
 * 주요职责:
 * 1. BrowserWindow 생성 (Main Process)
 * 2. 환경 변수 살균 처리 (보안)
 * 3. IPC 핸들러 등록
 * 4. 앱 수명주기 관리
 * 5. 시스템 트레이 + 네이티브 알림 (Phase 4)
 *
 * 보안 모델:
 * - contextIsolation: true (Renderer-Node 완전 분리)
 * - nodeIntegration: false (Main Process만 Node API 접근)
 * - sandbox: true (Renderer 프로세스 샌드박스)
 * - enableRemoteModule: false (deprecated remote 모듈 비활성화)
 * - webSecurity: true (same-origin 정책 적용)
 *
 * IPC 아키텍처:
 * - Renderer는 contextBridge를 통해 electronAPI.invoke/on만 호출
 * - Main Process는 ipcMain.handle/on으로 응답
 * - preload.ts에서 모든 IPC 채널 유효성 검증
 */

import { app, BrowserWindow, ipcMain, dialog, Notification, shell, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { LogBuffer } from './services/LogBuffer';
import { ConfigReader } from './services/ConfigReader';
import { EventBroker } from './services/EventBroker';
import { registerIpcHandlers } from './ipc/handlers';

/** Vite Dev Server URL (electron-forge + vite 플러그인 제공) */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
/** Vite 빌드 시 생성되는 렌더러 디렉토리 이름 */
declare const MAIN_WINDOW_VITE_NAME: string;

/** 메인 창 참조 (null 체크로 use-after-free 방지) */
let mainWindow: BrowserWindow | null = null;

/** 시스템 트레이 참조 */
let tray: Tray | null = null;

/** LogBuffer 서비스 인스턴스 (IPC 핸들러 간 공유) - 지연 초기화 */
let logBuffer: import('./services/LogBuffer').LogBuffer | null = null;
/** ConfigReader 서비스 인스턴스 - 지연 초기화 */
let configReader: import('./services/ConfigReader').ConfigReader | null = null;
/** EventBroker 서비스 인스턴스 - 지연 초기화 */
let eventBroker: import('./services/EventBroker').EventBroker | null = null;

/**
 * 환경 변수 살균 처리
 *
 * 보안 목적:
 * - LD_PRELOAD: shared library preload 공격 방지
 * - DYLD_INSERT_LIBRARIES: macOS dynamic library hijacking 방지
 * - NODE_OPTIONS: Node.js/V8 옵션 조작 방지
 * - ELECTRON_RUN_AS_NODE: Electron을 Node.js로 실행 시도 방지
 *
 * @returns 살균된 환경 변수 객체
 */
function sanitizeEnv(): NodeJS.ProcessEnv {
  const sanitized = { ...process.env };
  const blocklist = [
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
  ];
  for (const key of blocklist) {
    delete sanitized[key];
  }
  return sanitized;
}

/**
 * 메인 창 생성
 *
 * 설정 사항:
 * - 1400x900 기본 크기, 800x600 최소 크기
 * - backgroundColor: '#1e1e1e' (밝은 테마 플래시 방지)
 * - show: false → ready-to-show 시점부터 표시 (불필요한 렌더링 방지)
 *
 * 보안 설정:
 * - contextIsolation: true (필수)
 * - nodeIntegration: false (필수)
 * - sandbox: true (필수)
 * - enableRemoteModule: false (deprecated)
 * - webSecurity: true (same-origin 정책)
 */
function createWindow(): void {
  // 환경 변수 살균 (CLI spawn 전에 적용)
  const env = sanitizeEnv();
  Object.assign(process.env, env);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,

    // 배경색: VS Code/Cursor 다크 테마 기본색 (플래시 방지)
    backgroundColor: '#1e1e1e',

    // ready-to-show 이벤트 전까지 숨김 (불필요한 렌더링 방지)
    show: false,

    // 보안 설정 (CODE_STANDARDS.md §5 필수)
    webPreferences: {
      contextIsolation: true,      // Renderer-Node 완전 분리
      nodeIntegration: false,     // Main Process에서만 Node API
      sandbox: true,             // Renderer 샌드박스
      preload: path.join(__dirname, 'preload.js'),  // IPC bridge
      webSecurity: true,          // same-origin 정책 적용
    },
  });

  // 첫 렌더링 완료 시점부터 창 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 창 닫기 시 트레이로 최소화 (macOS 제외)
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin' && tray) {
      event.preventDefault();
      mainWindow?.hide();
      showTrayNotification('Agent Orchestrator is still running in the system tray.');
    }
  });

  // 창 닫기 이벤트 핸들러
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 외부 링크 핸들러 (https:만 허용)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // URL 로드 (개발/프로덕션 분기)
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // 개발 모드: Vite Dev Server URL 사용
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // 프로덕션 모드: 빌드된 HTML 파일 로드
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

/**
 * 시스템 트레이 생성
 *
 * 기능:
 * - 트레이 아이콘 표시 (app icon)
 * - 컨텍스트 메뉴 (Show/Hide, Quit)
 * - 클릭 시 메인 창 토글
 */
function createTray(): void {
  // 트레이 아이콘 (임시 16x16 PNG)
  // 실제로는 빌드 시 포함된 아이콘 파일 사용
  const iconPath = path.join(__dirname, '../../build/icon.png');
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // 아이콘이 없는 경우 빈 아이콘 생성 (fallback)
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Agent Orchestrator',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Hide',
      click: () => {
        mainWindow?.hide();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Agent Orchestrator');
  tray.setContextMenu(contextMenu);

  // 트레이 아이콘 클릭 시 메인 창 토글
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

/**
 * 네이티브 알림 표시
 *
 * @param body 알림 본문
 * @param title 알림 제목
 */
function showTrayNotification(body: string, title: string = 'Agent Orchestrator'): void {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
  }
}

/**
 * Renderer-to-Renderer 메시지 포워딩
 *
 * sidebar → main area 통신을 위해 Main Process를 경유
 * - send()로 수신한 메시지를 webContents.send()로 포워딩
 * - 모든 Renderer window가 메시지를 수신
 */
function setupRendererForwarding(): void {
  const forwardChannels = [
    'org:agent-selected',
    'org:add-agent',
    'inspector:file-selected',
    'console:clear',
    'workflow:selected',
  ];

  for (const channel of forwardChannels) {
    ipcMain.on(channel, (_event, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    });
  }
}

/**
 * IPC 버전 확인 핸드셰이크 프로토콜
 *
 * 목적:
 * - Renderer와 Main Process 간 IPC 버전 불일치 방지
 * - hot-reload 시 TypeError 발생 방지 (Plan-eng-review E5)
 *
 * 프로토콜:
 * 1. Renderer (preload.ts) → Main: 'ipc:version-check' (버전 문자열)
 * 2. Main → Renderer: 'ipc:version-match' (버전 일치)
 *    OR Main → Renderer: 'ipc:version-mismatch' (버전 불일치)
 *
 * 버전 불일치 시:
 * - Renderer에서 경고 로그 출력
 * - 일부 기능이 작동하지 않을 수 있음
 */
function setupIpcVersionHandshake(): void {
  ipcMain.on('ipc:version-check', (event, version: unknown) => {
    // 타입 검증 (Renderer는 신뢰 불가)
    if (typeof version !== 'string') {
      event.sender.send('ipc:version-mismatch', { reason: 'invalid-version-format' });
      return;
    }

    // 최소 필요 버전
    const minVersion = '1.0.0';

    if (version === minVersion) {
      event.sender.send('ipc:version-match', { version });
    } else {
      event.sender.send('ipc:version-mismatch', { version, minVersion });
    }
  });
}

/**
 * IPC的通知 핸들러 (트레이 알림 전송)
 */
function setupNotificationHandlers(): void {
  ipcMain.handle('notification:show', async (_event, data: unknown) => {
    const p = data as { title?: string; body: string };
    if (typeof p.body !== 'string') return false;

    showTrayNotification(p.body, p.title ?? 'Agent Orchestrator');
    return true;
  });
}

/**
 * 앱 준비 완료 이벤트 핸들러
 * - IPC 핸들러 등록
 * - 메인 창 생성
 * - 시스템 트레이 생성
 * - macOS dock 아이콘 클릭 시 창 재창성
 */
app.whenReady().then(() => {
  // IPC 버전 핸드셰이크 프로토콜 설정
  setupIpcVersionHandshake();

  // Renderer 간 메시지 포워딩
  setupRendererForwarding();

  // IPC 알림 핸들러 설정
  setupNotificationHandlers();

  // IPC 핸들러 등록 (지연 초기화)
  logBuffer = new LogBuffer();
  configReader = new ConfigReader();
  eventBroker = new EventBroker();

  registerIpcHandlers({ logBuffer, configReader, eventBroker });

  // 메인 창 생성
  createWindow();

  // EventBroker에 메인 창 등록 (LogBuffer flush 이벤트 전달용)
  if (mainWindow) {
    eventBroker.registerWindow(mainWindow);
  }

  // 시스템 트레이 생성 (Phase 4)
  createTray();

  // macOS: dock 아이콘 클릭 시 창이 없으면 재창성 + EventBroker 등록
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow && eventBroker) {
        eventBroker.registerWindow(mainWindow);
      }
    }
  });
});

/**
 * 모든 창 닫힘 이벤트 핸들러
 * - macOS: Cmd+Q로 앱 종료 시에만 quit
 * - Windows/Linux: 모든 창 닫으면 앱 종료 (트레이运行的 경우 제외)
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 트레이가 있는 경우 종료하지 않음
    if (!tray) {
      app.quit();
    }
  }
});

/**
 * 앱 종료 전 이벤트 핸들러
 * - LogBuffer에 남은 로그 flush
 * - 트레이 정리
 * - 관련 리소스 정리
 */
app.on('before-quit', () => {
  logBuffer?.flush();
  tray?.destroy();
  tray = null;
});

/** 테스트/디버깅용 export (선택적) */
export { mainWindow, logBuffer, configReader, eventBroker, tray };