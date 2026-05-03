# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-03

### Added
- **Multi-turn Conversation**: Added interactive reply capability to the individual agent execution console.
- **Theme Readability Polish**: Major visual overhaul for Glass Enterprise and Minimal Pro themes.
- **Workflow Orchestration**: Sequential execution of multiple agents with carryover summaries.
- **Agent Inspector**: Real-time editing of skills, configs, and scripts.
- **Backup & Restore**: System-wide archiving of agent assets.

### Fixed
- **Retry Logic**: Fixed an issue where security policies (sandbox, approval) were lost during run retries.
- **Environment Propagation**: Ensured API keys are correctly passed to subprocesses in all execution modes.
- **Responsive Navigation**: Fixed layout issues in sidebars across different themes.

### Infrastructure
- **Refactored Architecture**: Decoupled API routes from business logic using dedicated service layers.
- **SQLite Persistence**: Migrated to a more robust schema for run and event tracking.
- **Open Source Readiness**: Added LICENSE, README, and contributing guidelines.
