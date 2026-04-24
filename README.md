# Custom Codex Agent

로컬 `~/.codex` 설정, SQLite 상태 DB, 히스토리 파일을 읽어 Codex 운영 현황을 시각화하고, 개별 에이전트 실행과 멀티 에이전트 워크플로 실행까지 지원하는 FastAPI 기반 로컬 웹 앱입니다.

기본 접속 주소는 `http://127.0.0.1:8000`이며, 프런트엔드는 `backend/app/static`에 포함되어 있어 별도 프런트 빌드 없이 백엔드만 실행하면 됩니다.

## 현재 제공 기능

- 조직도 탭
  - `~/.codex/agents` 설정을 읽어 부서/직무 기반 조직도 표시
  - 대표 노드 이름은 `.env`의 `CUSTOM_CODEX_AGENT_FOUNDER_NAME`으로 변경 가능
- 대시보드 탭
  - 최근 스레드, 로그, 히스토리 기반 활동성 요약
  - 전체 스킬 수, 에이전트 수, 라우팅 연결, 깨진 매핑 수 집계
- 실행 콘솔 탭
  - 개별 에이전트를 Codex CLI로 실행
  - 작업 폴더 선택, 샌드박스 정책, 승인 정책 설정
  - 실행 이력 조회, 취소, 재시도, stdout/stderr 로그 확인
- 워크플로 탭
  - 목표 문장 기준 에이전트 추천
  - 추천 단계를 드래그해 순서 조정
  - 순차 멀티 에이전트 실행, 단계별 로그/상태 추적
  - 실패 단계부터 재실행, 단계 건너뛰기, 사용자 답변을 붙여 이어서 실행
- 스킬 인스펙터 탭
  - 선택한 에이전트의 `SKILL.md`, `agent.toml`, `config.json`, `scripts`, `references` 열람
- 운영 보조 기능
  - 상단에서 수동 스캔 / 활동 새로고침
  - `~/.codex/skills`, `~/.codex/agents` 백업 및 최신 백업 복원
  - UI 테마 전환: `Cyber Fusion`, `Glass Enterprise`, `Minimal Pro`

## 프로젝트 구조

```text
backend/
  app/
    api.py                    # REST/SSE API
    config.py                 # 환경변수 및 기본 설정
    main.py                   # FastAPI 앱 진입점
    models.py                 # API 응답/요청 모델
    services/
      config_reader.py        # ~/.codex 및 SQLite 읽기
      dashboard_service.py    # 조직도/대시보드 조합
      event_stream.py         # SSE 이벤트 브로커
      file_watcher.py         # Codex 홈 변경 감시
      run_orchestrator.py     # 단일 에이전트 실행
      run_store.py            # 실행 이력 저장소
      workflow_catalog.py     # 워크플로 UI 옵션/아이콘 규칙
      workflow_orchestrator.py# 워크플로 추천/실행/재시도
      workflow_store.py       # 워크플로 실행 저장소
    static/
      index.html
      app.js
      styles.css
run_all.sh                    # 통합 실행 스크립트
run_backend.sh                # 백엔드 개발 실행
stop_all.sh                   # 포트 종료 스크립트
backups/                      # skills/agents 백업 tar.gz 저장 위치
```

## 요구 사항

- Python `3.10+` 권장
- macOS 또는 Linux 셸 환경
- `codex` 실행 파일이 PATH에 있어야 실행 콘솔/워크플로 추천 기능 사용 가능
- `lsof`가 있으면 포트 정리와 종료 스크립트가 정상 동작

참고:

- Python `3.9`에서는 타입 문법 문제로 실패할 수 있습니다.
- 실행 이력 SQLite를 `~/.codex`에 만들 수 없으면 `/tmp/custom_codex_agent_runs.sqlite`로 폴백합니다.

## 빠른 시작

### 1. 가상환경 생성

```bash
cd /path/to/custom-codex-agent
python3 -m venv .venv
source .venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. 환경변수 준비

```bash
cp .env.example .env
```

`run_all.sh`, `run_backend.sh`, `stop_all.sh`는 루트의 `.env`를 자동 로드합니다.

### 4. 실행

운영형:

```bash
./run_all.sh
```

개발형(`--reload`):

```bash
./run_all.sh dev
```

백엔드만 개발 모드로 실행:

```bash
./run_backend.sh
```

중지:

```bash
./stop_all.sh
```

## 실행 스크립트 동작

### `run_all.sh`

- 실행 위치와 무관하게 스크립트 기준 절대 경로 계산
- `.venv/bin/activate`가 있으면 자동 활성화
- `.env` 자동 로드
- `BACKEND_PORT` 기본값은 `8000`
- 기존 점유 프로세스가 있으면 종료 후 재기동
- `prod`와 `dev` 모드 지원
- 기본 Codex 서브커맨드를 `exec,--sandbox,danger-full-access`로 주입

### `run_backend.sh`

- `.venv/bin/python` 우선 사용, 없으면 `python3` 폴백
- `.env` 자동 로드
- `uvicorn ... --reload` 실행

### `stop_all.sh`

- 기본 포트 `8000` 또는 인자로 받은 포트의 리스너 종료

## 환경 변수

실제 반영되는 환경 변수는 `backend/app/config.py` 기준입니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CUSTOM_CODEX_AGENT_ALLOWED_ORIGINS` | `http://127.0.0.1:8000,http://localhost:8000` | CORS 허용 Origin 목록 |
| `CUSTOM_CODEX_AGENT_WRITE_API_TOKEN` | `custom-codex-agent-local-token` | 쓰기 API용 `X-API-Token` |
| `CUSTOM_CODEX_AGENT_FOUNDER_NAME` | `대표이사` | 조직도 대표 이름 |
| `CUSTOM_CODEX_AGENT_CODEX_HOME` | `~/.codex` | Codex 설정 루트 |
| `CUSTOM_CODEX_AGENT_RUN_DB_NAME` | `custom_codex_agent_runs.sqlite` | 실행 이력 DB 파일명 |
| `CUSTOM_CODEX_AGENT_RUN_MAX_CONCURRENCY` | `2` | 동시 실행 수 |
| `CUSTOM_CODEX_AGENT_RUN_TIMEOUT_SECONDS` | `1800` | 개별 실행 타임아웃 |
| `CUSTOM_CODEX_AGENT_RUN_PROMPT_MAX_LENGTH` | `12000` | 최대 프롬프트 길이 |
| `CUSTOM_CODEX_AGENT_CODEX_CLI_EXECUTABLE` | `codex` | Codex CLI 실행 파일 |
| `CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND` | `exec` | Codex 서브커맨드 인자 목록(콤마 구분) |
| `CUSTOM_CODEX_AGENT_WORKSPACE_ROOT` | 프로젝트 루트 추론값 | 실행 콘솔 기본 작업 폴더 |
| `CUSTOM_CODEX_AGENT_WORKFLOW_RECOMMENDATION_MAX_AGENTS` | `6` | 추천 워크플로 최대 에이전트 수 |

`.env.example`에는 운영에 필요한 기본 예시 값이 들어 있습니다. 실제 실행 스크립트에서는 `CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND=exec,--sandbox,danger-full-access`를 기본 주입합니다.

## UI 사용법

### 1. 조직도 / 대시보드

- `스캔`, `활동 새로고침`, `BACKUP_UNITS`, `RESTORE_UNITS`는 쓰기 API 토큰이 필요합니다.
- 앱 시작 시 `~/.codex` 변경 감시가 켜지고, `/api/events` SSE로 화면이 갱신됩니다.

### 2. 실행 콘솔

1. 실행할 에이전트를 선택합니다.
2. 절대 경로 작업 폴더를 입력하거나 폴더 선택기를 엽니다.
3. 샌드박스 정책과 승인 정책을 고릅니다.
4. 프롬프트를 입력하고 실행합니다.

지원 기능:

- 실행 취소
- 동일 프롬프트 재시도
- 실행 로그 실시간 조회

주의:

- 내부적으로 프롬프트 앞에 선택한 에이전트명과 실행 콘솔 안내문이 자동으로 덧붙습니다.
- 파일 분석 작업인데 명시적 파일 경로/이름이 없으면 에이전트가 먼저 경로를 요청하도록 유도됩니다.

### 3. 워크플로

1. 목표 문장을 입력합니다.
2. `RECOMMEND`로 추천 에이전트를 받습니다.
3. 필요하면 수동으로 에이전트를 추가하거나 순서를 재배치합니다.
4. 작업 폴더 / 샌드박스 / 승인 정책을 정합니다.
5. `EXECUTE_NETWORK`로 순차 실행합니다.

지원 기능:

- 추천 결과를 기반으로 단계 초안 생성
- 단계 카드 드래그 정렬
- 선택 단계부터 다시 실행
- 실패 단계를 건너뛰고 후속 단계 계속 실행
- 사용자의 추가 답변을 특정 단계에 반영해 새 워크플로로 재실행

참고:

- 추천은 우선 Codex CLI를 통해 JSON 응답을 시도하고, 실패 시 로컬 휴리스틱으로 폴백합니다.

### 4. 스킬 인스펙터

- 에이전트별 설정과 연결된 스킬 파일을 한 화면에서 확인할 수 있습니다.
- `references`, `scripts` 폴더는 재귀적으로 읽어옵니다.

## 에이전트 메타데이터 규칙

조직도와 실행 목록은 각 에이전트 설정의 아래 루트 키를 우선 사용합니다.

- `department`
- `role_label`
- `short_description`
- `one_click_prompt`
- `skill_name`
- `skill_path`

우선순위:

- `agent.toml`이 있으면 우선 사용
- 없으면 `config.json` 사용
- `department`, `role_label`이 없으면 기본값 `관리지원`, `관리지원 담당` 사용

예시 `agent.toml`:

```toml
name = "springboot-security-agent"
department = "품질 검증팀"
role_label = "보안 검토 담당"
short_description = "Spring Boot 보안 검토"
```

예시 `config.json`:

```json
{
  "name": "openai-docs-agent",
  "department": "콘텐츠 자산팀",
  "role_label": "AI 문서 리서처",
  "one_click_prompt": "최신 공식 문서를 기준으로 조사해줘."
}
```

## API 요약

### 읽기 API

- `GET /health`
- `GET /`
- `GET /api/overview`
- `GET /api/graph/org`
- `GET /api/graph/router`
- `GET /api/dashboard`
- `GET /api/inventory`
- `GET /api/agents/executable`
- `GET /api/agents/{agent_name}/inspector`
- `GET /api/run-config`
- `GET /api/workflows/ui-config`
- `GET /api/fs/directories?path=/absolute/path`
- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/events`
- `GET /api/workflow-runs`
- `GET /api/workflow-runs/{workflow_run_id}`
- `GET /api/workflow-runs/{workflow_run_id}/events`
- `GET /api/events`

### 쓰기 API (`X-API-Token` 필요)

- `POST /api/scan`
- `POST /api/activity/refresh`
- `POST /api/agents/{agent_name}/inspector/files`
- `POST /api/backups/skills-agents`
- `POST /api/backups/skills-agents/restore`
- `POST /api/runs`
- `POST /api/runs/{run_id}/cancel`
- `POST /api/runs/{run_id}/retry`
- `POST /api/workflows/recommend`
- `POST /api/workflow-runs`
- `POST /api/workflow-runs/{workflow_run_id}/cancel`
- `POST /api/workflow-runs/{workflow_run_id}/retry`
- `POST /api/workflow-runs/{workflow_run_id}/retry-from-step`
- `POST /api/workflow-runs/{workflow_run_id}/skip-step`

## 백업 / 복원

- 백업 API는 `~/.codex/skills`, `~/.codex/agents`를 `backups/skills-agents-backup-*.tar.gz`로 저장합니다.
- 복원 API는 가장 최신의 사용 가능한 백업을 찾아 `~/.codex` 아래로 복원합니다.
- 백업 시 `purge_after_backup=true`를 주면 원본 엔트리를 비우는 옵션도 있습니다.

## 문제 해결

- `codex cli not found`
  - `codex`가 PATH에 있는지 확인하거나 `CUSTOM_CODEX_AGENT_CODEX_CLI_EXECUTABLE`를 지정하세요.
- 실행은 되지만 목록이 비어 있음
  - `CUSTOM_CODEX_AGENT_CODEX_HOME`이 실제 Codex 홈과 맞는지 확인하세요.
- 조직도만 보이고 활동 데이터가 없음
  - `~/.codex/state_5.sqlite`, `logs_2.sqlite`, `history.jsonl`가 없거나 비어 있을 수 있습니다.
- 포트가 이미 사용 중
  - `./stop_all.sh`를 먼저 실행하거나 `BACKEND_PORT`를 바꿔 실행하세요.

## 라이선스 / 참고

이 저장소는 로컬 Codex 운영 환경을 전제로 하며, 실제 데이터 구조는 사용 중인 `~/.codex` 상태에 따라 달라질 수 있습니다.
