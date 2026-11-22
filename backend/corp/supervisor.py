"""corp.supervisor — 감독관. 칸반 jobs의 접수·배정·집행·승인.

왜 이 파일인가: ⑦ 감독관 아키텍처의 코드화. 감독은 계획·배정만 하고 손대지
않는다. 직무(duty)→스킬 매칭으로 배정하고, 완료는 인간 결재(approvals)를 거쳐
done이 된다. maker≠checker: 검증 잡은 실행자와 다른 스킬이 맡는다.
"""
from __future__ import annotations

import re
import uuid

from . import executor, registry, store

DUTIES = ("coder", "researcher", "checker", "writer")

# 직무별 가중치: (직무도구, 기본 키워드).
DUTY_PROFILE = {
    "coder": ({"edit", "write", "Bash"},
              ("코드", "구현", "개발", "code", "구축", "리팩", "디버깅", "프로그래밍")),
    "researcher": ({"Read", "webfetch", "websearch", "grep"},
                   ("검색", "조사", "리서치", "search", "research", "수집", "자료", "탐색")),
    "checker": ({"Read", "Bash"},
                ("검증", "리뷰", "테스트", "review", "test", "감사", "진단", "교정")),
    "writer": ({"write", "edit", "Read"},
               ("문서", "작성", "보고", "doc", "report", "글", "기사", "정리")),
}

# 프롬프트 도메인 시맨틱 매핑 — 사용자의 구체적 의도에 맞는 전문 스킬 우선 추천
DOMAIN_SYNONYMS = {
    ("날씨", "기상", "기온", "비", "눈", "태풍", "재해", "지진", "weather", "forecast"): [
        "disaster-monitor"
    ],
    ("코인", "비트코인", "이더리움", "지갑", "온체인", "크립토", "crypto", "가상화폐", "원장", "트랜잭션"): [
        "coin-tracker", "crypto-cycle-detector"
    ],
    ("주식", "주가", "코스피", "나스닥", "재무제표", "증시", "종목", "시세", "주식시장"): [
        "stock-crypto-research", "econ-financial-data-parser-platform", "econ-market-crash-detector"
    ],
    ("기차", "열차", "ktx", "itx", "무궁화", "코레일", "철도", "train"): [
        "korail-train-info"
    ],
    ("버스", "고속버스", "시외버스", "tago", "bus"): [
        "express-bus"
    ],
    ("법률", "법령", "판례", "조문", "소송", "법제처", "법", "law"): [
        "law-openapi"
    ],
    ("의학", "약품", "병원", "질병", "증상", "한의학", "치료", "건강", "의사", "medicine"): [
        "medicine-search"
    ],
    ("ppt", "pptx", "파워포인트", "프레젠테이션", "발표자료", "슬라이드"): [
        "autoppt", "pptx"
    ],
    ("일정", "캘린더", "약속", "달력", "스케줄", "calendar"): [
        "calendar"
    ],
    ("문자", "sms", "imessage"): [
        "send-sms"
    ],
    ("전화", "통화", "call"): [
        "direct-call"
    ],
    ("메일", "이메일", "지메일", "gmail", "email"): [
        "gmail"
    ],
    ("사주", "운세", "주역", "점술", "토정비결", "신년운세"): [
        "saju-yeokhak"
    ],
    ("루머", "찌라시", "오신트", "osint", "커뮤니티동향"): [
        "rumor-radar"
    ],
    ("뉴스", "속보", "rss", "헤드라인", "news"): [
        "news-collector"
    ],
    ("논문", "학술", "kci", "arxiv", "paper"): [
        "paper-writing", "sci-tech-search"
    ],
    ("통계", "데이터분석", "상관관계", "회귀", "statistical", "데이터프로파일링"): [
        "advanced-statistical-analysis"
    ],
    ("영상", "동영상", "모션그래픽", "video", "비디오", "애니메이션"): [
        "motion-video", "hyperframes"
    ],
    ("리팩토링", "리팩터링", "코드리뷰", "tdd", "refactor"): [
        "polyglot-code-review", "hnt-coding-standards", "java-coding-standards"
    ],
    ("그래프", "지식그래프", "graphify", "온톨로지"): [
        "graphify", "hnt-graph", "ontology-designer"
    ],
    ("웹검색", "검색", "구글링", "tavily"): [
        "tavily", "web-search"
    ],
}


def _pick_skill(duty: str, hint: str = "", title: str = "", body: str = "") -> tuple[str, list[str]]:
    """(스킬명, 근거들). hint(수동 지정)가 있으면 그대로 — 감독보다 인간이 우선.
    프롬프트(title+body)를 분석하여 도메인/키워드 일치율이 가장 높은 전문 스킬을 배정한다."""
    if hint:
        return hint, ["수동 지정"]

    tools_want, default_keywords = DUTY_PROFILE.get(duty, (set(), ()))
    query = f"{title} {body}".strip().lower()
    raw_words = [w for w in re.split(r"[\s,.\?!;:\(\)\[\]]+", query) if len(w) >= 2]

    scored = []
    for r in registry.roster():
        if r.get("employment", "active") != "active":
            continue

        name = r["name"].lower()
        desc = (r.get("description") or r.get("label") or "").lower()
        duties = set(r.get("duties") or [])
        tool_hits = sorted(d for d in duties if d in tools_want)

        score = 0
        reasons = []

        # 1. 도메인 시맨틱 매핑 점수 (+18점)
        for syn_keys, target_skills in DOMAIN_SYNONYMS.items():
            for sk in syn_keys:
                if sk in query:
                    if name in target_skills:
                        score += 18
                        reasons.append(f"도메인 일치({sk})")
                        break

        # 2. 스킬명 직접 일치 또는 하이픈 토큰 일치 (+8~20점)
        if name in query or name.replace("-", "") in query.replace(" ", ""):
            score += 20
            reasons.append(f"스킬명 일치({name})")
        else:
            name_parts = [p for p in name.split("-") if len(p) >= 3]
            for p in name_parts:
                if p in query:
                    score += 8
                    reasons.append(f"스킬명 키워드({p})")
                    break

        # 3. 프롬프트 단어와 스킬 설명 간 매칭 (+3점 / 개)
        desc_hits = set()
        for w in raw_words:
            # 한국어 조사 및 불용어 어미 제거
            w_stem = re.sub(r"(으로|에서|에게|은|는|이|가|을|를|과|와|도|만|해줘|조회|확인|요약|작성|검색|분석)$", "", w)
            if len(w_stem) >= 2 and w_stem in desc:
                desc_hits.add(w_stem)
        if desc_hits:
            score += len(desc_hits) * 3
            reasons.append("설명 매칭(" + ",".join(list(desc_hits)[:3]) + ")")

        # 4. 직무 도구 및 기본 키워드 보너스
        kw_hits = sorted(k for k in default_keywords if k.lower() in desc)
        rec = registry.record(r["name"])
        accept = rec.get("accept") or 0

        score += len(tool_hits) * 2 + len(kw_hits) + accept

        if tool_hits:
            reasons.append("직무도구 일치: " + ",".join(tool_hits))
        if accept:
            reasons.append(f"고과 {accept}")

        scored.append((score, len(desc_hits), r["name"], reasons))

    if not scored:
        return "", ["배정 가능 직원 없음"]

    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    score, _, name, reasons = scored[0]
    return name, reasons or ["기본 배정"]


def create_job(title: str, body: str = "", duty: str = "coder",
               skill: str = "", model: str = "") -> str:
    title = (title or "").strip()
    if not title:
        raise ValueError("title required")
    if duty not in DUTIES:
        raise ValueError(f"duty must be one of {DUTIES}")
    jid = uuid.uuid4().hex[:8]
    store.add_job(jid, title[:200], (body or "")[:4000], duty, skill[:80],
                  (model or "")[:80])
    return jid


async def dispatch(jid: str, engine: str = "opencode",
                 model: str | None = None) -> str:
    """배정→집행. run_id 반환. jobs.run에 묶는다. 배정 근거는 note에 남긴다."""
    jobs = [j for j in store.list_jobs() if j["id"] == jid]
    if not jobs:
        raise KeyError(f"no such job: {jid}")
    job = jobs[0]
    if job["status"] not in ("queued", "failed"):
        raise ValueError(f"job not dispatchable: {job['status']}")
    skill, reasons = _pick_skill(job["duty"], job.get("skill", ""),
                                title=job.get("title", ""), body=job.get("body", ""))
    model = model or job.get("model") or None
    prompt = (f"[duty:{job['duty']}] [skill:{skill}]\n"
              f"TITLE: {job['title']}\n{job['body']}\n"
              "RULES: outputs/ 하위에만 결과물을 둔다. "
              "범위 밖 파일을 고치지 않는다. 완료 시 변경 파일 목록을 끝에 명시.")
    rid = await executor.launch(skill or "supervisor", engine, prompt, None, model)
    store.set_job(jid, status="running", run=rid, skill=skill,
                  note="배정: " + " · ".join(reasons))
    return rid


async def settle(jid: str) -> str:
    """run 종료 후 정산: 성공→review(인간 결재 대기), 실패→failed."""
    jobs = [j for j in store.list_jobs() if j["id"] == jid]
    if not jobs:
        raise KeyError(f"no such job: {jid}")
    job = jobs[0]
    rec = await executor.wait(job["run"]) if job["run"] else None
    if rec and rec["status"] == "completed":
        store.set_job(jid, status="review")
        return "review"
    store.set_job(jid, status="failed")
    return "failed"


def approve(jid: str, verdict: str, note: str = "") -> str:
    """인간 결재. approve→done, reject→queued(재집행 가능)."""
    if verdict not in ("approve", "reject"):
        raise ValueError("verdict must be approve|reject")
    store.add_approval(jid, verdict, note)
    store.set_job(jid, status="done" if verdict == "approve" else "queued", run="")
    return store.list_jobs() and verdict
