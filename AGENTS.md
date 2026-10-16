@/Users/dolpaks/Downloads/project/custom-codex-agent/AGENT.md

## 보안 규칙 — 시크릿 파일 열람 (최우선)

값 보유 설정파일(`.env`, `application*.yml`, `bootstrap*.yml`, `*credential*`,
keystore/truststore 등)은 **원문 Read·cat·출력·복사 모두 금지**한다.
비밀번호·키·토큰이 컨텍스트에 들어오는 순간 보안규칙 위반이 성립하므로,
열람은 반드시 마스킹 리더로만 수행한다.

* **마스킹 리더 사용**: `python3 /Users/dolpaks/Downloads/project/genius-skills/scripts/read-config-safe.py <파일> [--strict]`
  — 시크릿성 키의 값은 `***` 치환, 구조(키·주석·비밀 아닌 값)만 표시.
  원문 리더로 되돌아가지 않는다.
* **사전 검사**: 값 보유 파일을 건드리기 전후로
  `python3 /Users/dolpaks/Downloads/project/genius-skills/skills/hnt-coding-standards/scripts/check-secrets.py --file <파일>`
  실행 — 파일 경로·줄·규칙만 보고, 값은 절대 출력하지 않는다.
* **출력 자가검증**: 리포트·답변 전송 전, 초안을 `check-secrets.py --stdin`에 통과시킨다.
* **위반 발견 시**: 값을 재인용하지 말고 STOP → 사용자에게 자격증명 교체(회전) 안내.
  평문 시크릿이 에이전트 컨텍스트에 유입된 자격증명은 **노출로 간주**한다.
* 민감 정보(사용자개인정보, 키·토큰, 회사자산정보, 아이디·비밀번호)는 터미널·로그·리포트·커밋에
  절대 출력하지 않는다. 부분 출력·마스킹 해제·base64·인코딩 경유 우회 출력도 금지한다.