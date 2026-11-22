/* office3d.js — Genius Corp 3D 사무실 뷰 (custom-codex-agent UI 개조)
 *
 * 왜 이 파일인가: 스킬=직원 회사를 사무실 형상으로 보여주는 것이 이 앱의 새 얼굴이다.
 * 기존 5개 뷰(org/dashboard/console/workflow/inspector)는 기능 백엔드로 남기고,
 * 본 뷰를 기본 착지면으로 삼는다(완전 개조 — 기존 org를 밀어낸다).
 *
 * 보안 규칙: 에이전트 이름·상태 등 외부 데이터는 textContent로만 반영한다.
 *           innerHTML 사용 금지(스킬 요약 등에 스크립트가 섞여도 실행되지 않는다).
 * 비용 규칙(economizer): 탭 비활성·document.hidden이면 rAF를 멈춘다 — GPU·토큰 낭비 금지.
 * 회복성: Three.js CDN 로드 실패(오프라인) 시 2D 카드 격자로 자동 대체한다.
 * 데이터: GET /api/inventory(직원 목록) · GET /api/runs(최근 상태) · GET /api/events(SSE)
 */

const OFFICE = (() => {
  "use strict";

  // ---------- 짧은 헬퍼 ----------
  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const STATUS_COLOR = {
    running: 0x22c55e, completed: 0x22c55e, queued: 0x38bdf8,
    failed: 0xef4444, canceled: 0xf59e0b, idle: 0x64748b,
  };
  const STATUS_KR = { running: "실행중", completed: "완료", queued: "대기", failed: "실패", canceled: "취소", idle: "대기중" };

  // ---------- 상태 ----------
  const state = {
    three: null, scene: null, camera: null, renderer: null, controls: null,
    raf: 0, active: false, built: false, threeOk: false,
    agents: new Map(),          // name -> {label,status,group,worker,ring,screen:{ctx,tex},armL,armR,deskPos,head}
    runAgent: new Map(),        // runId -> agentName (최근 run 매핑)
    focus: null,                // 선택된 agent name
    camTarget: null, camGoal: null,
    ceoInbox: 0, ceoPile: null,
    serverLeds: [], clock: null,
  };

  const ROOT = $("#office-view");
  if (!ROOT) return;

  // ---------- CSS 주입 (head를 건드리지 않기 위해 런타임 로드) ----------
  // 단일 셸(corp)은 index.html이 레거시 경로로 선로딩하므로 중복 주입 금지.
  if (!document.querySelector('link[href$="office3d.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/static/css/office3d.css";
    document.head.appendChild(link);
  }

  // ---------- 안전 텍스트 ----------
  function put(el, text) { if (el) el.textContent = text == null ? "" : String(text); }

  // ---------- 데이터 정규화(방어적) ----------
  function pickList(data) {
    if (Array.isArray(data)) return data;
    for (const k of ["runs", "jobs", "agents", "items", "skills", "entries", "list"]) {
      if (Array.isArray(data?.[k])) return data[k];
    }
    return [];
  }
  function inferDuty(duties) {
    const d = duties || [];
    if (d.includes("webfetch") || d.includes("websearch")) return "researcher";
    if (d.includes("write") && !d.includes("Bash")) return "writer";
    if (d.includes("Read") && !d.includes("edit")) return "checker";
    return "coder";
  }
  function normAgent(raw, i) {
    const name = String(raw?.name ?? raw?.agent_name ?? raw?.id ?? `agent-${i}`);
    const label = String(raw?.label ?? raw?.title ?? raw?.display_name ?? name);
    const status = String(raw?.status ?? "idle").toLowerCase();
    return { name, label, status, duty: inferDuty(raw?.duties) };
  }
  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  // ---------- 직원 명부(HUD) ----------
  function renderRoster() {
    const ul = $("#office-roster-list");
    if (!ul) return;
    ul.replaceChildren();
    const q = (state.rosterFilter || "").toLowerCase();
    const names = [...state.agents.keys()].sort()
      .filter((n) => !q || n.toLowerCase().includes(q)
        || (state.agents.get(n).label || "").toLowerCase().includes(q));
    for (const name of names) {
      const a = state.agents.get(name);
      const li = document.createElement("li");
      li.className = "roster-item";
      li.dataset.agent = name;
      const dot = document.createElement("span");
      dot.className = "roster-dot";
      dot.style.background = "#" + (STATUS_COLOR[a.status] ?? STATUS_COLOR.idle).toString(16).padStart(6, "0");
      const nm = document.createElement("span");
      nm.className = "roster-name";
      nm.title = a.label;
      put(nm, a.name);
      const st = document.createElement("span");
      st.className = "roster-status";
      put(st, STATUS_KR[a.status] ?? a.status);
      li.append(dot, nm, st);
      li.addEventListener("click", () => selectAgent(name));
      ul.appendChild(li);
    }
    put($("#hud-agents"), `${names.length}명`);
  }

  // ---------- 3D 구축 ----------
  async function ensureThree() {
    if (state.threeOk) return true;
    try {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
      const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
      const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      Object.assign(state, { three: THREE, OrbitControls, EffectComposer, RenderPass,
        UnrealBloomPass, OutputPass, RoomEnvironment, threeOk: true });
      return true;
    } catch (err) {
      console.warn("[office3d] three 로드 실패 — 2D 대체", err);
      state.threeFailed = true;
      showFallback();
      return false;
    }
  }

  function showFallback() {
    const fb = $("#office-fallback");
    if (!fb) return;
    fb.classList.remove("hidden");
    fb.replaceChildren();
    const note = document.createElement("p");
    note.className = "fallback-note";
    put(note, "3D 엔진 로드 실패(오프라인) — 2D 사무실로 대체합니다.");
    const grid = document.createElement("div");
    grid.className = "fallback-grid";
    fb.append(note, grid);
    for (const a of state.agents.values()) {
      const card = document.createElement("div");
      card.className = "fallback-card";
      const t = document.createElement("strong");
      put(t, a.label);
      const s = document.createElement("small");
      put(s, STATUS_KR[a.status] ?? a.status);
      card.append(t, s);
      grid.appendChild(card);
    }
  }

  function makeCanvasTexture(w, h, draw) {
    const THREE = state.three;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, ctx, cv, w, h };
  }

  function drawScreen(ctx, w, h, label, status) {
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#101a2e"; ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "600 20px 'Apple SD Gothic Neo', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label).slice(0, 14), 10, 18);
    const col = "#" + (STATUS_COLOR[status] ?? STATUS_COLOR.idle).toString(16).padStart(6, "0");
    ctx.fillStyle = col; ctx.fillRect(0, 34, w, 6);
    ctx.font = "500 17px 'Apple SD Gothic Neo', sans-serif";
    ctx.fillText((STATUS_KR[status] ?? status) + (status === "running" ? " …" : ""), 10, 64);
    if (status === "running") {
      ctx.fillStyle = col;
      for (let i = 0; i < 6; i++) ctx.fillRect(10 + i * 34, 92 + Math.sin(Date.now() / 240 + i) * 10, 18, 40);
    }
  }

  function nameHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function makeNameSprite(text) {
    const THREE = state.three;
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 112;
    const c = cv.getContext("2d");
    const label = String(text).slice(0, 20);
    c.font = "600 44px 'Apple SD Gothic Neo', sans-serif";
    const tw = Math.min(470, c.measureText(label).width + 56);
    const x0 = (512 - tw) / 2;
    c.fillStyle = "rgba(8,12,24,0.78)";
    c.beginPath(); c.roundRect(x0, 18, tw, 76, 38); c.fill();
    c.strokeStyle = "rgba(147,197,253,0.55)"; c.lineWidth = 3; c.stroke();
    c.fillStyle = "#e8eefc"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(label, 256, 58);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(1.55, 0.34, 1);
    return sp;
  }

  function makeWorkingBadgeSprite() {
    const THREE = state.three;
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 128;
    const c = cv.getContext("2d");
    c.fillStyle = "rgba(16, 185, 129, 0.95)";
    c.beginPath(); c.roundRect(40, 16, 432, 96, 48); c.fill();
    c.strokeStyle = "#86efac"; c.lineWidth = 6; c.stroke();
    c.fillStyle = "#ffffff"; c.font = "bold 50px 'Apple SD Gothic Neo', sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("⚡ 작업중 (RUNNING)", 256, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(1.65, 0.42, 1);
    sp.visible = false;
    return sp;
  }

  // 시드 난수 — 같은 스킬은 항상 같은 얼굴 (멀티턴 일관성)
  function rng32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SKINS = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xf0c8a0];
  const DUTY_HUE = { coder: 0.6, researcher: 0.08, checker: 0.33, writer: 0.78 };

  // 게임 캐릭터 생성 — 직무별 아키타입 + 해시 변형. 반환 {body,head,armL,armR}
  function buildCharacter(agent, parent) {
    const THREE = state.three;
    const rnd = rng32(nameHash(agent.name) ^ 0x9e3779b9);
    const duty = (agent.dutyHint || "coder");
    const baseHue = DUTY_HUE[duty] ?? 0.6;
    const shirt = new THREE.Color().setHSL(
      (baseHue + (rnd() - 0.5) * 0.12 + 1) % 1, 0.72, 0.4 + rnd() * 0.1);
    const pants = new THREE.Color().setHSL(rnd(), 0.4, 0.16 + rnd() * 0.1);
    const skin = new THREE.Color(SKINS[Math.floor(rnd() * SKINS.length)]);
    const M = (c, r = 0.55, m = 0) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const parts = [];
    const add = (mesh) => { mesh.castShadow = true; parent.add(mesh); parts.push(mesh); return mesh; };

    // 다리
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.34, 8);
    const legMat = M(pants);
    for (const s of [-1, 1]) {
      const leg = add(new THREE.Mesh(legGeo, legMat));
      leg.position.set(s * 0.09, 0.72, 0.42);
    }
    // 몸통 — 3체형
    const torsoKind = Math.floor(rnd() * 3);
    const torsoMat = M(shirt);
    let body;
    if (torsoKind === 0) body = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 4, 10), torsoMat));
    else if (torsoKind === 1) body = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.52, 0.22), torsoMat));
    else body = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, 0.52, 10), torsoMat));
    body.position.set(0, 1.02, 0.42);
    // 벨트
    const belt = add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.24),
      M(0x1f2937, 0.4, 0.3)));
    belt.position.set(0, 0.82, 0.42);
    // 머리 — 3두형
    const headKind = Math.floor(rnd() * 3);
    let head;
    if (headKind === 0) head = add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), M(skin, 0.8)));
    else if (headKind === 1) head = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), M(skin, 0.8)));
    else head = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.2, 10), M(skin, 0.8)));
    head.position.set(0, 1.34, 0.42);
    // 눈 (발광 — 어둠에서 얼굴이 보인다)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b1020 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeMat);
      eye.position.set(s * 0.045, 1.36, 0.42 + (headKind === 1 ? 0.1 : 0.105));
      parent.add(eye);
    }
    // 팔
    const armGeo = new THREE.CapsuleGeometry(0.045, 0.22, 3, 8);
    const armL = add(new THREE.Mesh(armGeo, torsoMat));
    armL.position.set(-0.2, 1.02, 0.18); armL.rotation.x = 0.9;
    const armR = add(new THREE.Mesh(armGeo, torsoMat));
    armR.position.set(0.2, 1.02, 0.18); armR.rotation.x = 0.9;

    // 직무 장신구
    if (duty === "coder") {
      // 고글
      const gMat = M(0x111827, 0.25, 0.6);
      for (const s of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), gMat);
        g.position.set(s * 0.05, 1.37, 0.52);
        parent.add(g);
      }
    } else if (duty === "researcher") {
      // 안테나 + 접시
      const ant = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), M(0x9ca3af, 0.3, 0.7)));
      ant.position.set(0.08, 1.55, 0.42);
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.05, 10),
        new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
      dish.position.set(0.08, 1.72, 0.42); dish.rotation.x = Math.PI;
      parent.add(dish);
    } else if (duty === "checker") {
      // 가슴 방패 휘장
      const sh = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.8 })));
      sh.position.set(-0.08, 1.1, 0.3); sh.rotation.z = 0.15;
    } else {
      // 두루마리 (문서통)
      const sc = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8),
        M(0xf5f0e1, 0.7)));
      sc.position.set(0.26, 1.0, 0.3); sc.rotation.z = 0.5;
    }
    // 해시 장신구 — 모자/귀/뿔/머플러/배낭 중 1~2개
    const picks = ["hat", "ears", "horns", "scarf", "pack"];
    const first = picks[Math.floor(rnd() * picks.length)];
    const acc = M(new THREE.Color().setHSL(rnd(), 0.65, 0.45), 0.6);
    if (first === "hat") {
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), acc));
      brim.position.set(0, 1.45, 0.42);
      const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.14, 12), acc));
      top.position.set(0, 1.53, 0.42);
    } else if (first === "ears") {
      for (const s of [-1, 1]) {
        const e = add(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 6), M(skin, 0.8)));
        e.position.set(s * 0.13, 1.42, 0.42); e.rotation.z = -s * 0.35;
      }
    } else if (first === "horns") {
      const hMat = M(0xe5e7eb, 0.4);
      for (const s of [-1, 1]) {
        const h = add(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, 6), hMat));
        h.position.set(s * 0.08, 1.47, 0.42); h.rotation.z = -s * 0.3;
      }
    } else if (first === "scarf") {
      const sc = add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 14), acc));
      sc.position.set(0, 1.24, 0.42); sc.rotation.x = Math.PI / 2 - 0.2;
    } else {
      const pk = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.1), acc));
      pk.position.set(0, 1.05, 0.56);
    }
    return { worker: body, head, armL, armR };
  }

  function buildStation(agent, ix) {
    const THREE = state.three;
    const group = new THREE.Group();
    // 3층 사옥: 층당 24석(6열×4행). 층은 이름 해시로 분산(같은 팀이 흩어지지 않게 해시 고정).
    const PER_FLOOR = 24, COLS = 6, FLOOR_H = 4.6;
    const slot = ix % PER_FLOOR, floor = Math.floor(ix / PER_FLOOR);
    const col = slot % COLS, row = Math.floor(slot / COLS);
    const x = -10 + col * 4, z = -6.3 + row * 4.2, fy = floor * FLOOR_H;
    group.position.set(x, fy, z);
    agent.floor = floor;

    // 책상 — 따뜻한 우드 상판 + 다크메탈 다리
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.45, metalness: 0.1 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3446, roughness: 0.35, metalness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.9), deskMat);
    top.position.y = 0.78; top.castShadow = true; top.receiveShadow = true;
    group.add(top);
    const legGeo = new THREE.BoxGeometry(0.07, 0.78, 0.07);
    for (const [lx, lz] of [[-0.78, -0.38], [0.78, -0.38], [-0.78, 0.38], [0.78, 0.38]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.39, lz);
      group.add(leg);
    }

    // 모니터 — 베젤 + 발광 스크린(블룸이 받는다)
    const scr = makeCanvasTexture(256, 150, (c, w, h) => drawScreen(c, w, h, agent.label, agent.status));
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.68, 0.05), legMat);
    bezel.position.set(0, 1.22, -0.235); bezel.rotation.x = -0.06;
    const monMat = new THREE.MeshBasicMaterial({ map: scr.tex });
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.6), monMat);
    mon.position.set(0, 1.22, -0.207); mon.rotation.x = -0.06;
    group.add(bezel, mon);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), legMat);
    stand.position.set(0, 0.95, -0.22); group.add(stand);

    // 상태 링 (바닥, 발광)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.05, 10, 48),
      new THREE.MeshBasicMaterial({ color: STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle })
    );
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
    group.add(ring);

    // 의자
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.4), chairMat);
    seat.position.set(0, 0.5, 0.95); seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.07), chairMat);
    back.position.set(0, 0.85, 1.14);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), legMat);
    post.position.set(0, 0.25, 0.95);
    group.add(seat, back, post);

    // 직원 — 게임 캐릭터 생성 (직무 아키타입 + 해시 변형, 같은 스킬은 항상 같은 얼굴)
    agent.dutyHint = agent.duty || "coder";
    const _ch = buildCharacter(agent, group);
    const body = _ch.worker, head = _ch.head, armL = _ch.armL, armR = _ch.armR;

    // 이름 스프라이트 (항상 카메라를 본다)
    const tag = makeNameSprite(agent.name);
    tag.position.set(0, 1.78, 0.3);
    group.add(tag);

    // 작업 중 발광 배너 스프라이트 (이름 위 상시 표시)
    const workingBadge = makeWorkingBadgeSprite();
    workingBadge.position.set(0, 2.24, 0.3);
    workingBadge.visible = (agent.status === "running");
    group.add(workingBadge);

    // 작업 중 수직 발광 빔 (원거리에서도 즉시 식별 가능한 오라)
    const beamGeo = new THREE.CylinderGeometry(0.75, 1.05, 4.2, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 2.1, 0.3);
    beam.visible = (agent.status === "running");
    group.add(beam);

    agent.group = group; agent.worker = body; agent.head = head;
    agent.armL = armL; agent.armR = armR; agent.ring = ring;
    agent.workingBadge = workingBadge; agent.workingBeam = beam;
    agent.screen = scr; agent.deskPos = new THREE.Vector3(x, fy + 1, z);
    agent.phase = Math.random() * Math.PI * 2;
    state.scene.add(group);
  }

  function buildCEO() {
    const THREE = state.three;
    const BY = 9.2;   // 3층 (사장실)
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.5, metalness: 0.15 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.2), mat);
    top.position.set(9, BY + 0.82, -5); top.castShadow = true;
    const plate = makeCanvasTexture(256, 96, (c, w, h) => {
      c.fillStyle = "#160f2e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fbbf24"; c.font = "700 24px 'Apple SD Gothic Neo', sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("대표이사 (인간)", w / 2, h / 2 - 12);
      c.fillStyle = "#94a3b8"; c.font = "500 16px sans-serif";
      c.fillText("승인 결재대", w / 2, h / 2 + 16);
    });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.04),
      new THREE.MeshBasicMaterial({ map: plate.tex }));
    sign.position.set(9, BY + 1.5, -4.45);
    g.add(top, sign);
    // 수함 결재 더미
    state.ceoPile = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc }));
      p.position.set(9.5, BY + 0.9 + i * 0.024, -4.8);
      state.ceoPile.add(p);
    }
    state.ceoDesk = new THREE.Vector3(9.5, BY + 1.0, -4.8);
    g.add(state.ceoPile);
    state.scene.add(g);
  }

  function buildDecor() {
    const THREE = state.three;
    const FLOORS = 3, FLOOR_H = 4.6, SLAB_W = 27, SLAB_D = 19;
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x131a2c, roughness: 0.32, metalness: 0.55 });
    // 층 슬래브 + 그리드 + 기둥 + 유리 난간
    for (let f = 0; f < FLOORS; f++) {
      const fy = f * FLOOR_H;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(SLAB_W, 0.3, SLAB_D), slabMat);
      slab.position.y = fy - 0.15; slab.receiveShadow = true;
      state.scene.add(slab);
      const grid = new THREE.GridHelper(SLAB_W, 27, 0x35507a, 0x1d2942);
      grid.scale.z = SLAB_D / SLAB_W;
      grid.position.y = fy + 0.005;
      grid.material.transparent = true; grid.material.opacity = 0.5;
      state.scene.add(grid);
    }
    const colGeo = new THREE.CylinderGeometry(0.16, 0.2, FLOOR_H, 10);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x39465e, roughness: 0.4, metalness: 0.7 });
    for (let f = 0; f < FLOORS - 1; f++) {
      for (const [cx, cz] of [[-12.5, -8.5], [12.5, -8.5], [-12.5, 8.5], [12.5, 8.5]]) {
        const c = new THREE.Mesh(colGeo, colMat);
        c.position.set(cx, f * FLOOR_H + FLOOR_H / 2, cz);
        c.castShadow = true;
        state.scene.add(c);
      }
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0x7ea6ff, transparent: true,
      opacity: 0.22, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide });
    for (let f = 1; f < FLOORS; f++) {
      const fy = f * FLOOR_H;
      const mk = (w, d, x, z) => {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.95), railMat);
        r.position.set(x, fy + 0.48, z);
        if (d === 0) r.rotation.y = Math.PI / 2;
        state.scene.add(r);
      };
      mk(SLAB_W, 1, 0, -SLAB_D / 2); mk(SLAB_W, 1, 0, SLAB_D / 2);
      mk(SLAB_D, 0, -SLAB_W / 2, 0); mk(SLAB_D, 0, SLAB_W / 2, 0);
    }
    // 층 표지판 (1F/2F/3F)
    for (let f = 0; f < FLOORS; f++) {
      const plate = makeCanvasTexture(128, 64, (c, w, h) => {
        c.fillStyle = "#0b1220"; c.fillRect(0, 0, w, h);
        c.fillStyle = "#93c5fd"; c.font = "700 34px sans-serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(`${f + 1}F`, w / 2, h / 2);
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45),
        new THREE.MeshBasicMaterial({ map: plate.tex }));
      sign.position.set(-SLAB_W / 2 - 0.05, f * FLOOR_H + 2.2, SLAB_D / 2 - 1);
      sign.rotation.y = -Math.PI / 2;
      state.scene.add(sign);
    }
    // 뒷벽 + 창 (3층 높이)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x232c40, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(46, 15), wallMat);
    wall.position.set(0, 6.5, -12.5); state.scene.add(wall);
    for (let f = 0; f < 3; f++) {
      for (let i = 0; i < 5; i++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.1),
          new THREE.MeshBasicMaterial({ color: 0x9ec5ff }));
        win.position.set(-14 + i * 7, f * 4.6 + 2.6, -12.45);
        state.scene.add(win);
      }
    }
    // 화분
    for (const px of [-16, -8, 4, 12]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.36, 10),
        new THREE.MeshStandardMaterial({ color: 0x7c4a2d }));
      pot.position.set(px, 0.18, -11.6);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 8),
        new THREE.MeshStandardMaterial({ color: 0x2f9e44 }));
      leaf.position.set(px, 0.85, -11.6);
      state.scene.add(pot, leaf);
    }
    // 회의 테이블(오른쪽)
    const mt = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: 0x6b5240 }));
    mt.position.set(11, 0.75, 4); mt.castShadow = true;
    state.scene.add(mt);
    // hmemory 서버랙 (LED 점멸 — 기억 저장소 표현)
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.4 }));
    rack.position.set(-17.5, 1.1, -10.8); rack.castShadow = true;
    state.scene.add(rack);
    for (let r = 0; r < 5; r++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x22c55e }));
      led.position.set(-17.5 + 0.25, 0.5 + r * 0.32, -10.39);
      state.scene.add(led); state.serverLeds.push(led);
    }
    // A2A 항구 문 (4단계 — 잠김)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x334155 }));
    door.position.set(-19.9, 1.2, 2); door.rotation.y = Math.PI / 2;
    state.scene.add(door);
  }

  function buildScene() {
    const THREE = state.three;
    const canvas = $("#office-canvas");
    const wrap = $("#office-canvas-wrap");
    state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    state.renderer.setPixelRatio(clamp(window.devicePixelRatio, 1, 2));
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.05;
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0a0f1e);
    state.scene.fog = new THREE.Fog(0x0a0f1e, 40, 88);
    // 이미지 기반 조명(RoomEnvironment) — PBR 재질이 살아난다
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      state.scene.environment = pmrem.fromScene(new state.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch { /* 환경 실패해도 진행 */ }
    state.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
    state.camera.position.set(30, 26, 36);   // 인트로: 멀리서 활강
    state.controls = new state.OrbitControls(state.camera, canvas);
    state.controls.enableDamping = true; state.controls.dampingFactor = 0.08;
    state.controls.maxPolarAngle = Math.PI * 0.49;
    state.controls.target.set(0, 0.8, 0);
    state.camGoal = new THREE.Vector3(0, 3.6, -1);
    state.camPos = new THREE.Vector3(17.5, 13.5, 21.5);
    state.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a3348, 0.75));
    const dir = new THREE.DirectionalLight(0xfff2df, 1.5);
    dir.position.set(10, 15, 8); dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -26; dir.shadow.camera.right = 26;
    dir.shadow.camera.top = 26; dir.shadow.camera.bottom = -26;
    dir.shadow.bias = -0.0004;
    state.scene.add(dir);
    // 천장 발광 패널(블룸이 받아 빛난다 — 실제 광원은 위 2개뿐, 성능 규율)
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xcfe4ff });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), panelMat);
      p.position.set(-12.5 + i * 5, 5.9, -2);
      p.rotation.x = Math.PI / 2;
      state.scene.add(p);
    }
    // 부유 먼지(가산 블렌딩 포인트 — 값싼 화려함)
    {
      const N = 260, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 40;
        pos[i * 3 + 1] = Math.random() * 6 + 0.3;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: 0x7ea6ff, size: 0.05,
        transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
        depthWrite: false });
      state.dust = new THREE.Points(g, m);
      state.scene.add(state.dust);
    }
    // 포스트프로세싱: 블룸(은은하게) — 실패 시 직접 렌더로 추락
    try {
      const w = wrap.clientWidth || 2, h = wrap.clientHeight || 2;
      state.composer = new state.EffectComposer(state.renderer);
      state.composer.setPixelRatio(clamp(window.devicePixelRatio, 1, 2));
      state.composer.setSize(w, h);
      state.composer.addPass(new state.RenderPass(state.scene, state.camera));
      const bloom = new state.UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 0.9);
      state.composer.addPass(bloom);
      state.composer.addPass(new state.OutputPass());
    } catch { state.composer = null; }
    buildDecor(); buildCEO();
    const names = [...state.agents.keys()];
    names.forEach((n, i) => buildStation(state.agents.get(n), i));
    state.built = true;
    resize();
  }

  // ---------- 애니메이션 루프 ----------
  const clock3 = { last: 0 };
  function tick(now) {
    if (!state.active || !state.built) { state.raf = 0; return; }
    state.raf = requestAnimationFrame(tick);
    const t = now / 1000;
    const dt = Math.min(0.05, t - (clock3.last || t)); clock3.last = t;
    for (const a of state.agents.values()) {
      if (!a.worker) continue;
      // 포즈 목표 — 상태별 연기로 보간한다 (뚝뚝 끊기지 않게)
      const P = a.pose || (a.pose = { bx: 0, alx: 0.9, arx: 0.9, hx: 0, hz: 0, hy: 0, bo: 0 });
      let tgt;
      if (a.status === "running") {
        // 신나게 타이핑: 통통 튐 + 고개 끄덕 + 링 회전
        tgt = { bx: 0.12, bo: Math.abs(Math.sin(t * 10 + a.phase)) * 0.05,
          alx: 0.9 + Math.sin(t * 14 + a.phase) * 0.22,
          arx: 0.9 - Math.sin(t * 14 + a.phase) * 0.22,
          hx: Math.sin(t * 7 + a.phase) * 0.12, hz: 0, hy: 0 };
        a.ring.rotation.z += dt * 2.5;
      } else if (a.status === "completed") {
        // 편안한 휴식: 의자에 기대고 팔 내리고 고개 삐딱
        tgt = { bx: -0.38, bo: 0, alx: 0.15, arx: 0.15,
          hx: -0.1, hz: 0.18, hy: Math.sin(t * 1.2 + a.phase) * 0.1 };
      } else if (a.status === "failed") {
        // 당황: 고개 좌우 흔들
        tgt = { bx: 0.05, bo: 0, alx: 0.9, arx: 0.9,
          hx: 0, hz: 0, hy: Math.sin(t * 9 + a.phase) * 0.35 };
      } else {
        // 대기: 호흡
        tgt = { bx: 0, bo: 0, alx: 0.9, arx: 0.9, hx: 0, hz: 0, hy: 0 };
      }
      const k = Math.min(1, dt * 6);
      P.bx += (tgt.bx - P.bx) * k; P.bo += (tgt.bo - P.bo) * k;
      P.alx += (tgt.alx - P.alx) * k; P.arx += (tgt.arx - P.arx) * k;
      P.hx += (tgt.hx - P.hx) * k; P.hz += (tgt.hz - P.hz) * k; P.hy += (tgt.hy - P.hy) * k;
      a.worker.rotation.x = P.bx;
      a.worker.position.y = 1.02 + P.bo;
      a.armL.rotation.x = P.alx; a.armR.rotation.x = P.arx;
      a.head.rotation.x = P.hx; a.head.rotation.z = P.hz; a.head.rotation.y = P.hy;
      a.worker.scale.y = a.status === "running" ? 1
        : 1 + Math.sin(t * 1.4 + a.phase) * 0.012;
      const pulse = a.status === "failed" ? 0.75 + Math.abs(Math.sin(t * 6)) * 0.5 : 1;
      a.ring.material.color.setHex(STATUS_COLOR[a.status] ?? STATUS_COLOR.idle);
      a.ring.scale.setScalar(pulse);

      // 작업 중 3D 뱃지 및 수직 발광 빔 실시간 애니메이션
      const isRunning = a.status === "running";
      if (a.workingBadge) {
        a.workingBadge.visible = isRunning;
        if (isRunning) {
          a.workingBadge.position.y = 2.24 + Math.sin(t * 6 + a.phase) * 0.08;
        }
      }
      if (a.workingBeam) {
        a.workingBeam.visible = isRunning;
        if (isRunning) {
          a.workingBeam.rotation.y += dt * 1.2;
          a.workingBeam.material.opacity = 0.22 + Math.abs(Math.sin(t * 5 + a.phase)) * 0.16;
        }
      }

      if (a.screen && t - (a.screenDrawn || 0) > 0.5) {
        drawScreen(a.screen.ctx, a.screen.w, a.screen.h, a.label, a.status);
        a.screen.tex.needsUpdate = true; a.screenDrawn = t;
      }
    }
    state.serverLeds.forEach((led, i) => {
      led.material.color.setHex(Math.sin(t * 3 + i * 1.7) > 0 ? 0x22c55e : 0x14532d);
    });
    if (state.ceoPile) state.ceoPile.children.length && (state.ceoPile.rotation.y += dt * 0.15);
    // 먼지 드리프트
    if (state.dust) {
      const p = state.dust.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * 0.06;
        if (y > 6.4) y = 0.2;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    // 선택 마커 보빙
    if (state.marker && state.marker.visible) {
      state.marker.position.y += Math.sin(t * 3) * dt * 0.25;
      state.marker.rotation.y += dt * 1.5;
    }
    // 카메라 포커스 트윈
    if (state.camGoal && state.controls) {
      state.controls.target.lerp(state.camGoal, dt * 4);
      state.camera.position.lerp(state.camPos || state.controls.target, dt * 3);
      if (state.controls.target.distanceTo(state.camGoal) < 0.05) { state.camGoal = null; }
    }
    state.controls.update();
    if (state.composer) state.composer.render();
    else state.renderer.render(state.scene, state.camera);
  }
  function startLoop() {
    if (!state.raf && state.active && state.built) state.raf = requestAnimationFrame(tick);
  }
  function stopLoop() { if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; } }

  function resize() {
    if (!state.built) return;
    const wrap = $("#office-canvas-wrap");
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    state.renderer.setSize(w, h, false);
    if (state.composer) state.composer.setSize(w, h);
    state.camera.aspect = w / h; state.camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  // ---------- 이벤트 효과 ----------
  function flyPaper(agentName) {
    if (!state.threeOk || !state.built) return;
    const THREE = state.three;
    const a = state.agents.get(agentName);
    if (!a) return;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide }));
    const from = a.deskPos.clone();
    const to = (state.ceoDesk || new THREE.Vector3(9.5, 10.2, -4.8)).clone();
    const mid = from.clone().lerp(to, 0.5); mid.y += 3.2;
    state.scene.add(paper);
    const t0 = performance.now();
    (function step() {
      const k = clamp((performance.now() - t0) / 1400, 0, 1);
      const p1 = from.clone().lerp(mid, k);
      const p2 = mid.clone().lerp(to, k);
      paper.position.copy(p1.lerp(p2, k));
      paper.rotation.z = k * 4;
      if (k < 1) requestAnimationFrame(step);
      else {
        state.scene.remove(paper);
        state.ceoInbox = Math.min(8, state.ceoInbox + 1);
        if (state.ceoPile) state.ceoPile.visible = state.ceoInbox > 0;
      }
    })();
  }

  // ---------- 데이터 동기화 ----------
  let syncing = false;
  async function syncInventory() {
    if (syncing) return; syncing = true;
    try {
      const data = await fetchJSON("/api/inventory");
      const list = pickList(data).map(normAgent);
      const next = new Map(list.map((a) => [a.name, a]));
      // 기존 상태 보존(목록 API에 상태가 없을 수 있음)
      for (const [name, prev] of state.agents) {
        if (next.has(name)) next.get(name).status = prev.status;
      }
      const THREE = state.three;
      // 퇴사(제거) — 씬 완성 전에는 데이터만 정리
      for (const [name, a] of state.agents) {
        if (!next.has(name)) {
          if (a.group && state.built) { state.scene.remove(a.group); disposeGroup(a.group); }
          state.agents.delete(name);
        }
      }
      // 신규입사(추가) — 씬 완성 전에는 데이터만 적재, 책상은 buildScene이 일괄 배치
      let ix = 0;
      for (const [name, a] of next) {
        const prev = state.agents.get(name);
        if (!prev) {
          if (state.built) { buildStation(a, state.agents.size + ix); ix += 1; }
          else { a.group = null; }
        } else Object.assign(prev, { label: a.label, duty: a.duty });
        if (!prev) state.agents.set(name, a);
      }
      renderRoster();
      if (state.threeFailed) showFallback();
    } catch (err) {
      console.warn("[office3d] inventory 실패", err);
    } finally { syncing = false; }
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [].concat(o.material)) {
          if (m.map) m.map.dispose(); m.dispose();
        }
      }
    });
  }

  function updateHudRunning(activeNames) {
    const hud = $("#hud-events");
    if (!hud) return;
    if (activeNames && activeNames.length) {
      const first = activeNames[0];
      const more = activeNames.length > 1 ? ` 외 ${activeNames.length - 1}건` : "";
      put(hud, `⚡ [${first}] 작업중${more}`);
      hud.style.color = "#86efac";
      hud.style.fontWeight = "700";
      hud.style.cursor = "pointer";
      hud.title = "클릭 시 일하고 있는 직원 위치로 카메라 이동";
      hud.onclick = () => selectAgent(first);
    } else {
      put(hud, "대기중 (유휴)");
      hud.style.color = "";
      hud.style.fontWeight = "";
      hud.style.cursor = "default";
      hud.onclick = null;
    }
  }

  let reconcileTimer = 0;
  async function reconcileRuns() {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(async () => {
      try {
        const [runsData, jobsData] = await Promise.all([
          fetchJSON("/api/runs?limit=40").catch(() => null),
          fetchJSON("/api/jobs").catch(() => null),
        ]);
        const rows = pickList(runsData);
        const jobs = pickList(jobsData);
        const activeAgents = new Set();
        const latestStatus = new Map();

        // 1. 칸반 jobs 확인
        for (const j of jobs) {
          if (j.status === "running" && j.skill) {
            activeAgents.add(j.skill);
            latestStatus.set(j.skill, "running");
          }
        }

        // 2. runs 테이블 확인
        for (const r of rows) {
          const name = r?.agent_name ?? r?.agentName ?? r?.agent;
          const status = String(r?.status ?? "idle").toLowerCase();
          if (!name) continue;
          if (r?.id && name) state.runAgent.set(r.id, name);
          if (status === "running") {
            activeAgents.add(name);
          }
          if (!latestStatus.has(name)) latestStatus.set(name, status);
        }

        // 3. 에이전트 3D 상태 즉각 반영
        for (const [name, a] of state.agents) {
          if (activeAgents.has(name)) {
            a.status = "running";
          } else if (latestStatus.has(name)) {
            a.status = latestStatus.get(name);
          } else {
            a.status = "idle";
          }
        }
        renderRoster();
        updateHudRunning([...activeAgents]);
      } catch { /* 조용히 무시 — SSE가 실시간을 담당 */ }
    }, 50);
  }

  function handleSSE(type, payload) {
    if (!String(type).startsWith("run:")) return;
    const runId = payload?.runId;
    const agentName = payload?.agent;

    if (agentName) {
      if (runId) state.runAgent.set(runId, agentName);
      const a = state.agents.get(agentName);
      if (a) {
        if (type === "run:started" || type === "run:queued") {
          a.status = "running";
          renderRoster();
          updateHudRunning([agentName]);
        } else if (type === "run:completed" || type === "run:failed" || type === "run:review") {
          a.status = type === "run:failed" ? "failed" : "completed";
          if (type !== "run:failed") flyPaper(agentName);
          renderRoster();
          reconcileRuns();
        }
      }
    }
    reconcileRuns();
    put($("#hud-events"), `${type} · ${new Date().toLocaleTimeString("ko-KR")}`);
  }

  function connectSSE() {
    try {
      const es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          handleSSE(msg.type, msg.payload);
        } catch { /* heartbeat 등 */ }
      };
      es.onerror = () => { /* 자동 재접속에 맡긴다 */ };
    } catch { /* SSE 미지원 — 폴링만 */ }
    // 실시간 확인: 2.5초마다 실행 중인 작업 확인
    setInterval(reconcileRuns, 2500);
    setInterval(syncInventory, 30000);
    reconcileRuns();
  }

  // ---------- 선택·포커스 ----------
  function ensureMarker() {
    if (state.marker || !state.threeOk) return;
    const THREE = state.three;
    state.marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
    state.marker.visible = false;
    state.scene.add(state.marker);
  }
  function selectAgent(name) {
    const a = state.agents.get(name);
    if (!a) return;
    state.focus = name;
    if (state.threeOk) {
      ensureMarker();
      state.camGoal = a.deskPos.clone();
      state.camPos = a.deskPos.clone().add(new (state.three.Vector3)(2.6, 3.4, 3.2));
      state.marker.visible = true;
      state.marker.position.copy(a.deskPos).add(new (state.three.Vector3)(0, 2.35, 0));
    }
    const card = $("#office-agent-card");
    if (card) {
      card.classList.remove("hidden");
      put($("#oc-name"), a.label);
      put($("#oc-status"), STATUS_KR[a.status] ?? a.status);
      put($("#oc-id"), name);
      card.style.borderColor = "#" + (STATUS_COLOR[a.status] ?? STATUS_COLOR.idle).toString(16).padStart(6, "0");
    }
    document.querySelectorAll(".roster-item").forEach((li) =>
      li.classList.toggle("selected", li.dataset.agent === name));
  }

  function bindRaycast() {
    if (!state.threeOk) return;
    const canvas = $("#office-canvas");
    const ray = new state.three.Raycaster();
    let down = null;
    canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // 드래그=궤도
      const rect = canvas.getBoundingClientRect();
      const v = new state.three.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(v, state.camera);
      const hits = ray.intersectObjects([...state.agents.values()].map((a) => a.group).filter(Boolean), true);
      if (!hits.length) return;
      let obj = hits[0].object;
      while (obj && obj.parent !== state.scene) obj = obj.parent;
      for (const [name, a] of state.agents) if (a.group === obj) { selectAgent(name); break; }
    });
  }

  // ---------- 탭 연동 (app.js와 충돌 없이 자기 뷰만 관리) ----------
  const LEGACY_TABS = ["org", "dashboard", "console", "workflow", "inspector"];
  function activateOffice() {
    state.active = true;
    ROOT.classList.add("active-view"); ROOT.classList.remove("hidden");
    for (const key of LEGACY_TABS) {
      const v = document.getElementById(`${key}-view`);
      if (v) { v.classList.remove("active-view"); v.classList.add("hidden"); }
      const b = document.getElementById(`tab-${key}`);
      if (b) b.classList.remove("active");
    }
    $("#tab-office")?.classList.add("active");
    resize(); startLoop();
  }
  function deactivateOffice() {
    state.active = false; stopLoop(); // 비용 규율: 안 보이면 렌더 금지
    ROOT.classList.remove("active-view"); ROOT.classList.add("hidden");
    $("#tab-office")?.classList.remove("active");
  }
  function bindTabs() {
    $("#tab-office")?.addEventListener("click", activateOffice);
    for (const key of LEGACY_TABS) {
      document.getElementById(`tab-${key}`)?.addEventListener("click", deactivateOffice);
    }
    document.addEventListener("visibilitychange", () =>
      document.hidden ? stopLoop() : (state.active && startLoop()));
  }

  // ---------- 부팅 ----------
  async function boot() {
    bindTabs();
    $("#roster-filter")?.addEventListener("input", (e) => {
      state.rosterFilter = e.target.value || "";
      renderRoster();
    });
    // 해시가 기존 탭을 가리키면 존중, 아니면 사무실이 기본
    const hash = (location.hash || "").replace("#", "");
    if (!LEGACY_TABS.includes(hash)) activateOffice();
    await syncInventory();
    if (await ensureThree()) {
      buildScene(); bindRaycast(); startLoop();
      document.querySelector("#office-fallback")?.classList.add("hidden");
    } else showFallback();
    connectSSE();
    put($("#hud-clock"), new Date().toLocaleTimeString("ko-KR"));
    setInterval(() => put($("#hud-clock"), new Date().toLocaleTimeString("ko-KR")), 1000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else boot();

  return { selectAgent, activateOffice };
})();
