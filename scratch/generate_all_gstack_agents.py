import json
import os
from pathlib import Path

# Mapping definitions: skill_basename -> (role_label, department, keyword)
GSTACK_MAPPING = {
    # 전략 기획팀
    "office-hours": ("전략 기획 고문", "전략 기획팀", "brainstorm"),
    "plan-ceo-review": ("사업 전략 리뷰어", "전략 기획팀", "ceo-review"),
    "plan-eng-review": ("기술 아키텍트", "전략 기획팀", "tech-review"),
    "autoplan": ("자동 기획 파이프라인", "전략 기획팀", "autoplan"),
    "plan-design-review": ("디자인 전략 리뷰어", "전략 기획팀", "design-plan"),
    "plan-devex-review": ("DX 전략 리뷰어", "전략 기획팀", "dx-plan"),
    "plan-tune": ("AI 페르소나 조율기", "전략 기획팀", "tune"),

    # 품질 검증팀
    "qa": ("품질 통합 테스트", "품질 검증팀", "qa"),
    "qa-only": ("버그 리포트 전용", "품질 검증팀", "bug-report"),
    "investigate": ("장애 원인 분석가", "품질 검증팀", "investigate"),
    "benchmark": ("성능 벤치마크", "품질 검증팀", "benchmark"),
    "benchmark-models": ("모델 비교 분석가", "품질 검증팀", "compare-models"),
    "health": ("코드 품질 감찰관", "품질 검증팀", "health"),
    "browse": ("브라우저 자동화", "품질 검증팀", "browse"),
    "gstack": ("브라우저 오퍼레이터", "품질 검증팀", "gstack"),
    "open-gstack-browser": ("실시간 브라우저 연결", "품질 검증팀", "open-browser"),
    "design-review": ("디자인 품질 검수자", "품질 검증팀", "design-qa"),
    "devex-review": ("DX 품질 심사원", "품질 검증팀", "dx-qa"),
    "canary": ("서비스 가동 모니터", "품질 검증팀", "canary"),

    # 플랫폼 운영팀
    "ship": ("릴리스 매니저", "플랫폼 운영팀", "ship"),
    "land-and-deploy": ("배포 코디네이터", "플랫폼 운영팀", "deploy"),
    "setup-deploy": ("배포 환경 설정", "플랫폼 운영팀", "setup-deploy"),
    "retro": ("주간 개발 회고", "플랫폼 운영팀", "retro"),
    "document-release": ("배포 문서 동기화", "플랫폼 운영팀", "update-docs"),
    "landing-report": ("릴리스 큐 대시보드", "플랫폼 운영팀", "landing-report"),

    # 콘텐츠 자산팀
    "design-consultation": ("디자인 시스템 설계자", "콘텐츠 자산팀", "design-system"),
    "design-shotgun": ("UI 시안 탐색기", "콘텐츠 자산팀", "design-variants"),
    "design-html": ("퍼블리싱 전문가", "콘텐츠 자산팀", "design-html"),
    "make-pdf": ("문서 출판 매니저", "콘텐츠 자산팀", "pdf-gen"),

    # 플랫폼 지원팀
    "cso": ("보안 최고 책임자", "플랫폼 지원팀", "security"),
    "careful": ("안전 가드레일", "플랫폼 지원팀", "safety"),
    "guard": ("전체 보호 모드", "플랫폼 지원팀", "guard-mode"),
    "freeze": ("수정 범위 제한", "플랫폼 지원팀", "freeze"),
    "unfreeze": ("수정 범위 해제", "플랫폼 지원팀", "unfreeze"),
    "learn": ("지식 자산 관리자", "플랫폼 지원팀", "learnings"),
    "context-save": ("컨텍스트 백업", "플랫폼 지원팀", "checkpoint"),
    "context-restore": ("컨텍스트 복구", "플랫폼 지원팀", "resume"),
    "scrape": ("데이터 추출 전문가", "플랫폼 지원팀", "scrape"),
    "skillify": ("워크플로 자동화 전문가", "플랫폼 지원팀", "skillify"),
    "gstack-upgrade": ("시스템 업그레이더", "플랫폼 지원팀", "upgrade"),
    "setup-gbrain": ("지식 동기화 관리", "플랫폼 지원팀", "gbrain"),
    "pair-agent": ("에이전트 페어링", "플랫폼 지원팀", "pair-agent"),
    "setup-browser-cookies": ("쿠키 인증 관리", "플랫폼 지원팀", "cookies")
}

HOME = str(Path.home())
GEMINI_AGENTS_ROOT = Path(HOME) / ".gemini" / "antigravity" / "agents"
GEMINI_SKILLS_ROOT = Path(HOME) / ".gemini" / "antigravity" / "skills"
CODEX_AGENTS_ROOT = Path(HOME) / ".codex" / "agents"
CODEX_SKILLS_ROOT = Path(HOME) / ".codex" / "skills"
CODEX_CONFIG_PATH = Path(HOME) / ".codex" / "config.toml"

def generate_agents(agents_root, skills_root, is_codex=False):
    print(f"--- Generating Agents in {agents_root} ---")
    os.makedirs(agents_root, exist_ok=True)
    
    for skill_base, (role, dept, kw) in GSTACK_MAPPING.items():
        # Determine actual skill directory name and skill name
        if is_codex:
            skill_dir_name = skill_base
            if not skill_base.startswith("gstack"):
                skill_dir_name = f"gstack-{skill_base}"
            if skill_base == "gstack":
                skill_dir_name = "gstack"
            skill_name = skill_dir_name
        else:
            # Gemini naming
            skill_dir_name = skill_base
            if skill_base == "gstack-upgrade":
                skill_dir_name = "gstack-upgrade"
            elif skill_base == "open-gstack-browser":
                skill_dir_name = "open-gstack-browser"
            
            # Remove gstack- prefix for Gemini skill name if it's there
            skill_name = skill_base
            if skill_base.startswith("gstack-") and skill_base != "gstack":
                skill_name = skill_base.replace("gstack-", "")
        
        # Consistent agent name: gstack-{base}-agent
        # Remove existing 'agent' or 'gstack-' from base to avoid redundancy
        agent_base = skill_base.replace("gstack-", "").replace("-agent", "")
        if skill_base == "gstack":
            agent_base = "gstack"
            
        agent_name = f"gstack-{agent_base}-agent"
        agent_dir = agents_root / agent_name
        os.makedirs(agent_dir, exist_ok=True)
        
        config = {
            "name": agent_name,
            "version": "1.2.0",
            "description": f"Executes the GStack {skill_base} skill.",
            "routing_type": "single-skill",
            "skill_name": skill_name,
            "skill_path": str(skills_root / skill_dir_name / "SKILL.md"),
            "department": dept,
            "role_label": role
        }
        
        config_path = agent_dir / "config.json"
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        print(f"  + Created {agent_name} (Skill: {skill_name})")

def update_router(agents_root):
    router_path = agents_root / "router-agent" / "config.json"
    if not router_path.exists():
        print(f"  ! Router not found at {router_path}")
        return
    
    with open(router_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    hints = data.get("routing_hints", {})
    for skill_base, (_, _, kw) in GSTACK_MAPPING.items():
        agent_base = skill_base.replace("gstack-", "").replace("-agent", "")
        if skill_base == "gstack":
            agent_base = "gstack"
        agent_name = f"gstack-{agent_base}-agent"
        
        hints[kw] = agent_name
        # Add skill base name as keyword too
        hints[skill_base] = agent_name
        
    data["routing_hints"] = hints
    
    with open(router_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  + Updated router at {router_path}")

def update_codex_toml():
    if not CODEX_CONFIG_PATH.exists():
        return
    
    content = CODEX_CONFIG_PATH.read_text(encoding="utf-8")
    
    # Simple strategy: append all GStack skills to the end of skills list
    # but check if already exists
    
    new_configs = []
    for skill_base in GSTACK_MAPPING.keys():
        skill_dir_name = skill_base
        if not skill_base.startswith("gstack"):
            skill_dir_name = f"gstack-{skill_base}"
        if skill_base == "gstack":
            skill_dir_name = "gstack"
            
        path = str(CODEX_SKILLS_ROOT / skill_dir_name / "SKILL.md")
        if path not in content:
            new_configs.append(f'\n[[skills.config]]\npath = "{path}"\nenabled = true\n')
    
    if new_configs:
        # Insert before [features]
        if "[features]" in content:
            content = content.replace("[features]", "".join(new_configs) + "\n[features]")
        else:
            content += "".join(new_configs)
            
        CODEX_CONFIG_PATH.write_text(content, encoding="utf-8")
        print(f"  + Updated {CODEX_CONFIG_PATH} with {len(new_configs)} new skills")

if __name__ == "__main__":
    generate_agents(GEMINI_AGENTS_ROOT, GEMINI_SKILLS_ROOT, False)
    update_router(GEMINI_AGENTS_ROOT)
    
    generate_agents(CODEX_AGENTS_ROOT, CODEX_SKILLS_ROOT, True)
    update_router(CODEX_AGENTS_ROOT)
    
    update_codex_toml()
