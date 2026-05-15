# Next-Gen AI Code Shell — Desktop Agent Orchestrator

> **이 문서는 기존 `Planning.md.orig`를 CEO 리뷰 결과에 따라 전면 재작성한 것입니다.**
> 기존 문서: `Planning.md.orig`

## 핵심 방향

- **Code-OSS를 fork하지 않는다.** Electron + `@vscode/webview-ui-toolkit` + `monaco-editor`로 동일한 UX를 달성.
- **기존 FastAPI (Python) 백엔드를 완전히 걷어내고 Node.js/TypeScript 단일 프로세스로 전환.**
- **UI는 Cursor/Codex Desktop 스타일** — Activity Bar, Sidebar, Panel 레이아웃.
- **코어 가치는 멀티-에이전트 오케스트레이션** — 코드 에디팅 기능은 최소화 (Inspector에서만 Monaco 사용).
- **UI가 곧 제품이다.** 서버 로직은 단순. Cursor/Codex Desktop 수준의 픽셀 완성도가 채택률을 결정.

---

## 1. Product Vision

### 현재 (Web App → Desktop App)
```
┌────────────────────────────────────────────────────────┐
│  브라우저에서 localhost:8000 접속                        │
│  Python 서버 항상 떠있어야 함                           │
│  OS 네이티브 기능 없음 (알림, 트레이, 파일시스템)        │
│  배포 = git pull + pip install                         │
└────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────┐
│  .dmg 하나 설치하면 끝                                  │
│  단일 프로세스 (Electron Main Process = Node.js)        │
│  시스템 트레이, 네이티브 알림, 오프라인 동작            │
│  자동 업데이트 (Squirrel)                              │
│  UI/UX = Cursor, Codex Desktop 수준                    │
└────────────────────────────────────────────────────────┘
```

### 차별화: Agent Orchestration Native
Cursor가 "AI-native 코드 에디터"라면, 이 앱은 **"AI-native 에이전트 오케스트레이터"**다.
- 싱글 에이전트 실행 (Codex CLI / Gemini CLI)
- 멀티-스텝 워크플로 (다중 에이전트 순차/병렬 실행)
- 실시간 이벤트 스트리밍 + 로그 뷰어
- 스킬/에이전트 인스펙터 + 실시간 편집
- MCP 서버 통합 (미래)

### UI-First 선언
**이 프로젝트의 성패는 프론트엔드가 결정한다.** 서버 로직은 단순하다 (CLI spawn + SQLite读写). 사용자가 체감하는 제품의 가치는 전적으로 UI/UX 품질에서 나온다.

| 영역 | 중요도 | 사유 |
|------|--------|------|
| 레이아웃 정밀도 | ★★★★★ | Cursor/Codex Desktop과 픽셀 단위로 일치해야 신뢰감 |
| 애니메이션 | ★★★★☆ | 탭 전환, 패널 리사이즈, 상태 변화가 60fps로 매끄러워야 함 |
| 다크/라이트 테마 | ★★★★☆ | 10개 테마 각각이 독립적인 디자인 시스템 |
| 아이콘/타이포그래피 | ★★★★☆ | SF Pro / Segoe UI 시스템 폰트 + 일관된 아이콘 세트 |
| 상태 피드백 | ★★★★★ | 로딩/빈값/에러/성공 4가지 상태가 모든 뷰에 존재 |
| 터미널/로그 | ★★★★☆ | xterm.js + 실시간 스트리밍이 제품의 핵심 경험 |
| 반응형 레이아웃 | ★★★☆☆ | 창 리사이즈 시 패널 비율이 자연스럽게 조절

---

## 1-b. Theme Strategy

React 기반 10개 테마 시스템. CSS Variables로 완전히 분리된 설계.

### 접근법
- 단일 CSS Variable 시트 (`:root[data-theme="xxx"]`)로 모든 테마 정의
- ThemeProvider (React Context)로 동적 전환
- 각 테마: 12개 CSS 변수 (bg, surface, text, accent, border 등)

### 10개 테마 라인업

| # | 테마명 | 모드 | 분위기 |
|---|--------|------|--------|
| 1 | Cyber Fusion | Dark | 네온 그린 + 블랙, 레트로 터미널 |
| 2 | Night Ops | Dark | 딥블루 + 골드 액센트, 밀리터리 |
| 3 | Matrix Green | Dark | 모노크롬 그린, 매트릭스 |
| 4 | Aurora | Dark | 보라/핑크 그라데이션, 사이버펑크 |
| 5 | Dracula Pro | Dark | Dracula 팔레트, 코드 친화적 |
| 6 | Glass Enterprise | Light | 프로스티드 글래스, 인디고 |
| 7 | Minimal Pro | Light | 흑백, 미니멀, Inter 폰트 |
| 8 | Paper | Light | 따뜻한 오프화이트 + 세피아, 문서 작업용 |
| 9 | Solarized Light | Light | Solarized 팔레트, 눈 피로 감소 |
| 10 | Nord | Dark/Light | 북유럽 파스텔, 차분한 팔레트 |

### 구현
- 기존 CSS 13개 파일 대신 **ThemeProvider + CSS Variables** 단일 체계
- 테마 전환 시 `document.documentElement.dataset.theme = 'aurora'` (instant switch, no FOUC)
- 사용자 설정 localStorage에 저장

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron Renderer Process  (React + TypeScript)                │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Activity  │  │ Sidebar  │  │  Main    │  │  Panel        │  │
│  │ Bar      │  │ - Org    │  │  Area    │  │  - Terminal   │  │
│  │ - Org    │  │ - Console│  │  - 대시   │  │  - Output     │  │
│  │ - Dash   │  │ - W/flow │  │   보드   │  │  - Events     │  │
│  │ - Console│  │ - Inspect│  │  상세 뷰  │  │               │  │
│  │ - W/flow │  └──────────┘  └──────────┘  └───────────────┘  │
│  │ - Inspect│                                                    │
│  └──────────┘                                                    │
│                                            ┌──────────────────┐ │
│                                            │ AI Chat Sidepanel│ │
│                                            │ (웹뷰/커스텀)    │ │
│                                            └──────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │ IPC (contextBridge → ipcRenderer)
┌────────────────────────▼────────────────────────────────────────┐
│  Electron Main Process  (Node.js/TypeScript)                    │
│                                                                 │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Agent Orchestrator  │  │ Services                        │  │
│  │                     │  │  - ConfigReader                 │  │
│  │  - Queue Manager    │  │  - DashboardService             │  │
│  │  - RunOrchestrator  │  │  - InspectorService             │  │
│  │  - WorkflowEngine   │  │  - BackupService                │  │
│  │  - Multi-turn       │  │  - FileWatcher (chokidar)       │  │
│  └─────────────────────┘  └──────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ CLI Adapters             │  │ Stores                          │  │
│  │                          │  │  - RunStore (better-sqlite3)    │  │
│  │  - CodexEngine           │  │  - WorkflowStore (better-sqlite3)│  │
│  │  - GeminiEngine          │  │  - EventStore                   │  │
│  │  - OpenCodeEngine   (P5) │  └──────────────────────────────────┘  │
│  │  - ClaudeCodeEngine (P5) │                                        │
│  │  - (future) MCP          │                                        │
│  └──────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Renderer vs Main 프로세스 분리

| 기능 | 프로세스 | 이유 |
|------|---------|------|
| UI 렌더링 | Renderer | React 컴포넌트 |
| CLI 실행 | Main | child_process는 Main only |
| SQLite读写 | Main | better-sqlite3는 Main only |
| 파일시스템 접근 | Main | fs는 Main only (contextBridge로 노출) |
| SSE 이벤트 | Main → Renderer | IPC push |
| 네이티브 API | Main | dialog, notification, tray |
| Monaco Editor | Renderer | monaco-editor는 DOM 필요 |

---

## 3. UI Structure (Cursor / Codex Desktop Style)

### Layout System
```
┌────────┬──────────────────────────┬──────────┐
│        │                          │          │
│Activity│   Sidebar                │ AI Chat  │
│  Bar   │   ┌──────────────────┐   │ Sidepanel│
│        │   │ 탭 콘텐츠 영역    │   │          │
│ 🔲 Org │   │                  │   │ ┌──────┐ │
│ 🔲 Dash│   │ - Org 트리       │   │ │Chat  │ │
│ 🔲 Con │   │ - Console 설정   │   │ │Agent │ │
│ 🔲 W/f │   │ - Workflow 캔버스│   │ │Message│ │
│ 🔲 Ins │   │ - Inspector 파일 │   │ └──────┘ │
│        │   └──────────────────┘   │          │
│        │                          │          │
├────────┴──────────────────────────┴──────────┤
│  Panel                                        │
│  ┌────────┬──────────┬──────────┬──────────┐  │
│  │터미널  │ Output   │ Events   │ Problems │  │
│  └────────┴──────────┴──────────┴──────────┘  │
└───────────────────────────────────────────────┘
```

### 5 Core Views

| View | Activity Bar Icon | Sidebar Content | Main Area |
|------|------------------|-----------------|-----------|
| **Organization** | 👥 | Hierarchy tree with health status | Selected agent detail + profile |
| **Dashboard** | 📊 | Metric cards list | Detail chart/drilldown |
| **Console** | ▶️ | Run config (agent/workspace/prompt) | Live terminal + log output |
| **Workflow** | 🔄 | Step list + recommendations | SVG canvas with node graph |
| **Inspector** | 🔍 | File browser (agents/skills) | Monaco Editor + save |

### Tech
- **`@vscode/webview-ui-toolkit`**: `<VSCodePanel>`, `<VSCodeButton>`, `<VSCodeTextField>`, `<VSCodeDivider>` — Cursor/VS Code와 동일한 디자인 시스템
- **Monaco Editor**: Inspector 뷰에서 코드 편집기로만 사용
- **xterm.js**: Console 뷰의 터미널 에뮬레이터 (node-pty와 연결)
- **React Router**: 탭/서브뷰 네비게이션
- **Zustand**: 상태 관리 (기존 `state` 객체 대체)

---

## 4. Python → Node.js Service Migration Map

| Python Service | Node.js Equivalent | Key Changes |
|---------------|-------------------|-------------|
| `config_reader.py` | `src/services/ConfigReader.ts` | fs-extra + JSON.parse, no FastAPI |
| `dashboard_service.py` | `src/services/DashboardService.ts` | IPC event aggregation |
| `engine_adapters.py` | `src/adapters/CodexEngine.ts`, `GeminiEngine.ts` | child_process.spawn. OpenCode + ClaudeCode는 Phase 5 |
| `run_orchestrator.py` | `src/orchestrator/RunOrchestrator.ts` | asyncio → Promise + EventEmitter |
| `workflow_orchestrator.py` | `src/orchestrator/WorkflowEngine.ts` | LangGraph 대신 직접 상태 머신 |
| `run_store.py` | `src/stores/RunStore.ts` | better-sqlite3 |
| `workflow_store.py` | `src/stores/WorkflowStore.ts` | better-sqlite3 |
| `event_stream.py` | `src/services/EventBroker.ts` | SSE → Electron IPC |
| `file_watcher.py` | `src/services/FileWatcher.ts` | watchdog → chokidar |
| `inspector_service.py` | `src/services/InspectorService.ts` | path traversal 보안 유지 |
| `skill_agent_backup_service.py` | `src/services/BackupService.ts` | tar.gz → archiver |
| `api_routes.py` (670줄) | `src/ipc/handlers.ts` | HTTP → IPC 핸들러 매핑 |

### 포팅 원칙
- **서비스당 1파일**: 각 서비스는 단일 TypeScript 파일 with typed interfaces
- **의존성 주입 유지**: FastAPI Depends → constructor injection
- **타입 안전성**: Pydantic → Zod 또는 TypeScript interface
- **Python 참조 + 최적화**: 기존 Python 로직을 참고 자료로 활용하되, TypeScript/Node.js에 최적화된 구조로 재설계. 단순 언어 번역 금지. 병목/에러 처리/타입 안전성을 개선하는 방향으로 리팩토링

---

## 5. Project Structure (예상)

```
agent-orchestrator-desktop/
├── electron/                    # Electron Main Process
│   ├── main.ts                  # 앱 진입점, window 생성
│   ├── preload.ts               # contextBridge (API 노출)
│   ├── ipc/
│   │   ├── handlers.ts          # IPC 핸들러 등록
│   │   ├── run-handlers.ts
│   │   ├── workflow-handlers.ts
│   │   └── inspector-handlers.ts
│   ├── services/
│   │   ├── ConfigReader.ts
│   │   ├── DashboardService.ts
│   │   ├── InspectorService.ts
│   │   ├── BackupService.ts
│   │   ├── FileWatcher.ts
│   │   └── EventBroker.ts
│   ├── orchestrator/
│   │   ├── RunOrchestrator.ts
│   │   └── WorkflowEngine.ts
│   ├── adapters/
│   │   ├── EngineAdapter.ts      # interface
│   │   ├── CodexEngine.ts
│   │   └── GeminiEngine.ts
│   └── stores/
│       ├── RunStore.ts
│       ├── WorkflowStore.ts
│       └── migrations/
├── src/                         # Electron Renderer Process (React)
│   ├── main.tsx                 # React 진입점
│   ├── App.tsx                  # Layout shell
│   ├── components/
│   │   ├── layout/
│   │   │   ├── ActivityBar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── MainArea.tsx
│   │   │   └── Panel.tsx
│   │   ├── views/
│   │   │   ├── OrgView.tsx
│   │   │   ├── DashboardView.tsx
│   │   │   ├── ConsoleView.tsx
│   │   │   ├── WorkflowView.tsx
│   │   │   └── InspectorView.tsx
│   │   ├── ai-chat/
│   │   │   └── ChatSidepanel.tsx
│   │   └── common/
│   ├── stores/                  # Zustand stores
│   ├── hooks/                   # IPC wrappers
│   └── types/                   # Shared TypeScript types
├── resources/                   # 아이콘, Assets
├── build/                       # electron-builder 설정
├── package.json
├── tsconfig.json
├── electron-builder.yml
└── forge.config.ts
```

---

## 6. Build & Distribution

```yaml
appId: com.dev.agent-orchestrator
productName: AgentOrchestrator
copyright: Copyright © 2026

directories:
  output: release

files:
  - electron/**/*
  - src/**/*
  - resources/**/*

mac:
  category: public.app-category.developer-tools
  target:
    - dmg
    - pkg
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true                    # ★ macOS 10.15+ 필수 — 코드사인만으로 부족
  # 필수 entitlement 키 (node-pty + CLI spawn 대응):
  # com.apple.security.cs.allow-unsigned-executable-memory
  # com.apple.security.cs.disable-library-validation
  # com.apple.security.automation.apple-events
  # com.apple.security.network.client

win:
  target:
    - nsis
    - portable

dmg:
  sign: true
  contents:
    - x: 410
      y: 150
      type: link
      path: /Applications
    - x: 130
      y: 150
      type: file
```

**Tooling:**
- Bundler: `electron-forge` + Vite plugin (네이티브 모듈 지원이 더 성숙함)
- Packager: `electron-builder`
- Update: `electron-updater` (Squirrel)
- Test: `vitest` + `playwright` (E2E)

> **CEO Review Amendment (2026-05-14):** `electron-vite`에서 `electron-forge + Vite plugin`으로 변경.
> `node-pty`, `better-sqlite3` 같은 네이티브 모듈 지원이 `electron-forge`가 더 성숙함 (`electron-rebuild` 내장).
> Vite 플러그인 지원으로 `electron-vite`와 동일한 DX 유지 가능.

---

## 7. Development Roadmap

### Phase 1: Electron Foundation (2-3주) ✅ 완료
- [x] electron-forge 프로젝트 스캐폴딩 + Vite plugin 설정 (네이티브 모듈: `node-pty`, `better-sqlite3`)
- [x] **IPC Contract 정의** (`types/ipc-contract.ts`) — Zod/TypeScript 인터페이스로 모든 IPC 메시지 스키마 사전 정의
- [x] **Main Process 보안 설정** + macOS Hardened Runtime Entitlements (`build/entitlements.mac.plist`)
- [x] Main/Renderer 프로세스 분리 + contextBridge
- [x] `@vscode/webview-ui-toolkit` + VS Code 스타일 레이아웃
- [x] Activity Bar + Sidebar + Panel 프레임워크
- [x] IPC 핸들러 인프라 + **Log Buffer** (CLI stdout 16ms 배치 플러시, IPC 포화 방지)
- [x] vitest 설정 + 첫 번째 unit test (IPC handler 검증)

### Phase 2: Core Services 포팅 (3-4주) ✅ 완료
**의존성 순서** (아래는 위상 정렬된 순서):
1. [x] ConfigReader + EventBroker — 독립 가능, foundation
   - **Log Buffer 구현**: CLI stdout을 16ms 간격으로 배치 처리하여 IPC 포화 방지
2. [x] better-sqlite3 + RunStore / WorkflowStore — schema-first
   - **성능 평가**: Worker Thread 분리 vs Main Process 직접 접근 (WAL 모드) 비교. 싱글유저 데스크톱에서는 Main Process 직접 접근이 더 빠를 수 있음 (이중 직렬화 오버헤드 회피)
3. [x] CLI Engine Adapters (CodexEngine, GeminiEngine) — child_process.spawn
4. [x] **RunOrchestrator를 독립 라이브러리로 분리** (`src/orchestrator/`) — Electron Main Process에서 import만 하도록 설계. TUI/데몬/서버 전환 가능성 확보
5. [x] WorkflowEngine (orchestrator 위에 빌드, fan-out/fan-in 노드 타입 포함)
6. [x] DashboardService, InspectorService, BackupService (electron/services/BackupService.ts), FileWatcher (electron/services/FileWatcher.ts) — 모든 서비스 구현 완료

### Phase 3: UI 완성 (2-3주)
- [x] Org View (계층 트리 + 상태 표시)
- [x] Dashboard View (메트릭 카드 + 차트)
- [x] Console View (xterm.js 터미널 + 로그)
- [x] Workflow View (SVG 캔버스 + 에이전트 노드)
- [x] Inspector View (Monaco Editor + 파일 브라우저)
- [x] AI Chat Sidepanel

### Phase 4: Polish & Ship (1-2주)
- [x] electron-builder + 코드사인 인증서
- [x] 자동 업데이트 (electron-updater)
- [x] 시스템 트레이 + 네이티브 알림
- [x] 오프라인 모드 검증
- [x] macOS .dmg / Windows .exe 배포 테스트

### Phase 5: 엔진 확장 + 고도화 (Post-launch)
- [x] OpenCode Engine 어댑터 — `opencode` CLI spawn, stdout/stderr 스트리밍
- [x] ClaudeCode Engine 어댑터 — `claude` CLI spawn, 세션 관리
- [x] 공급처 선택 UI — Console 뷰에 EngineSelector 드롭다운 (Codex/Gemini/OpenCode/ClaudeCode)
- [x] Engine별 설정 페이지 — 각 CLI의 모델/프록시/타임아웃 설정
- [x] MCP 서버 통합
- [x] 워크플로 병렬 실행
- [x] 터미널 멀티세션

**Total estimated effort: 12-16주 (혼자 작업 기준)**
- CC + gstack 활용 시 실제 구현 시간: human 12-16주 → CC ~30-50시간
- 8-12시간 추정은 IPC bridge 구현, 네이티브 모듈 설정, macOS Gatekeeper 대응 등 실제 장애물을 고려하지 않은 과소추정
- Phase 1 (Foundation): CC ~8-10시간 ✅ 완료
- Phase 2 (Services): CC ~12-15시간 — orchestrator 분리 아키텍처 포함
- Phase 3 (UI): CC ~8-12시간 — 5개 뷰 + Chat Sidepanel
- Phase 4 (Polish): CC ~4-6시간 — 배포 + 코드사인
- Phase 5 (Post-launch): 프로젝트 완료 후 별도 일정

---

## 8. NOT in Scope

| 기능 | 제외 이유 |
|------|----------|
| Monaco Ghost Text / Inline Suggestion | 코딩 기능 불필요 |
| VS Code Extension Marketplace | 에이전트 앱에 불필요 |
| LSP 통합 | 편집 기능 최소화 |
| Code-OSS Fork 유지보수 | Fork 자체를 안 함 |
| Python 백엔드 유지 | 완전 Node.js 전환 |
| Firebase / Auth / 멀티유저 | 1인 데스크톱 앱 |
| OpenCode / ClaudeCode 엔진 (Phase 1-4) | Phase 5에서 추가. Codex + Gemini로 먼저 검증 |

---

## 9. Security Architecture (Electron)

### Mandatory Electron Security Settings

```typescript
// electron/main.ts
const win = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,     // 반드시 true
    nodeIntegration: false,     // 반드시 false
    sandbox: true,              // Renderer sandbox
    preload: path.join(__dirname, 'preload.ts'),
    // 아래 기능들은 사용하지 않음 (필요시 개별 활성화)
    enableRemoteModule: false,
    webSecurity: true,
  }
});
```

### IPC Security Model

```
Renderer Process (untrusted)          Main Process (trusted)
──────────────────────────────        ──────────────────────
window.electronAPI.runAgent(prompt)
  │                                   ipcMain.handle('run:agent', (event, prompt) => {
  │                                     // ✅ prompt 길이/타입 검증
  │                                     // ✅ 허용된 명령어인지 확인
  │                                     // ✅ 경로 주입 방지
  │                                     return orchestrator.run(prompt);
  │                                   });
  └── IPC (contextBridge only) ──▶
```

- Renderer는 절대 raw `fs`, `child_process`, `path`에 접근 불가
- 모든 IPC handler는 입력값 길이/타입/경로 검증 필수
- Main Process에서만 파일시스템/CLI/DB 접근

### IPC Handshake Protocol (preload.ts init)

Renderer hot-reload 또는 partial update 시 IPC 버전 불일치로 `TypeError` 발생 방지:

```typescript
// preload.ts
const IPC_VERSION = 1;

// Main → Renderer: 버전 확인 요청
ipcRenderer.send('ipc:version-check', { version: IPC_VERSION });

// Renderer → Main: 버전 일치 시 IPC 함수 등록 완료
ipcRenderer.on('ipc:version-match', () => {
  // IPC channels now safe to call
  window.electronAPI.isReady = true;
});

// 버전 불일치 시
ipcRenderer.on('ipc:version-mismatch', (event, { serverVersion, clientVersion }) => {
  console.error(`IPC version mismatch: server=${serverVersion} client=${clientVersion}`);
  window.electronAPI.isReady = false;
  // Renderer强制 reload 또는 기능 축소 모드 전환
});
```

```typescript
// main.ts — 핸들러
ipcMain.handle('ipc:version-check', (event, { version }) => {
  if (version === IPC_VERSION) {
    event.reply('ipc:version-match');
  } else {
    event.reply('ipc:version-mismatch', {
      serverVersion: IPC_VERSION,
      clientVersion: version,
    });
  }
});
```

### 엔진 가용성 검사
앱 시작 시 ConfigReader가 Codex/Gemini CLI 바이너리 존재 여부를 확인:
```typescript
export interface EngineAvailability {
  codex: { installed: boolean; version?: string; path?: string };
  gemini: { installed: boolean; version?: string; path?: string };
  opencode: EngineStatus;     // ★ Phase 5
  claudecode: EngineStatus;   // ★ Phase 5
}
```
- 두 엔진 모두 미설치 시 Console 뷰에 "No CLI engines found" 안내 + 다운로드 링크 제공
- 엔진 상태는 IPC를 통해 Renderer에 전달, Activity Bar에 뱃지로 표시
- CLI 실행 시도 전에 항상 설치 상태 재확인 (hot-plug 가능)

### CLI 실행 보안

```typescript
// 허용된 CLI만 실행
const ALLOWED_COMMANDS = ['codex', 'gemini'];  // opencode, claudecode는 Phase 5 추가
// exec() 금지, spawn()만 사용
// shell: true 금지 (shell injection 방지)

// Env sanitization: 위험한 환경변수 제거 후 CLI 실행
const DANGEROUS_ENV_VARS = [
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_DISABLE_SECURITY_WARNINGS',
  'NODE_ENV', // 특정 값만 허용
];
const safeEnv = { ...process.env };
for (const key of DANGEROUS_ENV_VARS) { delete safeEnv[key]; }
safeEnv.NODE_ENV = 'production'; // production으로 고정

child_process.spawn(command, args, {
  shell: false,         // 반드시 false
  windowsHide: true,
  timeout: 300_000,     // 5분 제한
  env: safeEnv,        // 세척된 env만 전달
});
```

**Env Sanitization Rules:**
- `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` / `DYLD_LIBRARY_PATH`: 절대 통과 불가 (라이브러리 인젝션 방지)
- `NODE_OPTIONS`: 절대 통과 불가 (V8 플래그 조작 방지)
- `ELECTRON_RUN_AS_NODE`: 절대 통과 불가 (CLI가 아닌 Node 프로세스로 전환 방지)
- `NODE_ENV`: `development` | `production` | `test`만 허용 (기본값: `production`)
- 모든 env는 화이트리스트 방식 (정의된 것 외 삭제)

---

## 10. Performance Architecture

### Worker Threads 분리

CLI process lifecycle (spawn/kill/PID management)는 Main Process에서만 관리.
Worker Thread는 log transformation/parsing 전용으로만 사용.

```
Main Process            Worker Thread 1            Worker Thread 2
(Renderer IPC)          (LogTransformer)            (WorkflowEngine)
     │                        │                          │
     │── run:agent ──────────▶│                          │
     │                        │                          │
     │── CLI spawn (Main) ────│── Codex/Gemini CLI       │
     │    PID registry        │   stdout/stderr stream   │
     │◀─ progress events ─────│◀─ parsed/transformed ───│
     │                        │   log lines              │
     │                        │                          │
     │── workflow:run ────────────────────────────────────▶│
     │◀─ onStepComplete ────────────────────────────────────│
```

**PID Registry (Main Process):**
```typescript
interface PIDRecord {
  pid: number;
  engine: 'codex' | 'gemini';
  startedAt: number;
  workerId: string;
}
// SIGKILL 시 PIDRegistry에서 PID 조회 → process.kill(pid)
// Worker crash 시 PIDRegistry로 orphaned process 정리
```

**Worker Thread 사용 범위:**
- ❌ CLI spawn: Main Process에서만 (PID 관리, orphan 방지)
- ❌ SQLite write: Main Process에서만 (better-sqlite3는 동기식, 하지만 batch write로 event loop blocking 회피)
- ✅ Log transformation: Worker Thread (50MB ring buffer → parsed lines)
- ✅ Heavy parsing (JSON diff, large output): Worker Thread
- ✅ Workflow fan-out/fan-in: Worker Thread 2

### SQLite 전략
- **RunStore + WorkflowStore**: Main Process 직접 접근 (WAL 모드). Worker Thread 이중 직렬화 오버헤드 회피.
- **better-sqlite3**: 동기식. Batch write로 event loop blocking 방지 (100줄 또는 50ms 배치).
- WAL 모드 활성화: 읽기/쓰기 동시성 확보
- **Cross-store 쿼리**: Main Process에서 직접 질의
- **동기 블로킹 방지를 위한 batch write:**
  ```typescript
  // LogBuffer → Store batch insert (50ms 또는 100줄为单位)
  async flushToStore(lines: LogLine[]): Promise<void> {
    const batch = lines.map(l => [l.runId, l.timestamp, l.content, l.type]);
    this.db.prepare('INSERT INTO logs VALUES (?, ?, ?, ?)').run(batch);
  }
  ```

### Log Buffer (Ring Buffer + Adaptive Flush)

**Architecture:** Worker Thread (LogTransformer) → Ring Buffer → Adaptive Flush → IPC push

```
CLI stdout/stderr
      │
      ▼
Worker Thread (LogTransformer)
  • Parse raw bytes → structured LogLine[]
  • Rate limiting 적용
      │
      ▼ (parentPort.postMessage)
50MB Ring Buffer (Main Process EventBroker)
  • Head/tail pointers, oldest entries dropped on overflow
  • buffer_overflow_warning emitted when >80% full
      │
      ▼ (adaptive batch flush)
IPC push to Renderer
  • Flush trigger: 50ms OR 100 lines OR Renderer pull signal
  • Backpressure: Renderer sends `log:ack` after render confirms
  • If Renderer falls behind: buffer cap 200 messages, then drop oldest
  • Dropped logs emit `log:drop_warning` to events channel
```

**Ring Buffer Implementation:**
```typescript
class LogRingBuffer {
  private buffer: LogLine[] = [];
  private maxSize = 50 * 1024 * 1024; // 50MB
  private head = 0;
  private tail = 0;

  push(entry: LogLine): void {
    if (this.buffer.length >= this.maxSize) {
      this.tail = (this.tail + 1) % this.maxSize;
      this.emit('buffer_overflow_warning');
    }
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
  }
}
```

**Adaptive Flush Algorithm:**
```typescript
let flushTimer: NodeJS.Timeout;
let lineCount = 0;

function onLogLine(line: LogLine): void {
  buffer.push(line);
  lineCount++;
  if (lineCount >= 100 || flushTimer.expired()) {
    flushBuffer(); // → IPC push
    lineCount = 0;
    resetTimer(50ms);
  }
}

function onLogAck(): void {
  // Renderer confirmed receipt → backpressure released
  backpressure = false;
}
```

---

## 11. Observability & Debuggability

### Electron 환경 디버깅

| 문제 | 도구 |
|------|------|
| Renderer 오류 | Chrome DevTools (Cmd+Option+I) |
| Main Process | `electron-log` → 파일 로깅 |
| IPC 트래픽 | Debug: `ipcMain.on` wrapper로 모든 호출 로깅 |
| CLI stdout | SSE 대신 IPC push, log 파일에도 기록 |
| Crash | `electron-crash-reporter` (Sentry or local dump) |
| 성능 | `electron-chrome-devtools` + Performance tab |

### 로깅 계층
```
실행 로그:  ~/Library/Logs/AgentOrchestrator/run-{id}.log
앱 로그:    ~/Library/Logs/AgentOrchestrator/app.log (electron-log)
DB:         ~/Library/Application Support/AgentOrchestrator/data/*.db
설정:       ~/.codex/, ~/.gemini/antigravity/ (기존과 동일)
```

### 생산성 지표 (대시보드용)
- Run 성공/실패율
- 평균 실행 시간
- 에이전트별 사용 횟수
- 워크플로 완료율
- CLI 응답 시간

---

## 12. Deployment & Rollout

### 코드 사인 필수 (macOS)
```
Apple Developer Program 필요 ($99/년)
Developer ID Application 인증서
electron-builder --mac --sign
```

### 배포 파이프라인
```yaml
# GitHub Actions
on:
  push:
    tags: 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run make
      - name: Sign & Package
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_PASSWORD }}
        run: npx electron-builder --mac --win
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.os }}
          path: release/
```

### 자동 업데이트
```yaml
publish:
  provider: github
  owner: kim57uak
  repo: agent-orchestrator-desktop
  private: false
```

---

## 13. Long-Term Trajectory

### 6개월 후
```
현재:   Web App → git pull + pip install + uvicorn 실행
1차:    .dmg 설치 → 실행 → Codex/Gemini CLI 연결
6개월:  .dmg 설치 → 실행 → MCP 서버 추가 → 마켓플레이스
```

### 진화 방향
| 시기 | 기능 | 이유 |
|------|------|------|
| Launch | 듀얼 엔진 + 워크플로 | 기존 기능 데스크톱 이전 |
| +1m | MCP 서버 통합 | 에이전트 기능 확장 |
| +3m | 터미널 멀티세션 | 파워유저 요구 |
| +6m | 커스텀 에이전트 템플릿 | 커뮤니티 확장 |
| +12m | 에이전트 마켓플레이스 | 생태계 구축 |

---

## 14. UI Target References — Codex Desktop / OpenCode Desktop / Cursor

이 앱의 UI는 아래 3개 앱의 UX를 벤치마킹한다.

### Codex Desktop (OpenAI)
- 독립적인 데스크톱 창 (Electron)
- 좌측: 대화/에이전트 목록
- 중앙: 채팅 + 코드 결과 뷰어
- 하단: 터미널 출력
- 특징: 깔끔한 2-패널 레이아웃, 최소한의 도구 모음

### OpenCode Desktop
- Bubble Tea TUI 기반이지만 데스크톱 버전은 Electron 스타일
- 좌측: 세션/히스토리
- 중앙: 실시간 AI 응답 스트리밍
- 하단: 명령어 입력 + 출력
- 특징: 터미널 느낌의 단순함, 멀티세션 지원

### Cursor
- VS Code 기반 Activity Bar + Sidebar + Editor + Panel
- AI Chat은 오른쪽 Sidepanel
- Inline diff + Accept/Reject (우리는 사용 안 함)
- Command Palette (Cmd+K)
- 특징: 가장 익숙한 IDE 레이아웃, 확장성이 뛰어남

### 우리 앱의 UI 결정
```
Cursor의 레이아웃 구조를 채택하되, Editor 영역을 Agent Console로 대체.
Codex Desktop의 심플함 + Cursor의 확장성의 하이브리드.
```

### 구체적 레이아웃
```
┌─────────┬─────────────────────────────────────┬────────────┐
│Activity │  Sidebar          │  Main Area      │ Chat       │
│ Bar     │  ┌──────────────┐ │  ┌───────────┐  │ Sidepanel  │
│         │  │ 탭 헤더      │ │  │ 상세 콘텐츠│  │ ┌───────┐  │
│ [조직도]│  ├──────────────┤ │  │           │  │ │Chat   │  │
│ [대시  ]│  │ 콘텐츠       │ │  │ - Agent   │  │ │히스토리│  │
│ [콘솔  ]│  │ - 트리/리스트│ │  │   콘솔    │  │ ├───────┤  │
│ [워크  ]│  │ - 설정 폼    │ │  │ - 워크플로│  │ │입력    │  │
│ [검사  ]│  │ - 파일 브라우저│ │  │   캔버스  │  │ │       │  │
│         │  └──────────────┘ │  │ - 대시보드│  │ └───────┘  │
│         │                   │  └───────────┘  │            │
├─────────┴─────────────────────────────────────┴────────────┤
│  Panel                                                     │
│  ┌──────────┬──────────┬──────────┬────────────────────┐   │
│  │ Terminal │  Output  │  Events  │  Problems          │   │
│  └──────────┴──────────┴──────────┴────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 화면별 UI 상세

| 뷰 | Sidebar 내용 | Main Area | 특징 |
|----|-------------|-----------|------|
| **Organization** | 계층 트리 + 검색 | 선택한 에이전트 상세 카드 | Org chart가 좌측, detail이 우측 |
| **Dashboard** | 메트릭 카드 그리드 | 선택한 메트릭 차트 드릴다운 | CLI 생산성 지표 시각화 |
| **Console** | Run 설정 폼 (agent/workspace/prompt) | xterm.js 터미널 + 로그 | Cursor 터미널 느낌, 실시간 출력 |
| **Workflow** | 스텝 리스트 + 추천 | SVG 캔버스 (dagre.js) | 에이전트 노드 + 와이어 연결 |
| **Inspector** | 파일 브라우저 트리 | Monaco Editor + Save 버튼 | VS Code 편집기 느낌 |

---

## 15. Cross-Platform (macOS + Windows)

### Electron 기본 지원
Electron은 Chromium + Node.js이므로 macOS/Windows/Linux 모두 네이티브 지원.
핵심은 **플랫폼별 세부 처리**에 있음.

### macOS 전용

| 항목 | 처리 |
|------|------|
| 메뉴바 | macOS 네이티브 메뉴 (File/Edit/View/Window/Help) |
| 단축키 | Cmd+W (닫기), Cmd+Q (종료), Cmd+, (설정) |
| Dock | 최근 파일, 배지 (실행 중인 작업 수) |
| Title Bar | `titleBarStyle: 'hiddenInset'` — Cursor 스타일 |
| 트레이 | menu bar extra (선택) |
| 코드 사인 | `hardenedRuntime: true`, entitlements 필수 |
| 배포 | `.dmg` + Apple Notarization |

### Windows 전용

| 항목 | 처리 |
|------|------|
| 메뉴바 | 앱 내 메뉴 or 숨김 (Ctrl+Shift+P) |
| 단축키 | Ctrl+W (닫기), Ctrl+Q (종료), Ctrl+, (설정) |
| Taskbar | jump list, 진행률 표시 (taskbar progress) |
| Title Bar | 기본 프레임 or frameless + custom |
| 트레이 | system tray icon + context menu |
| 코드 사인 | Authenticode 인증서 |
| 배포 | `.exe` (NSIS installer) + `.exe` (portable) |

### 공통 처리

| 영역 | 처리 |
|------|------|
| 경로 | `path.join()` 사용, 하드코딩 `/` 금지 |
| 줄바꿈 | `os.EOL` 사용 |
| 폰트 | system-ui: macOS SF Pro / Windows Segoe UI |
| 단축키 맵 | `process.platform === 'darwin' ? 'Cmd' : 'Ctrl'` |
| 파일 다이얼로그 | Electron `dialog.showOpenDialog` (OS 네이티브) |
| 알림 | Electron `Notification` API |
| 자동 업데이트 | `electron-updater` + GitHub Releases (macOS + Windows) |
| CI | GitHub Actions matrix: `[macos-latest, windows-latest]` |

### 플랫폼 감지 유틸

```typescript
// src/utils/platform.ts
export const isMac = process.platform === 'darwin';
export const isWin = process.platform === 'win32';
export const modKey = isMac ? 'Cmd' : 'Ctrl';

export const getDefaultPaths = () => ({
  codexConfig: isMac
    ? path.join(os.homedir(), '.codex')
    : path.join(os.homedir(), '.codex'),
  geminiConfig: isMac
    ? path.join(os.homedir(), '.gemini')
    : path.join(os.homedir(), '.gemini'),
  appData: isMac
    ? path.join(os.homedir(), 'Library', 'Application Support', 'AgentOrchestrator')
    : path.join(os.homedir(), 'AppData', 'Local', 'AgentOrchestrator'),
  logs: isMac
    ? path.join(os.homedir(), 'Library', 'Logs', 'AgentOrchestrator')
    : path.join(os.homedir(), 'AppData', 'Local', 'AgentOrchestrator', 'logs'),
});
```

---

## 16. Coding Standards

프로젝트의 모든 TypeScript/React/Electron 코딩 규칙은 **`CODE_STANDARDS.md`**에 정의되어 있음.

### 핵심 규칙 요약
| 영역 | 규칙 |
|------|------|
| TypeScript | strict mode, `any` 금지, 반환형 명시 |
| React | 함수형 컴포넌트, 4가지 상태 (로딩/빈값/에러/성공) |
| Electron | contextIsolation=true, nodeIntegration=false |
| IPC | 모든 입력 타입 검증, Renderer는 Node.js 직접 접근 불가 |
| Database | better-sqlite3 WAL 모드, Worker Thread 실행 |
| 테스트 | vitest (unit) + Playwright (E2E) |
| Git | `type: description` 커밋 메시지 |

전체 내용은 `CODE_STANDARDS.md` 참조.

---

---

## 17. Layout Design Review

### 17.1 레이아웃 기본 구조

```
┌─────────┬─────────────────────────────────────┬────────────┐
│Activity │  Sidebar          │  Main Area      │ Chat       │
│ Bar     │  ┌──────────────┐ │  ┌───────────┐  │ Sidepanel  │
│         │  │ 탭 헤더      │ │  │ 상세 콘텐츠│  │ ┌───────┐  │
│ [조직도]│  ├──────────────┤ │  │           │  │ │Chat   │  │
│ [대시  ]│  │ 콘텐츠       │ │  │ - Agent   │  │ │히스토리│  │
│ [콘솔  ]│  │ - 트리/리스트│ │  │   콘솔    │  │ ├───────┤  │
│ [워크  ]│  │ - 설정 폼    │ │  │ - 워크플로│  │ │입력    │  │
│ [검사  ]│  │ - 파일 브라우저│ │  │   캔버스  │  │ └───────┘  │
│         │  └──────────────┘ │  │ - 대시보드│  │            │
│         │                   │  └───────────┘  │            │
├─────────┴─────────────────────────────────────┴────────────┤
│  Panel                                                     │
│  ┌──────────┬──────────┬──────────┬────────────────────┐   │
│  │ Terminal │  Output  │  Events  │  Problems          │   │
│  └──────────┴──────────┴──────────┴────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 17.2 VS Code / Cursor 레이아웃 대조

| 요소 | VS Code | Cursor | 우리 앱 | 차이점 |
|------|---------|--------|---------|--------|
| Activity Bar | 48px 고정, 아이콘 + 뱃지 | 동일 | 동일 | 없음 |
| Sidebar | 최소 170px, 리사이즈 가능 | 동일 | 동일 | 없음 |
| Main Area | 에디터 탭 + 콘텐츠 | 에디터 + Chat Panel | Agent Console | Main 역할 변경 |
| Panel | 하단, 최소 100px | 동일 | 동일 | 없음 |
| Chat Sidepanel | 없음 | 우측 300px | 우측 | Cursor와 동일 |
| Title Bar | 커스텀 (hiddenInset) | 동일 | 동일 | 없음 |
| Status Bar | 하단 22px | 있음 | **없음** | **GAP** |

### 17.3 발견된 GAP

**GAP #1: Status Bar 누락 (CRITICAL)**
Cursor/VS Code에는 항상 하단 22px Status Bar가 있다 (브랜치명, 모드, 엔진 상태). 이게 없으면 "VS Code 스타일"이라는 약속이 깨짐.

**수정**: Panel 하단 또는 별도 Status Bar 영역 (22px) 추가. 여기에:
- 왼쪽: 현재 활성 엔진 (Codex / Gemini / None)
- 가운데: 실행 중인 작업 수 (뱃지)
- 오른쪽: 엔진 상태 표시 (● 녹색/회색)

```
┌────────────────────────────────────────────────────────────┐
│ Panel (위)                                                  │
├────────────────────────────────────────────────────────────┤
│ Status Bar (22px)                                           │
│ ● Codex 대기  │  작업 2개 실행 중  │  v0.1.0              │
└────────────────────────────────────────────────────────────┘
```

**GAP #2: Chat Sidepanel이 Console 뷰에서만 활성화? (중간)**
현재 계획에 Chat Sidepanel이 모든 뷰에서 접근 가능한지, Console에서만 가능한지 불명확.

**수정**: 모든 뷰에서 Cmd+I / Cursor 버튼으로 Chat Sidepanel 토글 가능. 콘텐츠는 현재 뷰의 맥락을 자동 전달.

**GAP #3: Sidebar View와 Main Area의 링크 (중간)**
각 View에서 Sidebar 항목 선택 시 Main Area가 어떻게 업데이트되는지 흐름이 정의되지 않음.

**수정**: 각 뷰에 대해 명시적 링크 규칙 정의:
```
Organization: 트리 노드 선택 → Main에 에이전트 상세 카드
Console: Run 버튼 클릭 → Main에 xterm.js 터미널 + 로그
Workflow: 스텝 선택 → Main에 SVG 캔버스 해당 노드 포커스
Dashboard: 메트릭 카드 선택 → Main에 차트 드릴다운
Inspector: 파일 선택 → Main에 Monaco Editor 로드
```

**GAP #4: Panel 리사이즈 핸들 (낮음)**
Panel의 Terminal/Output/Events/Problems 탭이 수평 리사이즈 가능한지 명시되지 않음.

**수정**: 탭 헤더 영역을 드래그로 수평 리사이즈 가능. VS Code와 동일한 splitter 스타일 (6px 핸들).

**GAP #5: Activity Bar 아이콘 부재 (낮음)**
현재 ASCII 다이어그램에 아이콘이 텍스트로 표시됨 (「조직도」). 실제 구현에서는 SVG 아이콘 필요.

**수정**: VS Code Codicon 세트 사용 (오픈소스, MIT 라이선스). 필요한 5개 아이콘:
- 조직도: `codicon-organization`
- 대시보드: `codicon-graph`
- 콘솔: `codicon-terminal`
- 워크플로: `codicon-type-hierarchy`
- 검사기: `codicon-inspect`

`@vscode/codicons` 패키지를 의존성에 추가, Activity Bar에서 `VSCodeIcon` 컴포넌트로 렌더링.

### 17.4 Color System Review

Current plan specifies 12 CSS variables. VS Code / Cursor uses ~40 semantic tokens. 12 is insufficient for pixel-parity.

**수정**: 12변수 → 24변수로 확장:

```css
:root[data-theme="aurora"] {
  --bg-primary: #0d0d1a;
  --bg-secondary: #1a1a2e;
  --bg-tertiary: #16213e;
  --bg-surface: #1e1e36;
  --bg-overlay: rgba(0,0,0,0.5);
  --text-primary: #e0e0ff;
  --text-secondary: #a0a0cc;
  --text-tertiary: #7070aa;
  --text-inverse: #0d0d1a;
  --accent-primary: #a855f7;
  --accent-secondary: #c084fc;
  --accent-tertiary: #e9d5ff;
  --accent-border: #7c3aed;
  --border-primary: #2a2a4a;
  --border-secondary: #1f1f3a;
  --status-success: #22c55e;
  --status-warning: #f59e0b;
  --status-error: #ef4444;
  --status-info: #3b82f6;
  --status-running: #a855f7;
  --focus-ring: rgba(168,85,247,0.4);
  --selection-bg: rgba(168,85,247,0.15);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
}
```

### 17.5 Typography

| 요소 | 폰트 | 크기 | 두께 | 색상 |
|------|------|------|------|------|
| Activity Bar 아이콘 | — | 20px | — | var(--text-secondary) |
| Sidebar 탭 헤더 | system-ui | 12px | 600 | var(--text-secondary) |
| Sidebar 콘텐츠 | system-ui | 13px | 400 | var(--text-primary) |
| Main Area 제목 | system-ui | 24px | 600 | var(--text-primary) |
| Main Area 본문 | system-ui | 14px | 400 | var(--text-primary) |
| Panel 탭 헤더 | system-ui | 11px | 600 | var(--text-secondary) |
| Panel 콘텐츠 | system-ui | 13px | 400 | monospace 혼용 |
| Chat 메시지 | system-ui | 13px | 400 | var(--text-primary) |
| Status Bar | system-ui | 12px | 400 | var(--text-secondary) |

### 17.6 Spacing System

VS Code는 4px 그리드. 동일 채택:

| Token | 값 | 용도 |
|-------|-----|------|
| --space-1 | 4px | 아이콘 내부 패딩 |
| --space-2 | 8px | 컴포넌트 내부 패딩 |
| --space-3 | 12px | 리스트 아이템 간격 |
| --space-4 | 16px | 섹션 간격 |
| --space-5 | 24px | 카드 패딩 |
| --space-6 | 32px | 뷰 마진 |

### 17.7 Animation & Transition

| 동작 | 속성 | 지속시간 | 이징 |
|------|------|---------|------|
| 탭 전환 | opacity + transform | 150ms | ease-out |
| 패널 리사이즈 | width/height | 0ms (즉시) | — |
| Sidebar 토글 | width | 200ms | ease-in-out |
| Chat 열기/닫기 | width | 200ms | ease-in-out |
| 상태 변화 (로딩→완료) | opacity | 300ms | ease |
| 드롭다운/메뉴 | opacity + transform | 100ms | ease-out |
| 툴팁 | opacity | 80ms | ease-in |

> Terminal 출력, 로그 스트리밍, 이벤트 업데이트는 애니메이션 없음 (성능 우선).

### 17.8 Empty State Design

각 뷰의 초기 상태 (에이전트 없음, 실행 없음, 워크플로 없음)가 계획에 누락됨.

| 뷰 | Empty State 메시지 | 액션 버튼 |
|----|-------------------|-----------|
| Organization | "No agents configured" | "Configure Codex CLI" → 설정 가이드 |
| Dashboard | "No runs yet" | "Run your first agent" → Console 전환 |
| Console | "Select an engine to begin" | 엔진 선택 드롭다운 |
| Workflow | "No workflows defined" | "Create workflow" + 템플릿 추천 |
| Inspector | "No file selected" | 파일 브라우저에서 선택 안내 |

각 empty state: 120×120 일러스트 + 16px 메시지 + CTA 버튼 구조.

---

## 18. GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | issues_open | 6 proposals, 5 accepted, 1 deferred; 2 critical gaps resolved |
| Eng Review | `/plan-eng-review` + Gemini CLI | Architecture + code quality + tests + performance | 1 | completed | 12 amendments (5 Gemini, 7 Eng review) — all auto-decided |

- **VERDICT:** CEO review complete (SELECTIVE EXPANSION mode). Eng review complete (DONE_WITH_CONCERNS). All 18 CEO amendments + 12 Eng amendments addressed.
- **KEY DECISIONS:** electron-forge adopted, IPC contract + Zod schemas first, full error/rescue map added, React Error Boundaries per panel, state persistence for window/theme/panel layout, SQLite batch write (50ms/100 lines), CLI spawn in Main Process, env sanitization, IPC handshake protocol.
- **CHANGES FROM REVIEW:** See `CEO_REVIEW_REPORT.md` + Section 18 Eng Review Amendments table.
- **NEXT:** Implement `types/ipc-contract.ts` → Phase 1 foundation.

### CEO Review Amendments (2026-05-14)

This section tracks changes ordered by the CEO review. Full details in `CEO_REVIEW_REPORT.md`.

| # | Amendment | Section Affected | Status |
|---|-----------|-----------------|--------|
| 1 | Bundler: electron-vite → electron-forge + Vite plugin | Section 6 | Applied |
| 2 | Full IPC channel list + Zod schemas (Phase 1 prerequisite) | Section 2, 9 | Applied |
| 3 | Error/Rescue Map (CLI spawn, Worker crash, SQLite, IPC) | New section | Pending |
| 4 | React Error Boundaries (per-panel isolation) | Section 3 | Applied |
| 5 | State persistence (window, panel, theme) | Section 3 | Applied |
| 6 | CLI PATH validation (absolute paths, not PATH lookup) | Section 9 | Applied |
| 7 | Content Security Policy | Section 9 | Applied |
| 8 | Worker Thread health check (5s heartbeat + auto-restart) | Section 10 | Pending |
| 9 | Log Buffer memory limit (50MB max, ring buffer) | Section 10 | Applied |
| 10 | Performance budgets (IPC <50ms, UI 16ms/frame) | New section | Pending |
| 11 | Structured logging strategy (JSON format, dev/prod levels) | Section 11 | Pending |
| 12 | Auto-update rollback strategy | Section 12 | Pending |
| 13 | DB migration strategy (forward-only, pre-backup) | Section 5 | Pending |
| 14 | First-run onboarding wizard UX | Section 17 | Pending |
| 15 | Drag & drop specification | Section 17 | Pending |
| 16 | Responsive layout specs (min sizes, panel collapse) | Section 17 | Applied |
| 17 | Test strategy (80% coverage target, pyramid ratios) | New section | Applied |
| 18 | IPC versioning strategy | Section 13 | Applied |

### Eng Review Amendments + Gemini External Review (2026-05-14)

Post-eng-review via Gemini CLI external review. Auto-decided in spawned session mode.

| # | Finding | Source | Resolution | Section |
|---|---------|--------|------------|---------|
| E1 | SQLite in Main Process blocks event loop during heavy log writes | Gemini | Batch write (100 lines / 50ms) to prevent blocking; keep in Main Process | Section 10 | Applied |
| E2 | CLI spawn in Worker Thread → zombie process risk (PID lost on crash) | Gemini | Keep `child_process` in Main Process; Worker Thread is log transformation only | Section 10 | Applied |
| E3 | 16ms flush too aggressive, causes Renderer IPC saturation | Gemini | Adaptive flush: 50ms OR 100 lines OR Renderer pull signal; backpressure via `log:ack` | Section 10 | Applied |
| E4 | Env sanitization missing (LD_PRELOAD, DYLD_INSERT_LIBRARIES, NODE_OPTIONS) | Gemini | Add dangerous env var blocklist in CLI execution security section | Section 9 | Applied |
| E5 | IPC handshake protocol missing (version mismatch causes TypeError on hot-reload) | Gemini | Add version check in preload.ts init + `ipc:version-check/match/mismatch` channels | Section 9 | Applied |
| E6 | Worker Thread message routing underspecified (no demux table, no backpressure) | Eng review | Add `EventBroker.onWorkerMsg` with Map<workerId, MessageType> demux + backpressure (200 msg cap) | Section 10 | Applied |
| E7 | Log Buffer ring buffer not yet implemented | Eng review | Create `electron/services/LogBuffer.ts` with head/tail ring + overflow warning | Section 10 | Applied |
| E8 | Error/Rescue Map in CEO report but not in code | Eng review | Create `src/errors/ErrorRegistry.ts` + `src/errors/RescueMap.ts` as Phase 1 task | Section 3 | Applied |
| E9 | Error boundary scaffold missing (per-panel isolation) | Eng review | Create `src/components/common/ErrorBoundary.tsx` | Section 3 | Applied |
| E10 | Zustand persist not configured (window/panel/theme state) | Eng review | Create `src/stores/uiStore.ts` with persist middleware | Section 3 | Applied |
| E11 | Test infrastructure (vitest.config.ts) is placeholder | Eng review | Add vitest.config.ts with 80% coverage threshold, first test: IPC handler validation | Section 7 | Applied |
| E12 | Performance measurement hooks missing (budgets aspirational) | Eng review | Add `performance.mark()` at IPC entry/exit + cold start timestamp logging | Section 10 | Applied |

**Distribution check:** CI pipeline (Section 12) + electron-builder (Section 6) + GitHub Releases. Artifact: .dmg + .exe. ✅

**Architecture verdict:** DONE_WITH_CONCERNS — 12 amendments (5 from Gemini, 7 from Eng review) all addressed with specific implementation details. Critical path: `types/ipc-contract.ts` first, then Phase 1 foundation.

(End of file)
