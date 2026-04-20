# Custom Codex Agent

로컬 Codex 설정(`~/.codex`)을 읽어 다음 기능을 제공하는 FastAPI 기반 웹 앱입니다.

- 기업 조직도 시각화
- 운영 대시보드(스킬/에이전트/스레드/로그 기반)
- 에이전트 실행 콘솔(Codex CLI 실행)
- 스킬 인스펙터(SKILL.md / agent 설정 / scripts / references 열람)

## 프로젝트 구조

- `backend/app/main.py`: FastAPI 앱 진입점
- `backend/app/api.py`: REST/SSE API 라우터
- `backend/app/services/*`: 설정 스캔, 대시보드 집계, 실행 오케스트레이션
- `backend/app/static/*`: 정적 프런트엔드(HTML/CSS/JS)
- `run_all.sh`: 통합 실행 스크립트(prod/dev)
- `run_backend.sh`: 백엔드 개발 실행 스크립트(reload)

## 요구 사항

- Python `3.10+` (권장: `3.13`)
- macOS/Linux 셸 환경(zsh/bash)
- Codex CLI 실행 기능을 쓰려면 `codex` 실행 파일이 PATH에 있어야 함

`Python 3.9`에서는 `str | None` 타입 주석 평가 문제로 서버가 실패할 수 있습니다.

## 빠른 시작

### 1) 가상환경 생성

```bash
cd /path/to/custom-codex-agent
python3.13 -m venv .venv
source .venv/bin/activate
```

### 2) 의존성 설치

```bash
pip install -r requirements.txt
```

### 3) 환경변수 파일 준비

```bash
cp .env.example .env
```

`run_all.sh`, `run_backend.sh`는 실행 시 루트의 `.env`를 자동 로드합니다.

대표이사 이름은 `.env`에서 아래 값을 수정하면 조직도에 반영됩니다.

```bash
CUSTOM_CODEX_AGENT_FOUNDER_NAME=홍길동
```

### 4) 실행

운영형(기본):

```bash
./run_all.sh
```

개발형(reload):

```bash
./run_all.sh dev
```

또는 백엔드만 reload로:

```bash
./run_backend.sh
```

접속 URL:

- `http://127.0.0.1:8000`

## 스크립트 동작 요약

### `run_all.sh`

- 스크립트 위치를 기준으로 경로를 계산합니다(절대 경로 하드코딩 없음).
- `.venv/bin/activate`가 있으면 자동 활성화해서 실행합니다.
- 루트의 `.env`가 있으면 자동 로드합니다.
- `BACKEND_PORT` 기본값은 `8000`입니다.
- 기존 점유 프로세스가 있으면 종료 시도 후 재기동합니다.
- `prod`/`dev` 모드 지원:
  - `prod`: `uvicorn app.main:app`
  - `dev`: `uvicorn app.main:app --reload`

### `run_backend.sh`

- `.venv/bin/python` 우선 사용(없으면 `python3` fallback)
- 루트의 `.env`가 있으면 자동 로드합니다.
- `--reload` 모드로 백엔드만 실행

## 환경 변수

`backend/app/config.py` 기준으로 실제 반영되는 변수들입니다.

- `CUSTOM_CODEX_AGENT_ALLOWED_ORIGINS`
  - CORS 허용 Origin 목록(콤마 구분)
  - 기본값: `http://127.0.0.1:8000,http://localhost:8000`
- `CUSTOM_CODEX_AGENT_WRITE_API_TOKEN`
  - 쓰기 API 인증 토큰(`X-API-Token`)
  - 기본값: `custom-codex-agent-local-token`
- `CUSTOM_CODEX_AGENT_RUN_DB_NAME`
  - 실행 이력 SQLite 파일명 (`~/.codex` 아래 생성)
  - 기본값: `custom_codex_agent_runs.sqlite`
- `CUSTOM_CODEX_AGENT_CODEX_HOME`
  - Codex 설정 루트 경로
  - 기본값: `~/.codex`
- `CUSTOM_CODEX_AGENT_RUN_MAX_CONCURRENCY`
  - 동시 실행 수
  - 기본값: `2`
- `CUSTOM_CODEX_AGENT_RUN_TIMEOUT_SECONDS`
  - 실행 타임아웃(초)
  - 기본값: `1800`
- `CUSTOM_CODEX_AGENT_RUN_PROMPT_MAX_LENGTH`
  - 프롬프트 최대 길이
  - 기본값: `12000`
- `CUSTOM_CODEX_AGENT_CODEX_CLI_EXECUTABLE`
  - 실행할 Codex CLI 실행 파일명/경로
  - 기본값: `codex`
- `CUSTOM_CODEX_AGENT_CODEX_CLI_SUBCOMMAND`
  - Codex CLI 서브커맨드 인자(콤마 구분)
  - 기본값: `exec`
  - `run_all.sh`는 기본값을 `exec,--sandbox,danger-full-access`로 주입함
- `CUSTOM_CODEX_AGENT_WORKSPACE_ROOT`
  - 실행 콘솔 기본 작업 디렉터리
  - 기본값: 프로젝트 루트 추론값
- `CUSTOM_CODEX_AGENT_FOUNDER_NAME`
  - 조직도 대표 노드에 표시할 대표이사 이름
  - 기본값: `대표이사`

`.env` 샘플은 `./.env.example` 파일을 사용하세요.

참고:

- 실행 이력 DB를 `~/.codex`에 만들 수 없으면 `/tmp/custom_codex_agent_runs.sqlite`로 fallback 됩니다.

## UI 사용법

### 조직도 / 대시보드 탭

- 상단 `스캔`, `활동 새로고침` 버튼은 쓰기 API이며 토큰이 필요합니다.
- 자동 새로고침 + SSE(`/api/events`)로 상태가 갱신됩니다.

### 실행 콘솔 탭

1. 실행할 에이전트 선택
2. 프로젝트 절대 경로 입력(또는 `폴더 선택`)
3. 샌드박스/승인 정책 선택
4. 프롬프트 입력 후 `실행`

- 취소: `선택 실행 취소`
- 재시도: `선택 실행 재시도`
- 실행 로그는 stdout/stderr 이벤트로 저장/표시됩니다.

### 스킬 인스펙터 탭

선택한 에이전트에 대해 다음을 조회합니다.

- `SKILL.md`
- `agent.toml` 또는 `config.json`
- `scripts` 폴더 파일
- `references` 폴더 파일

## 부서 배치(에이전트 설정)

현재 서버는 각 에이전트 설정의 `department`, `role_label` 값을 우선 사용합니다.

- `agent.toml`이 있으면 `agent.toml` 사용
- 없으면 `config.json` 사용
- 둘 다 없으면 기본값 `관리지원 / 관리지원 담당`

`agent.toml` 예시:

```toml
name = "springboot-security-agent"
department = "품질 검증팀"
role_label = "보안 검토 담당"
```

`config.json` 예시:

```json
{
  "name": "openai-docs-agent",
  "department": "콘텐츠 자산팀",
  "role_label": "AI 문서 리서처"
}
```

참고:

- `department`, `role_label`은 반드시 루트 레벨 키로 넣어야 합니다.
- `agent.toml`에서 `[invocation]` 같은 섹션 내부에 넣으면 서버가 읽지 못합니다.

## Codex 프롬프트 예시

### 부서/직무 값 일괄 점검

```text
/polyglot-code-review-agent
~/.codex/agents 하위 agent.toml/config.json을 스캔해서
department, role_label 누락 파일 목록을 표로 정리해줘.
```

### 특정 에이전트 부서 변경

```text
/program-from-planning-doc-agent
~/.codex/agents/springboot-security-agent/config.json의
department를 \"품질 검증팀\", role_label을 \"보안 검토 담당\"으로 수정해줘.
```

### 모든 에이전트에 기본값 주입

```text
/program-from-planning-doc-agent
~/.codex/agents에서 department 또는 role_label이 없는 파일에만
department=\"관리지원\", role_label=\"관리지원 담당\"을 넣어줘.
```

## API 요약

읽기 API(토큰 불필요):

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
- `GET /api/fs/directories?path=/absolute/path`
- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/events`
- `GET /api/events` (SSE)

쓰기 API(`X-API-Token` 필요):

- `POST /api/scan`
- `POST /api/activity/refresh`
- `POST /api/runs`
- `POST /api/runs/{run_id}/cancel`
- `POST /api/runs/{run_id}/retry`

## 예시: 실행 API 호출

```bash
curl -X POST http://127.0.0.1:8000/api/runs \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: custom-codex-agent-local-token' \
  -d '{
    "agent_name": "router-agent",
    "prompt": "현재 저장소 상태를 요약해줘",
    "workspace_root": "/path/to/custom-codex-agent",
    "sandbox_mode": "workspace-write",
    "approval_policy": "on-request"
  }'
```

## 트러블슈팅

### 1) `TypeError: Unable to evaluate type annotation 'str | None'`

- 원인: Python 3.9 환경
- 조치: Python 3.10+로 `.venv` 재생성

```bash
rm -rf .venv
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2) `no such file or directory .../playToy/...`

- 원인: 예전 절대경로 하드코딩 스크립트 사용
- 조치: 현재 저장소의 최신 `run_all.sh`/`run_backend.sh` 사용

### 3) 포트 8000 충돌

```bash
BACKEND_PORT=8010 ./run_all.sh
```

## 라이선스

프로젝트 정책에 따릅니다.
