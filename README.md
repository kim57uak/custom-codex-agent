# Custom Codex Agent Platform

> **Tactical Multi-Agent Orchestration & Visualization Surface**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Custom Codex Agent Platform**은 로컬 환경에서 Codex CLI 및 Gemini CLI 기반의 인공지능 에이전트를 시각적으로 관리, 조립, 실행할 수 있는 차세대 오퍼레이션 플랫폼입니다. 글래스모피즘 기반의 세련된 UI와 강력한 워크플로 엔진을 통해 복잡한 AI 작업을 손쉽게 제어할 수 있습니다.

![Main UI Preview](https://via.placeholder.com/1200x600/1e293b/ffffff?text=Tactical+Operations+Surface+Preview)

---

## ✨ Key Features

### 1. Tactical Multi-Theme UI
*   **Cyber Fusion**: 고대비 다크 모드의 몰입형 인터페이스.
*   **Glass Enterprise**: 세련된 반투명 디자인의 라이트 모드.
*   **Minimal Pro**: 집중력을 극대화하는 정갈한 디자인.

### 2. Multi-Agent Orchestration
*   **Organization View**: 에이전트 간의 관계와 조직 구조를 한눈에 파악.
*   **Workflow Engine**: 여러 에이전트를 순차적으로 연결하여 복잡한 미션 수행.
*   **Interactive Console**: 실행 중인 에이전트와 실시간 대화(Multi-turn) 가능.

### 3. Agent Lifecycle Management
*   **Inspector**: 에이전트의 스킬(SKILL.md), 설정(config.json), 스크립트를 즉시 수정.
*   **Event Stream**: 모든 실행 과정을 SSE(Server-Sent Events)를 통해 실시간 모니터링.
*   **Backup & Restore**: 스킬과 에이전트 구성을 안전하게 아카이빙.

---

## 🚀 Getting Started

### Prerequisites
*   **Python**: 3.9 이상
*   **Underlying CLIs**:
    *   [Gemini CLI](https://github.com/google/gemini-cli) (추천)
    *   [Codex CLI](https://github.com/google/codex-cli)

### Installation
1.  저장소를 클론합니다.
    ```bash
    git clone https://github.com/your-username/custom-codex-agent.git
    cd custom-codex-agent
    ```
2.  의존성을 설치합니다.
    ```bash
    pip install -r requirements.txt
    ```
3.  서버를 실행합니다.
    ```bash
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    ```
4.  브라우저에서 `http://localhost:8000`에 접속합니다.

---

## 🛠 Configuration
시스템은 환경 변수를 통해 유연하게 설정할 수 있습니다.
*   `GOOGLE_API_KEY`: Gemini 엔진 사용 시 필수.
*   `OPENAI_API_KEY`: Codex 엔진 사용 시 필수.
*   `CUSTOM_CODEX_AGENT_GEMINI_HOME`: Gemini 설정 저장 경로.

---

## 🤝 Contributing
이 프로젝트는 커뮤니티의 기여를 환영합니다! 버그 제보, 기능 제안, PR은 언제나 열려 있습니다. 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

## 📄 License
이 프로젝트는 [MIT License](LICENSE)에 따라 라이선스가 부여됩니다.
