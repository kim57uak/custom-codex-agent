# Agent Orchestrator Desktop

> **Multi-Agent Orchestration & Visualization Desktop App**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Agent Orchestrator Desktop** is an Electron-based desktop application for visually managing, orchestrating, and executing AI agents powered by Codex CLI and Gemini CLI. Features a Cursor/VS Code-style interface with Activity Bar, Sidebar, Panel layout, 10 themes, and real-time execution streaming.

---

## Features

### Multi-Agent Orchestration
- **Organization View**: Visual hierarchy of agents with real-time health status
- **Console**: Run single agents with live terminal (xterm.js) output
- **Workflow Engine**: Chain multiple agents sequentially or in parallel
- **Dashboard**: Execution metrics, success rates, duration tracking

### Desktop Native
- **System Tray**: Background operation with menu bar integration
- **Native Notifications**: Run completion and error alerts
- **Auto-Update**: Seamless updates via electron-updater + GitHub Releases
- **Offline Mode**: Full functionality without internet (CLI engines required)

### 10 Visual Themes
- Dark: Cyber Fusion, Night Ops, Matrix Green, Aurora, Dracula Pro
- Light: Glass Enterprise, Minimal Pro, Paper, Solarized Light
- Hybrid: Nord (Dark/Light)

### Skill & Agent Inspector
- Browse and edit SKILL.md, config.json in Monaco Editor
- Real-time file watching via chokidar
- Backup & Restore with archiver

---

## Quick Start

### Prerequisites
- **Node.js**: 18.x or later
- **One of the following CLI engines**:
  - [Codex CLI](https://github.com/openai/codex)
  - [Gemini CLI](https://github.com/google/gemini-cli)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/kim57uak/custom-codex-agent.git
cd custom-codex-agent

# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Build for Distribution

```bash
# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for current platform
npm run build
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (React + TypeScript)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Activity  │  │ Sidebar  │  │  Main    │  │  Panel    │  │
│  │ Bar      │  │          │  │  Area    │  │  Terminal │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC (contextBridge)
┌──────────────────────▼──────────────────────────────────────┐
│  Main Process (Node.js/TypeScript)                          │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Agent      │  │ Services     │  │ CLI Adapters       │  │
│  │ Orchestrator│  │ ConfigReader │  │ Codex/Gemini/...  │  │
│  │ + Workflow │  │ EventBroker  │  │ child_process     │  │
│  │ Engine     │  │ Inspector    │  │ spawn, shell:false │  │
│  └────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

See [document/](document/) for detailed architecture diagrams (PlantUML).

---

## Documentation

| Document | Description |
|----------|-------------|
| [Planning.md](Planning.md) | Full product plan, architecture, and roadmap |
| [CODE_STANDARDS.md](CODE_STANDARDS.md) | TypeScript, React, Electron coding standards |
| [document/](document/) | PlantUML architecture diagrams |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

---

## Development

```bash
npm run dev       # Start dev server with HMR
npm run lint      # Run ESLint
npm run typecheck # Run TypeScript checks
npm run test      # Run tests (vitest)
npm run test:e2e  # Run E2E tests (Playwright)
```

### Project Structure

```
├── electron/           # Main Process
│   ├── main.ts         # BrowserWindow, lifecycle
│   ├── preload.ts      # contextBridge
│   ├── ipc/            # IPC handlers
│   ├── services/       # Business logic
│   ├── orchestrator/   # Run/Workflow state machines
│   ├── adapters/       # CLI engine adapters
│   └── stores/         # SQLite access
├── src/                # Renderer Process (React)
│   ├── components/     # UI components
│   │   ├── layout/     # ActivityBar, Sidebar, etc.
│   │   ├── views/      # OrgView, ConsoleView, etc.
│   │   └── common/     # Shared components
│   ├── stores/         # Zustand stores
│   ├── hooks/          # IPC wrapper hooks
│   └── types/          # TypeScript types
├── resources/          # Icons, assets
├── document/           # Architecture diagrams
└── build/              # electron-builder config
```

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
