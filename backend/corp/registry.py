"""corp.registry — 스킬 인사DB. 직원은 스킬이다.

왜 이 파일인가: 스킬 디렉터리(SKILL.md frontmatter)가 이미 인사 기록의 뼈대를
갖췄다 — 이름(name)·직무설명(description)·직무기술서(allowed-tools). 등록은
심볼릭링크 발령, 퇴사는 아카이브, 고과는 runs 성공률이다. 새로 짓지 않고 승격.
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config, store

ARCHIVE = config.DATA / "archive"          # 퇴사(휴직) 보관 — 삭제 아님


def _frontmatter(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    if not text.startswith("---"):
        return {}
    head = text[3:].split("---", 1)[0]
    out: dict = {}
    key: str | None = None
    for line in head.splitlines():
        m = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if m:
            key = m.group(1)
            val = m.group(2).strip().strip("\"'")
            if val in (">", ">-", "|", "|-"):
                out[key] = ""
            else:
                out[key] = val
        elif key and re.match(r"^\s+-\s+(.*)$", line):
            out.setdefault(key + "_list", []).append(re.match(r"^\s+-\s+(.*)$", line).group(1).strip("\"'"))
        elif key and (line.startswith("  ") or line.startswith("\t")):
            stripped = line.strip()
            if stripped:
                curr = out.get(key, "")
                out[key] = (curr + " " + stripped).strip() if curr else stripped
    tools = out.get("allowed-tools", "")
    out["duties"] = [t.strip() for t in tools.split(",")] if "," in tools \
        else out.get("allowed-tools_list", [])
    return out


def roster() -> list[dict]:
    """재직 명부. 상태: active(링크 유효) · archived(휴직)."""
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    items = []
    if config.SKILLS_DIR.is_dir():
        for d in sorted(config.SKILLS_DIR.iterdir()):
            if not d.is_dir() or d.name.startswith((".", "_")):
                continue
            fm = _frontmatter(d / "SKILL.md")
            desc = fm.get("description", "")
            items.append({
                "name": fm.get("name", d.name),
                "label": desc[:200],
                "description": desc,
                "duties": fm.get("duties", [])[:12],
                "employment": "active",
                "source": "genius-skills",
            })
    for d in sorted(ARCHIVE.iterdir()):
        if d.is_dir():
            items.append({"name": d.name, "label": "(휴직 보관)",
                          "description": "",
                          "duties": [], "employment": "archived", "source": "archive"})
    return items


def record(agent: str) -> dict:
    """고과 — runs 성공률(최근 20건). 증거 없으면 unknown."""
    rows = store.db().execute(
        "SELECT status FROM runs WHERE agent=? ORDER BY created DESC LIMIT 20",
        (agent,)).fetchall()
    if not rows:
        return {"agent": agent, "runs": 0, "accept": None}
    ok = sum(1 for r in rows if r["status"] == "completed")
    return {"agent": agent, "runs": len(rows), "accept": round(ok / len(rows), 2)}


def retire(name: str) -> bool:
    """퇴사 → 휴직 보관(이동). 삭제하지 않는다(복직 가능)."""
    src = config.SKILLS_DIR / name
    if not src.is_dir():
        return False
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    src.rename(ARCHIVE / name)
    return True


def rehire(name: str) -> bool:
    dst = config.SKILLS_DIR / name
    src = ARCHIVE / name
    if not src.is_dir() or dst.exists():
        return False
    src.rename(dst)
    return True


def card(name: str) -> dict | None:
    """A2A 에이전트 카드(4단계 개항용) — 레지스트리에서 파생."""
    for r in roster():
        if r["name"] == name and r["employment"] == "active":
            return {"name": r["name"], "description": r["label"],
                    "capabilities": r["duties"],
                    "endpoint": "/api/a2a/message",
                    "protocol": "json-rpc/2.0 (예정)"}
    return None
