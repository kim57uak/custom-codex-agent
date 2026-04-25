@/Users/dolpaks/.codex/RTK.md

# Custom Codex Agent Project Instructions

## RTK Shell Rule

Always prefix shell commands with `rtk` in this repository.

Examples:

```bash
rtk git status
rtk rg -n "pattern" .
rtk python3 -m compileall -q backend/app
rtk npm run build
```

Use `rtk proxy <cmd>` only when `rtk` does not support a command shape directly, such as complex `find` predicates.

RTK reference:

- `/Users/dolpaks/.codex/RTK.md`

## Project Map

- Web app root: `/Users/dolpaks/Downloads/project/custom-codex-agent`
- Backend: `backend/app`
- Static UI: `backend/app/static`
- User skills root: `/Users/dolpaks/.codex/skills`
- User agents root: `/Users/dolpaks/.codex/agents`
- Agent-to-skill index: `/Users/dolpaks/.codex/agents/README.md`

## Skill Discovery Summary

Codex should treat `/Users/dolpaks/.codex/skills/*/SKILL.md` as the source of truth for installed user skills. Agent configs in `/Users/dolpaks/.codex/agents/*/config.json` map runnable agents to those skills.

Current notable skill groups:

- Engineering harness and implementation: `agent-harness-engineering`, `program-from-planning-doc`, `requirements-code-check`, `polyglot-code-review`
- Java/Spring work: `java-a2a-multi-agent`, `java-coding-standards`, `springboot-patterns`, `springboot-security`, `springboot-verification`
- Document and media production: `doc`, `pdf`, `pptx-generator`, `imagegen`
- Browser/API docs support: `playwright`, `openai-docs`
- Skill/plugin operations: `skill-creator`, `skill-installer`, `plugin-creator`, `run-all-sh`
- Business operations: `proposal-estimate-builder`, `contract-review`, `interactive-planning-doc`, `advanced-statistical-analysis`
- Solo-business workflows: `founder-dashboard`, `pricing-packaging-lab`, `competitor-watch`, `customer-support-playbook`, `invoice-tax-workflow`, `sop-automation-runbook`

Important rename:

- `java-agent-harness-engineering` was renamed to `agent-harness-engineering`.
- The matching agent is now `agent-harness-engineering-agent`.
- The current skill file is `/Users/dolpaks/.codex/skills/agent-harness-engineering/SKILL.md`.

## Dashboard Behavior Notes

- Organization chart and Inspector data are generated from the live user skill and agent folders, not from hardcoded UI lists.
- If a skill is renamed, update both the skill folder/frontmatter and the matching agent `config.json`/`agent.md`.
- The backend also normalizes stale `skill_path` values by resolving installed skills through `skill_name` when possible.

## Verification Shortcuts

```bash
rtk rg -n "old-skill-name|new-skill-name" /Users/dolpaks/.codex/skills /Users/dolpaks/.codex/agents backend
rtk python3 -m compileall -q backend/app
rtk node --check backend/app/static/app.js
```
