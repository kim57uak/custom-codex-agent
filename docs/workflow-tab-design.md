# Workflow 탭 설계서

## 1. 문서 목적

본 문서는 `Custom Codex Agent` 웹 UI에 신규 `Workflow` 탭을 추가하기 위한 제품/기술 설계를 정의한다.

이 탭의 목표는 다음과 같다.

- 사용자가 자연어로 작업 목표를 입력하면 Codex가 적합한 에이전트/스킬을 1개 이상 추천한다.
- 사용자는 추천된 에이전트를 워크플로 캔버스에 배치하고 자유롭게 순서를 재정렬한다.
- 각 단계별로 개별 프롬프트를 입력해 세부 작업 지시를 내릴 수 있다.
- 단계는 순차 실행되며, 이전 단계 결과를 다음 단계가 이어받아 작업한다.
- 현재 어떤 에이전트가 어떤 작업을 수행 중인지 워크플로 상에서 간단히 표시한다.
- 상세 로그는 하단 또는 우측의 작업 로그 콘솔에 모두 출력한다.
- 실행 콘솔과 동일하게 샌드박스 정책, 승인 정책을 선택할 수 있다.

본 설계는 기존 `실행 콘솔`, `SSE 이벤트 스트림`, `RunOrchestrator`, `RunStore`를 확장하는 방향을 기본 원칙으로 한다.

## 2. 제품 컨셉

`Workflow` 탭은 단순한 실행 화면이 아니라 아래 기능을 하나의 화면에서 묶는 멀티 에이전트 오케스트레이션 UI이다.

- 에이전트 추천
- 워크플로 조립
- 단계별 프롬프트 지시
- 순차 실행
- 진행 상태 가시화
- 상세 로그 추적

핵심 컨셉은 "사용자가 작업 목표를 정의하면 Codex가 적합한 작업 팀을 제안하고, 사용자는 그 팀의 실행 순서를 직접 설계한 뒤 한 번에 흘려보낸다"이다.

## 3. 주요 사용자 시나리오

### 시나리오 A. 새 작업 워크플로 생성

1. 사용자가 `Workflow` 탭으로 이동한다.
2. 상단 입력창에 목표를 입력한다.
   - 예: `Spring Boot 인증 구조를 점검하고, 위험 항목을 수정한 뒤 검증까지 해줘`
3. Codex가 추천 에이전트/스킬 목록을 반환한다.
4. 사용자는 추천 결과 중 원하는 항목을 선택해 워크플로에 추가한다.
5. 각 단계의 프롬프트를 수정하거나 보강한다.
6. 드래그앤드롭으로 실행 순서를 조정한다.
7. 샌드박스 정책, 승인 정책, 작업 루트 폴더를 선택한다.
8. `워크플로 실행` 버튼을 누른다.
9. 첫 단계가 실행되고, 완료되면 다음 단계가 직전 결과를 컨텍스트로 이어받아 실행된다.

### 시나리오 B. 추천 후 수동 편집

1. 사용자는 Codex 추천을 받은 뒤 일부 에이전트를 삭제한다.
2. 추천에 없던 에이전트를 수동 검색으로 추가한다.
3. 아이콘과 이름을 보며 순서를 재배열한다.
4. 각 단계의 목적과 지시문을 세밀하게 편집한다.

### 시나리오 C. 실행 모니터링

1. 사용자는 워크플로 실행 중 각 단계 카드에서 현재 상태를 확인한다.
2. 예: `대기`, `실행 중`, `승인 대기`, `완료`, `실패`
3. 카드에는 간단한 진행 표시만 보여주고, 자세한 stdout/stderr 및 시스템 이벤트는 로그 콘솔에 누적 출력한다.

## 4. 정보 구조 및 UI 구성

## 4.1 탭 구조

기존 탭 바에 아래 항목을 추가한다.

- `기업 조직도`
- `운영 대시보드`
- `실행 콘솔`
- `Workflow`
- `스킬 인스펙터`

권장 위치는 `실행 콘솔` 다음, `스킬 인스펙터` 이전이다.

## 4.2 Workflow 화면 레이아웃

한 화면 안에서 다음 4개 영역을 제공한다.

### A. 상단 목표 입력 영역

- `작업 목표` 텍스트 입력
- `추천 에이전트 찾기` 버튼
- 최근 추천 히스토리 또는 예시 프롬프트

### B. 추천 결과 패널

- Codex가 반환한 추천 에이전트/스킬 카드 리스트
- 카드 요소
  - 아이콘
  - 에이전트 이름
  - 연결된 스킬 이름
  - 한 줄 설명
  - 추천 이유
  - `워크플로에 추가` 버튼

### C. 워크플로 캔버스/리스트 영역

- 드래그앤드롭 가능한 단계 카드 리스트
- 초기 구현은 세로 정렬형 sortable list로 시작
- 이후 확장 시 노드형 캔버스 UI로 진화 가능

각 단계 카드에 포함할 요소:

- 단계 번호
- 에이전트 아이콘
- 에이전트 이름
- 스킬 이름
- 상태 배지
- 간단 진행 상태 텍스트
- 단계 프롬프트 입력창
- 순서 이동 핸들
- 삭제 버튼
- 복제 버튼
- 로그 보기 버튼

### D. 실행 제어/로그 영역

- 공통 설정
  - 작업 폴더
  - 샌드박스 정책
  - 승인 정책
- 실행 제어
  - `워크플로 실행`
  - `일시 정지` (후속 단계)
  - `중단`
  - `실패 단계부터 재시도`
- 로그 콘솔
  - 전체 로그
  - 현재 선택 단계 로그
  - 필터: all / system / stdout / stderr / approval

## 5. 에이전트/스킬 표시 원칙

## 5.1 이름 표시 원칙

워크플로 단계 카드에는 아래 텍스트를 명확히 구분해 표시한다.

- 주 표시: `에이전트 이름`
- 보조 표시: `연결 스킬 이름`
- 서브 라벨: `부서 / 역할`

예시:

- `springboot-security-agent`
- `springboot-security`
- `품질 검증팀 / 보안 검토 담당`

사용자가 워크플로를 한눈에 이해할 수 있도록, 카드 최상단에는 반드시 에이전트 이름을 고정 노출한다.

## 5.2 아이콘 매핑 원칙

에이전트 또는 스킬의 성격에 따라 일관된 아이콘을 매핑한다.

기본 규칙:

- 스킬 이름 우선 매핑
- 스킬명이 없으면 에이전트명 기준 매핑
- 둘 다 매칭되지 않으면 기본 `bot` 아이콘 사용

권장 매핑 테이블:

| 분류 키워드 | 아이콘 제안 | 의미 |
| --- | --- | --- |
| `security`, `auth`, `springboot-security` | shield | 보안/권한 |
| `review`, `qa`, `verification`, `test` | check-circle | 리뷰/검증 |
| `docs`, `openai-docs`, `research` | file-text | 문서/리서치 |
| `database`, `sql`, `data`, `rag` | database | 데이터/저장소 |
| `frontend`, `ui`, `design`, `figma` | layout | UI/디자인 |
| `backend`, `api`, `server`, `springboot` | server | 백엔드/API |
| `automation`, `workflow`, `runner` | play-square | 자동화/실행 |
| `files`, `filesystem`, `storage` | folder | 파일 시스템 |
| `excel`, `sheet`, `csv` | table | 스프레드시트 |
| `ppt`, `slides`, `presentation` | presentation | 슬라이드/문서화 |
| 기본값 | bot | 일반 에이전트 |

프런트엔드 구현은 Lucide 또는 Heroicons 같이 경량 아이콘 셋을 사용하는 것을 권장한다.

## 6. 워크플로 단계 상태 표시 설계

요구사항상 워크플로 위에는 간단한 진행 상황만 보여주고, 자세한 내역은 로그 콘솔에서 제공한다.

따라서 단계 카드에는 다음 최소 상태만 노출한다.

- `대기`
- `추천됨`
- `준비 완료`
- `실행 중`
- `승인 대기`
- `완료`
- `실패`
- `중단됨`
- `건너뜀`

카드 내 간단 UI 구성:

- 색상 배지
- 작은 점 애니메이션 또는 spinner
- 한 줄 상태 문구
- 마지막 이벤트 시각

예시 상태 표현:

- `실행 중 · 프롬프트 전달 후 분석 진행 중`
- `승인 대기 · 샌드박스 외부 실행 승인 필요`
- `완료 · 다음 단계로 결과 전달됨`
- `실패 · exit code 1`

상세 stdout/stderr는 카드에 직접 모두 노출하지 않는다.

## 7. 추천 흐름 설계

## 7.1 입력

사용자는 상단에서 전체 작업 목표를 입력한다.

예:

- `신규 스킬을 만들고 문서까지 정리해줘`
- `백엔드 API 설계 검토 후 필요한 테스트 코드까지 작성해줘`

## 7.2 추천 방식

추천은 2단계 혼합 방식으로 설계한다.

### 1단계. 로컬 메타데이터 기반 후보 필터링

기존 inventory 데이터를 활용한다.

- 에이전트 이름
- 부서/역할
- short description
- one click prompt
- skill name
- route keyword

이 단계에서 1차 후보를 만든다.

### 2단계. Codex 추천 해석

Codex에게 아래를 요청한다.

- 사용자 목표 분석
- 적합한 에이전트 1개 이상 제안
- 추천 순서 제안
- 각 단계 추천 이유 요약
- 각 단계 기본 프롬프트 초안 생성

추천 응답은 구조화 JSON으로 받는 것을 권장한다.

예시 응답 스키마:

```json
{
  "goal": "Spring Boot 인증 구조 점검 및 수정",
  "recommendedAgents": [
    {
      "agentName": "springboot-security-agent",
      "skillName": "springboot-security",
      "reason": "보안 취약점 점검에 적합",
      "defaultPrompt": "현재 인증/인가 구조를 점검하고 위험 항목을 정리해줘",
      "order": 1
    }
  ]
}
```

## 8. 실행 모델 설계

## 8.1 기본 실행 원칙

- 워크플로는 기본적으로 `순차 실행`이다.
- 현재 단계가 성공적으로 끝나면 다음 단계를 시작한다.
- 다음 단계는 이전 단계의 요약 결과를 입력 컨텍스트로 이어받는다.
- 공통 실행 정책은 워크플로 전체에 적용하되, 추후 단계별 override를 허용할 수 있다.

## 8.2 단계 간 컨텍스트 전달

각 단계는 아래 정보를 다음 단계로 전달한다.

- 직전 단계 실행 요약
- 중요 산출물 경로
- 실패/주의 사항
- 원본 사용자 목표
- 이전 단계들의 누적 요약

권장 전달 포맷:

```text
[Workflow Context]
Workflow Goal: ...
Current Step: 2 / 4
Previous Step Agent: ...
Previous Step Result Summary: ...
Relevant Output Paths: ...
Carry-over Instructions: ...
```

요약은 전체 로그 전문이 아니라, 단계 종료 시 생성한 `step summary`를 사용한다.

## 8.3 승인/샌드박스 정책

실행 콘솔과 동일한 선택 값을 제공한다.

- `sandbox_mode`
  - `read-only`
  - `workspace-write`
  - `danger-full-access`
- `approval_policy`
  - `untrusted`
  - `on-request`
  - `never`

정책 적용 우선순위:

1. 단계별 override
2. 워크플로 기본값
3. 시스템 기본값

## 8.4 실패 처리

기본 정책:

- 한 단계 실패 시 기본적으로 워크플로 전체를 `failed` 상태로 멈춘다.
- 사용자는 아래 동작 중 선택 가능해야 한다.
  - 실패 단계 재시도
  - 실패 단계 수정 후 재실행
  - 실패 단계 이후 단계 건너뛰기
  - 전체 중단

후속 확장:

- 단계별 `continue on failure` 옵션
- 조건부 분기

## 9. 백엔드 설계

## 9.1 신규 개념

기존 `run`은 단일 에이전트 실행 단위다.

신규 `workflow`는 여러 `run`을 묶는 상위 실행 단위다.

추가 엔터티:

- `WorkflowDefinition`
- `WorkflowStepDefinition`
- `WorkflowRun`
- `WorkflowStepRun`

## 9.2 데이터 모델 초안

### WorkflowDefinition

- `workflow_id`
- `title`
- `goal_prompt`
- `workspace_root`
- `sandbox_mode`
- `approval_policy`
- `created_at`
- `updated_at`

### WorkflowStepDefinition

- `step_id`
- `workflow_id`
- `order_index`
- `agent_name`
- `skill_name`
- `icon_key`
- `title`
- `instruction_prompt`

### WorkflowRun

- `workflow_run_id`
- `workflow_id`
- `status`
- `current_step_index`
- `started_at`
- `completed_at`
- `error_message`

### WorkflowStepRun

- `workflow_step_run_id`
- `workflow_run_id`
- `step_id`
- `agent_name`
- `status`
- `run_id`
- `step_summary`
- `started_at`
- `completed_at`
- `exit_code`
- `error_message`

## 9.3 API 초안

### 추천 API

- `POST /api/workflows/recommend`

요청:

```json
{
  "goalPrompt": "Spring Boot 인증 구조 점검 후 수정 및 검증"
}
```

응답:

```json
{
  "goal": "Spring Boot 인증 구조 점검 후 수정 및 검증",
  "recommendedAgents": [
    {
      "agentName": "springboot-security-agent",
      "skillName": "springboot-security",
      "iconKey": "shield",
      "reason": "보안 점검에 적합",
      "defaultPrompt": "현재 인증/인가 구조를 점검하고 위험 항목을 정리해줘",
      "order": 1
    }
  ]
}
```

### 워크플로 저장 API

- `POST /api/workflows`
- `PUT /api/workflows/{workflow_id}`
- `GET /api/workflows`
- `GET /api/workflows/{workflow_id}`

### 워크플로 실행 API

- `POST /api/workflows/{workflow_id}/runs`
- `GET /api/workflow-runs`
- `GET /api/workflow-runs/{workflow_run_id}`
- `POST /api/workflow-runs/{workflow_run_id}/cancel`
- `POST /api/workflow-runs/{workflow_run_id}/retry`

### 단계 로그 조회 API

- `GET /api/workflow-runs/{workflow_run_id}/events`
- `GET /api/workflow-runs/{workflow_run_id}/steps/{step_id}/events`

## 9.4 이벤트 스트림 설계

기존 SSE 브로커를 확장해 워크플로 레벨 이벤트를 추가한다.

이벤트 예시:

- `workflow:queued`
- `workflow:started`
- `workflow:step:started`
- `workflow:step:approval_required`
- `workflow:step:completed`
- `workflow:step:failed`
- `workflow:completed`
- `workflow:failed`

프런트엔드는 이 이벤트를 받아 카드 상태와 로그 콘솔을 갱신한다.

## 9.5 실행 오케스트레이터 확장 방향

기존 `RunOrchestrator`는 유지하고, 그 위에 `WorkflowOrchestrator`를 추가한다.

구성 원칙:

- `WorkflowOrchestrator`
  - 워크플로 run 생성
  - 단계 순회
  - 각 단계마다 기존 `RunOrchestrator.create_run()` 호출
  - 단계 종료 이벤트 수집
  - 단계 요약 생성
  - 다음 단계 프롬프트에 컨텍스트 주입

즉, 단일 실행 엔진은 유지하고, 워크플로는 상위 오케스트레이션 계층으로 감싼다.

## 10. 프런트엔드 설계

## 10.1 상태 관리

프런트엔드 `app.js`에 아래 상태를 추가한다.

- `workflowRecommendations`
- `workflowDraft`
- `workflowRuns`
- `selectedWorkflowRunId`
- `selectedWorkflowStepId`
- `workflowExecutionPolicy`

## 10.2 핵심 컴포넌트 단위

현재는 정적 HTML/JS 구조이므로, 다음 단위로 섹션 분리 함수를 구성한다.

- `renderWorkflowView()`
- `renderWorkflowRecommendations()`
- `renderWorkflowSteps()`
- `renderWorkflowRunStatus()`
- `renderWorkflowLogConsole()`

## 10.3 드래그앤드롭

초기 구현은 아래 중 하나를 권장한다.

- HTML5 Drag and Drop API
- SortableJS 같은 경량 라이브러리

우선순위는 구현 단순성과 안정성이다. 초기 버전은 세로 리스트 정렬만 지원해도 충분하다.

## 10.4 간단 진행 UI

각 단계 카드에 아래 요소를 둔다.

- 좌측: 아이콘 + 단계 번호
- 중앙: 에이전트 이름, 스킬 이름, 프롬프트 입력창
- 우측: 상태 배지, spinner, 최근 이벤트 문구

권장 상태 색상:

- `대기`: 회색
- `실행 중`: 파랑
- `승인 대기`: 주황
- `완료`: 초록
- `실패`: 빨강

상세 로그는 카드에 넣지 않고 콘솔에서만 본다.

## 11. UX 세부 원칙

### 11.1 사용자가 즉시 이해해야 하는 정보

사용자는 화면만 보고 아래를 즉시 파악할 수 있어야 한다.

- 어떤 에이전트들이 배치되어 있는지
- 어떤 순서로 실행되는지
- 지금 어느 단계가 실행 중인지
- 어떤 단계가 멈췄는지
- 상세 내역은 어디서 보는지

### 11.2 카드 복잡도 제한

카드에는 최소한의 상태만 보여주고, 로그 전문은 숨긴다.

이유:

- 워크플로 캔버스의 가독성 유지
- 긴 stdout/stderr로 인한 레이아웃 붕괴 방지
- 모니터링과 디버깅의 책임 분리

### 11.3 이름과 아이콘의 일관성

에이전트명이 바뀌어도 사용자가 식별할 수 있도록 아래 2개를 항상 함께 보여준다.

- 텍스트 이름
- 아이콘

## 12. 구현 단계 제안

### Phase 1. MVP

- `Workflow` 탭 추가
- 목표 입력 후 추천 API 연결
- 추천 결과를 워크플로 리스트에 추가
- 단계 드래그앤드롭 재정렬
- 단계별 프롬프트 편집
- 공통 정책 선택
- 순차 실행
- 단계 상태 배지 표시
- 로그 콘솔 표시

### Phase 2. 운영성 강화

- 워크플로 저장/불러오기
- 실패 단계부터 재시도
- 단계별 정책 override
- 단계 요약 및 결과 아카이브
- 추천 이력 저장

### Phase 3. 고급 오케스트레이션

- 분기 조건
- 병렬 단계
- 조건부 다음 단계
- 승인 대기 UI 강화
- 템플릿 워크플로

## 13. 수용 기준

아래 조건을 만족하면 1차 구현 완료로 본다.

- 사용자는 `Workflow` 탭에서 작업 목표를 입력해 추천 에이전트를 받을 수 있다.
- 추천된 에이전트를 1개 이상 워크플로 단계로 추가할 수 있다.
- 단계 순서를 마우스로 자유롭게 변경할 수 있다.
- 각 단계마다 별도 프롬프트를 입력할 수 있다.
- 워크플로 실행 시 단계가 순차적으로 실행된다.
- 실행 중인 단계는 워크플로 상에서 간단한 상태 UI로 표시된다.
- 에이전트 이름과 아이콘이 각 단계에 명확히 표시된다.
- 상세 실행 로그는 별도 콘솔에 출력된다.
- 샌드박스 정책과 승인 정책을 선택할 수 있다.

## 14. 리스크 및 고려사항

- 추천 품질이 낮으면 사용자가 워크플로를 신뢰하지 않을 수 있다.
- 단계 간 컨텍스트 전달이 과도하면 프롬프트가 길어질 수 있다.
- 승인 대기 상태가 다단계 워크플로에서 UX를 끊을 수 있다.
- 단일 단계 실패 시 어떤 재시도 정책을 기본값으로 둘지 명확히 해야 한다.
- 초기에는 노드 그래프보다 sortable list가 구현 효율이 높다.

## 15. 권장 구현 결론

1차 구현은 `추천 + 세로형 워크플로 리스트 + 드래그앤드롭 + 단계별 프롬프트 + 순차 실행 + 간단 상태 UI + 상세 로그 콘솔`에 집중하는 것이 가장 적절하다.

특히 아래 3가지는 반드시 지켜야 한다.

- 워크플로 카드에는 `에이전트 이름`을 가장 눈에 띄게 표시할 것
- 스킬/에이전트 성격에 맞는 `아이콘 매핑`을 제공할 것
- 워크플로 상에는 `간단한 진행 상태`만 노출하고, 상세 실행 내용은 `작업 로그 콘솔`로 분리할 것

이 구조는 현재 프로젝트의 `실행 콘솔` 아키텍처를 크게 해치지 않으면서도, 멀티 에이전트 워크플로라는 새로운 사용자 가치를 자연스럽게 추가할 수 있다.
