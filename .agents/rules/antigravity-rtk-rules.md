# RTK - Rust Token Killer (Google Antigravity)

**Usage**: RTK is a high-performance CLI proxy designed to filter and summarize system outputs before they reach the AI context. **Always prefix shell commands with `rtk`** to minimize token consumption (60-90% savings).

## 🛠 명령어 확인 방법 (How to Check Commands)

사용 가능한 모든 명령어나 특정 명령어의 도움말을 확인하려면 다음을 사용하세요:

- **전체 명령어 목록 확인**: `rtk help` 또는 `rtk --help`
- **특정 명령어 상세 도움말**: `rtk <command> --help` (예: `rtk git --help`)
- **버전 확인**: `rtk --version`
- **절약량 확인**: `rtk gain`

---

## 📋 모든 명령어 목록 (Complete Command List)

### 📂 파일 및 검색 (File & Search)
- `rtk ls`: 디렉토리 내용 목록 (최적화 출력)
- `rtk tree`: 디렉토리 구조 트리
- `rtk read`: 지능형 필터링 기반 파일 읽기
- `rtk find`: 컴팩트한 트리 형태의 파일 검색
- `rtk grep`: 공백 제거 및 파일별 그룹화된 검색
- `rtk diff`: 변경된 라인만 보여주는 응축된 diff
- `rtk wc`: 단어/라인/바이트 수 계산 (경로/패딩 최적화)
- `rtk smart`: 2줄 기술 요약 생성 (Heuristic 기반)

### 🛠 개발 및 인프라 도구 (Dev & Infra Tools)
- `rtk git`: Git 명령어 (컴팩트한 status/log/diff/branch)
- `rtk gh`: GitHub CLI 명령어 최적화
- `rtk docker`: Docker 컨테이너/이미지 상태 요약
- `rtk kubectl`: Kubernetes 리소스 상태 요약
- `rtk aws`: AWS CLI 출력 압축 (JSON 강제 및 데이터 축소)
- `rtk psql`: PostgreSQL 클라이언트 (테두리 제거 및 테이블 압축)
- `rtk wget`: 다운로드 진행바 제거 및 결과 요약
- `rtk gt`: Graphite stacked PR 명령어 최적화

### 📦 패키지 관리 및 빌드 (Package & Build)
- `rtk npm` / `rtk npx` / `rtk pnpm`: 보일러플레이트 제거된 출력
- `rtk cargo` / `rtk go` / `rtk pip` / `rtk dotnet`: 언어별 빌드/실행 결과 요약
- `rtk next` / `rtk prisma`: 프레임워크 로그 최적화
- `rtk ruff` / `rtk mypy` / `rtk golangci-lint`: 린터 결과 그룹화
- `rtk rake` / `rtk rubocop` / `rtk rspec`: Ruby/Rails 도구 최적화

### 🧪 테스트 및 품질 (Test & Quality)
- `rtk test` / `rtk pytest` / `rtk jest` / `rtk vitest`: 실패 케이스 위주 보고
- `rtk playwright`: E2E 테스트 결과 요약
- `rtk err`: 에러와 경고만 필터링하여 표시
- `rtk lint`: ESLint 규칙 위반 사항 그룹화
- `rtk tsc`: TypeScript 컴파일 에러 그룹화
- `rtk format` / `rtk happier`: 포맷 체크 결과 요약

### 📊 분석 및 설정 (Analysis & Config)
- `rtk gain`: 토큰 절약 요약 및 히스토리 확인
- `rtk cc-economics`: Claude Code 지출 vs RTK 절약 분석
- `rtk deps`: 프로젝트 의존성 요약
- `rtk env`: 환경 변수 (민감 정보 마스킹)
- `rtk summary`: 명령어 실행 결과의 휴리스틱 요약
- `rtk config`: 설정 파일 관리
- `rtk session`: 세션별 RTK 채택률 확인
- `rtk discover`: 누락된 RTK 절약 기회 탐색
- `rtk learn`: 에러 히스토리로부터 CLI 교정 학습

### ⚙️ 시스템 및 메타 (System & Meta)
- `rtk init`: 에이전트 환경 초기화
- `rtk run`: 필터링 없는 원본 명령어 실행 (sh -c)
- `rtk proxy`: 필터링 없이 실행하되 사용량 추적
- `rtk pipe`: 표준 입력(stdin) 필터링
- `rtk trust` / `rtk untrust`: 로컬 TOML 필터 신뢰 관리
- `rtk verify`: 훅 무결성 검증 및 인라인 테스트
- `rtk rewrite`: 명령어를 RTK 전용 형태로 재작성

---

## 💡 주요 규칙 (Core Rule)

**"항상 `rtk`를 먼저 붙이세요."** 
RTK는 원본 출력이 LLM 컨텍스트에 도달하기 전에 압축하여 응답 속도를 높이고 비용을 절감합니다. 지원되는 모든 작업에서 원본 명령어 대신 `rtk <command>`를 사용하는 것이 기본 원칙입니다.
