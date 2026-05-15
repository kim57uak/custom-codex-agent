# Coding Standards

## Stack

| 계층 | 기술 | 버전 |
|------|------|------|
| Desktop Shell | Electron | latest stable |
| Bundler | electron-forge + Vite plugin | latest |
| Language | TypeScript | strict mode |
| UI | React 18+ | functional components + hooks |
| State | Zustand | no Redux |
| Database | better-sqlite3 | WAL mode |
| Terminal | xterm.js + node-pty | |
| UI Toolkit | @vscode/webview-ui-toolkit | |
| Editor | monaco-editor | Inspector 전용 |
| Testing | vitest + @playwright/test | |
| Packaging | electron-builder | |
| Update | electron-updater | GitHub releases |

---

## 1. TypeScript Rules

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- `any` 사용 금지. `unknown` → 타입 가드로 좁히기
- 함수 반환형 항상 명시
- `as` 타입 단언 금지 (타입 가드 사용)
- `null`보다 `undefined` 사용. `??` 연산자로 기본값 처리

---

## 2. Naming Conventions

| 항목 | 규칙 | 예시 |
|------|------|------|
| 파일/디렉토리 | PascalCase (컴포넌트), camelCase (서비스/유틸) | `RunOrchestrator.ts`, `formatDate.ts` |
| React 컴포넌트 | PascalCase | `ActivityBar.tsx`, `OrgView.tsx` |
| 함수 | camelCase, 동사+명사 | `getAgentList()`, `handleRunSubmit()` |
| 인터페이스 | PascalCase, `I` 접두사 없음 | `AgentConfig`, `RunOptions` |
| 타입 | PascalCase, `T` 접두사 없음 | `RunStatus`, `EngineType` |
| 상수 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT` |
| IPC 채널 | `domain:action` | `run:agent`, `workflow:create` |
| CSS 변수 | `--kebab-case` | `--bg-primary`, `--text-secondary` |
| SQLite 테이블 | snake_case | `run_events`, `workflow_steps` |

---

## 3. Project Structure Rules

```
electron/           # Main Process — 절대 UI import 금지
  main.ts           # BrowserWindow 생성, 앱 수명주기
  preload.ts        # contextBridge — 여기만 Node API 노출
  ipc/              # IPC 핸들러 — 모든 입력 검증
  services/         # 비즈니스 로직
  orchestrator/     # 워크플로/런 상태 머신
  adapters/         # CLI 엔진 어댑터
  stores/           # SQLite 접근

src/                # Renderer Process — 절대 Node API 직접 호출 금지
  main.tsx          # React 진입점
  components/       # UI 컴포넌트
    layout/         # ActivityBar, Sidebar, MainArea, Panel
    views/          # OrgView, DashboardView 등 5개 뷰
    ai-chat/        # ChatSidepanel
    common/         # 공통 컴포넌트
  stores/           # Zustand 스토어 (상태만, I/O 없음)
  hooks/            # IPC wrapper hooks (useInvoke, useOnEvent)
  types/            # 공유 타입
```

### 레이어 의존성 규칙
```
Renderer (src/)  ──IPC──▶  Main (electron/)
    │                        │
    │ UI만                    │ I/O, CLI, DB, FS
    │ 절대 fs/child_process   │
    │ 직접 import 금지        │
    ▼                        ▼
  React                    Node.js
```

---

## 4. React Component Rules

```typescript
// ✅ 올바른 패턴
const OrgView: React.FC<{ agentId?: string }> = ({ agentId }) => {
  const agents = useAgentStore(s => s.agents);
  const { data, isLoading } = useIpc('agents:list');

  if (isLoading) return <LoadingSpinner />;
  if (!data?.length) return <EmptyState message="No agents found" />;

  return <AgentTree items={data} selectedId={agentId} />;
};
```

- 모든 컴포넌트는 **로딩/비어있음/에러/성공 4가지 상태** 커버
- `useEffect` 최소화. Zustand + IPC hooks로 대체
- 컴포넌트당 200줄 초과 금지 → 분할
- 스타일은 CSS Variables + className, 인라인 스타일 금지

---

## 5. Electron Security (필수)

```typescript
// main.ts — BrowserWindow 생성
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,     // 필수
    nodeIntegration: false,     // 필수
    sandbox: true,              // 필수
    preload: path.join(__dirname, '../preload.js'),
    enableRemoteModule: false,
  }
});

// preload.ts — contextBridge만 사용
contextBridge.exposeInMainWorld('electronAPI', {
  runAgent: (prompt: string) => ipcRenderer.invoke('run:agent', prompt),
  onProgress: (cb: Handler) => ipcRenderer.on('run:progress', (_e, d) => cb(d)),
});
```

---

## 6. IPC 핸들러 규칙

```typescript
// ✅ 올바른 패턴
ipcMain.handle('run:agent', async (event, prompt: unknown) => {
  // 1. 타입 검증 (Renderer는 신뢰 불가)
  if (typeof prompt !== 'string' || prompt.length > 100_000) {
    throw new AppError('INVALID_INPUT', 'Prompt must be string, max 100KB');
  }
  // 2. 허용된 도메인인지 확인
  // 3. 실행
  return orchestrator.run(prompt);
});
```

---

## 7. Database 접근 규칙

```typescript
// stores/RunStore.ts
import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';

// Main Process에서 Worker Thread로 실행
// Renderer에서 절대 직접 호출 금지
export class RunStore {
  private db: Database.Database;

  constructor() {
    this.db = new Database(path, { /* WAL mode */ });
    this.db.pragma('journal_mode = WAL');
  }

  getRun(id: string): RunRecord | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined;
  }
}
```

---

## 8. Git Convention

| 항목 | 규칙 |
|------|------|
| 브랜치명 | `feat/`, `fix/`, `chore/`, `refactor/` 접두사 |
| 커밋 메시지 | `type: description` — 영어 소문자 |
| 커밋 단위 | 기능 단위로 쪼개기. WIP 커밋 가능 (continuous checkpoint) |

---

## 9. Error Handling

```typescript
// 구체적인 에러 클래스 사용. catch (e) 금지
export class AppError extends Error {
  constructor(
    public code: string,      // 'TIMEOUT', 'INVALID_INPUT'
    message: string,
    public userMessage?: string  // 사용자에게 보여줄 메시지
  ) {
    super(message);
  }
}
```

- 모든 에러는 `code` + `userMessage`를 가짐
- CLI 실행 실패, DB 오류, IPC 검증 실패 각각 별도 처리
- 사용자에게는 기술적 내용 없이 `userMessage`만 표시

---

## 10. Testing Rules

```typescript
// vitest — 단위 테스트
describe('RunOrchestrator', () => {
  it('should queue run when semaphore is full', () => { /* ... */ });
  it('should reject empty prompts', () => { /* ... */ });
});

// @playwright/test — E2E
test('should show agent list in OrgView', async ({ page }) => {
  await page.waitForSelector('[data-testid="agent-tree"]');
  expect(await page.locator('.agent-node').count()).toBeGreaterThan(0);
});
```

---

## 11. Code Review Checklist

- [ ] 모든 IPC 입력 타입 검증?
- [ ] 모든 컴포넌트 4가지 상태 (로딩/빈값/에러/성공)?
- [ ] `any` 타입 없음?
- [ ] `catch (e)` / `try { }` broad catch 없음?
- [ ] 에러에 `code` + `userMessage`?
- [ ] SQLite WAL 모드?
- [ ] new BrowserWindow 보안 설정 적용?
- [ ] 크로스플랫폼 경로 처리 (path.join, / vs \\)?
- [ ] 모든 비즈니스 로직/트레이드오프에 rationale 주석? (Karpathy #1)
- [ ] 요청 범위를 넘는 speculative abstraction 없음? (Karpathy #2)
- [ ] 변경이 기존 코드 포맷/구조를 건드리지 않음? (Karpathy #3)
- [ ] magic string/number 대신 named constant/enum? (Karpathy #5)
- [ ] `never` 타입으로 exhaustive switch 검증?
- [ ] 모든 IPC 핸들러에 타임아웃 + 입력 길이 제한?

---

## 12. Karpathy Coding Guidelines

Andrej Karpathy의 LLM 코딩 오류 감소 원칙을 프로젝트 전반에 적용한다.

### #1: Think Before Coding (Don't assume. Surface tradeoffs.)

- 구현 전 **가정을 명시적으로 주석**으로 작성. 불확실하면 멈추고 질문
- 복수의 해석이 가능하면 하나를 조용히 선택하지 말고 **트레이드오프를 제시**
- 더 간단한 접근이 있다면 **push back** — 요구사항에 정당한지 질문
- **Mandatory Commenting**: 모든 비즈니스 로직, 트레이드오프, 비직관적 최적화에 rationale 주석 필수
- 요구사항이 가이드라인과 충돌하면 무시하지 말고 **명시적으로 확인**

### #2: Simplicity First (Minimum code. Nothing speculative.)

- 요청 범위를 넘는 기능 금지
- 단일 사용처인 코드에 추상화 금지
- 요청받지 않은 "유연성" 또는 "설정 가능성" 금지
- 불가능한 시나리오에 대한 에러 처리 금지
- 200줄을 50줄로 줄일 수 있으면 리팩터링

**기준**: "시니어 엔지니어가 이거 과하게 복잡하다고 할까?" → Yes면 단순화.

### #3: Surgical Changes (Touch only what you must.)

- 인접 코드, 기존 주석, 포맷팅을 **개선하지 않는다**
- 고장나지 않은 것을 리팩터링하지 않는다
- 기존 스타일이 마음에 들지 않아도 **맞춘다**
- 내 변경으로 생긴 **orphan import/변수/함수만 정리**한다. 기존 dead code는 건드리지 않는다

**원칙**: 모든 변경 라인은 사용자 요청에 직접 trace 가능해야 한다.

### #4: Goal-Driven Execution (Define success. Loop until verified.)

- "검증 추가" → "invalid input 테스트를 먼저 작성하고 통과시킨다"
- "버그 수정" → "재현 테스트를 먼저 작성하고 통과시킨다"
- "리팩터링" → "전후 테스트 통과 확인"
- 멀티스텝 작업은 다음 형식으로 작성:
  ```
  1. [스텝] → verify: [검증 방법]
  2. [스텝] → verify: [검증 방법]
  ```

### #5: Standard Practices (SOLID + No Hardcoding)

**Junior-Friendly SOLID**: 주니어가 이해할 수 있을 만큼 단순하면서도 SOLID 원칙을 엄격히 준수:
- **S**ingle Responsibility: 하나의 클래스/함수는 하나의 책임
- **O**pen/Closed: 확장에는 열림, 수정에는 닫힘
- **L**iskov Substitution: 서브타입은 베이스타입을 대체 가능
- **I**nterface Segregation: 클라이언트는 사용하지 않는 메서드에 의존하지 않음
- **D**ependency Inversion: 추상화에 의존, 구체화에 의존하지 않음

**No Hardcoding**: 코드-유사 데이터, magic string/number를 Enum 또는 named constant로 승격:
```typescript
// ❌ Wrong
const result = await spawn('codex', ['-p', prompt, '--model', 'claude-sonnet-4-20250514']);

// ✅ Correct
const CODEX_BINARY = 'codex' as const;
const MODEL = 'claude-sonnet-4-20250514' as const;
const MAX_PROMPT_LENGTH = 100_000;
const result = await spawn(CODEX_BINARY, ['-p', prompt, '--model', MODEL]);
```

---

## 13. CEO Review Amendments (2026-05-14)

> Full details: `CEO_REVIEW_REPORT.md`

### 13.1 Error Boundaries

모든 주요 UI 패널(ActivityBar, Sidebar, MainArea, Panel)은 독립적인 `ErrorBoundary`로 감싼다. 한 패널의 크래시가 전체 앱을 다운시키지 않도록 격리.

```typescript
// components/common/ErrorBoundary.tsx
<ErrorBoundary fallback={<PanelCrashFallback panelName="Console" onRetry={retry} />}>
  <ConsoleView />
</ErrorBoundary>
```

### 13.2 State Persistence

창 크기, 패널 레이아웃, 테마 선택은 `localStorage`에 저장. 앱 재시작 시 복원.

```typescript
// stores/ui-store.ts — Zustand persist middleware
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      windowBounds: DEFAULT_BOUNDS,
      sidebarWidth: 280,
      panelHeight: 200,
      activeTheme: 'aurora',
      // ...
    }),
    { name: 'agent-orchestrator-ui' }
  )
);
```

### 13.3 Performance Budgets

| 항목 | 타겟 | 측정 방법 |
|------|------|----------|
| IPC 라운드트립 | <50ms | `performance.now()` |
| UI 프레임 타임 | 16ms (60fps) | Chrome DevTools Performance |
| 앱 콜드 스타트 | <3초 | electron 타이밍 |
| CLI stdout→UI 렌더 | <100ms | Log Buffer 배치 + IPC 합산 |
| SQLite 쿼리 | <5ms | better-sqlite3 WAL 기준 |
| Log Buffer 메모리 | <50MB | ring buffer + 이전 데이터 삭제 |

### 13.4 Structured Logging

```typescript
interface LogEntry {
  timestamp: string;     // ISO 8601
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;        // 서비스명.메서드명
  message: string;
  context?: Record<string, unknown>;
}
```

| 레벨 | dev | prod | 파일 |
|------|-----|------|------|
| debug | console | - | - |
| info | console | electron-log | app.log |
| warn | console | electron-log | app.log |
| error | console | electron-log + Notification | app.log + error-{id}.log |

### 13.5 Test Strategy

| 계층 | 타겟 비율 | 도구 | 설명 |
|------|----------|------|------|
| Unit | 70% | vitest | 서비스, 스토어, 어댑터 |
| Integration | 20% | vitest + electron-mocha | IPC 핸들러, DB 트랜잭션 |
| E2E | 10% | Playwright | 사용자 시나리오 전체 |

**커버리지 타겟:** 80% line coverage (Phase 2 종료 기준)

### 13.6 CLI Security Enhancement

```typescript
// ❌ 취약: PATH에서 바이너리 검색
spawn('codex', args, { shell: false });

// ✅ 안전: 절대 경로만 사용
const enginePath = configReader.getEnginePath('codex'); // 절대 경로 검증
spawn(enginePath, args, { shell: false });
```

### 13.6 Checklist Addition

Code Review Checklist에 다음 항목 추가:

- [ ] 모든 패널이 ErrorBoundary로 감싸져 있는가?
- [ ] 상태 영속화가 localStorage에 올바르게 저장/복원되는가?
- [ ] CLI 실행에 절대 경로를 사용하는가 (PATH 검색 금지)?
- [ ] CSP 헤더가 설정되어 있는가?
- [ ] Worker Thread 크래시 시 자동 재시작이 동작하는가?
- [ ] Log Buffer가 50MB 제한을 초과하지 않는가?
- [ ] IPC 라운드트립이 50ms 이하인가?
- [ ] 앱 콜드 스타트가 3초 이하인가?
