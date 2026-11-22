/* panels.js — 칸반·인박스·예산 도크. 보안: textContent 전용, innerHTML 금지.
 * 쓰기 API는 X-API-Token 필요 — 첫 기동 시 data/corp/.write_token(0600) 생성.
 * 토큰 입력은 로컬 저장하지 않고 메모리 변수에만 둔다(새로고침 시 재입력).
 */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let TOKEN = "";
  try { TOKEN = localStorage.getItem("corp_token") || ""; } catch { /* 프라이빗 모드 */ }
  if (!TOKEN) {
    // 서버 주입 토큰(같은 출처만 읽 가능) — 복사 마찰 제거, 수동 입력은 대체 수단
    const meta = document.querySelector('meta[name="corp-token"]');
    const injected = (meta?.content || "").trim();
    if (injected && !injected.includes("CORP_TOKEN")) {
      TOKEN = injected;
      try { localStorage.setItem("corp_token", TOKEN); } catch { /* 무시 */ }
    }
  }
  let pendingRetry = null;   // 401로 막힌 요청 1건 — 토큰 저장 시 자동 재시도
  const put = (el, t) => { if (el) el.textContent = t == null ? "" : String(t); };
  function status(msg, isErr) {
    let bar = $("#dock-status");
    if (!bar) return;
    put(bar, msg);
    bar.classList.toggle("err", !!isErr);
    bar.classList.remove("hidden");
    if (!isErr) setTimeout(() => bar.classList.add("hidden"), 4000);
  }
  const api = async (url, opt = {}) => {
    const res = await fetch(url, {
      ...opt,
      headers: { Accept: "application/json", "Content-Type": "application/json",
                 ...(TOKEN ? { "X-API-Token": TOKEN } : {}), ...(opt.headers || {}) },
    });
    if (res.status === 401) {
      // 토큰 바를 열어 안내 — 막힌 요청은 저장 후 자동 재시도한다
      pendingRetry = { url, opt };
      $("#dock")?.classList.remove("hidden");
      openDock("jobs");
      status("쓰기 토큰이 필요합니다. 아래에 입력 후 저장하면 이어서 진행됩니다.", true);
      $("#token-input")?.focus();
      throw new Error("401 need token");
    }
    if (!res.ok) {
      const msg = `요청 실패 ${res.status}: ${url}`;
      status(msg, true);
      throw new Error(msg);
    }
    return res.json();
  };

  const COLS = [["queued", "대기"], ["running", "실행중"], ["review", "검토"], ["done", "완료"], ["failed", "실패"]];

  async function renderJobs() {
    const box = $("#job-columns");
    if (!box) return;
    box.replaceChildren();
    let jobs = [];
    try { jobs = (await api("/api/jobs")).jobs || []; } catch { return; }
    for (const [key, label] of COLS) {
      const col = document.createElement("div");
      col.className = "kb-col";
      const h = document.createElement("h3");
      put(h, `${label} ${jobs.filter((j) => j.status === key).length}`);
      col.appendChild(h);
      for (const j of jobs.filter((x) => x.status === key)) {
        const card = document.createElement("div");
        card.className = "kb-card";
        const t = document.createElement("strong");
        put(t, j.title);
        const m = document.createElement("small");
        put(m, `${j.duty} · ${j.skill || "자동배정"}${j.model ? ` · ${j.model}` : ""}`);
        card.append(t, m);
        if (j.note) {
          const n = document.createElement("small");
          n.className = "kb-note";
          put(n, j.note);
          card.appendChild(n);
        }
        const row = document.createElement("div");
        row.className = "kb-actions";
        if (j.run) {
          const v = document.createElement("button");
          put(v, "결과 보기");
          v.addEventListener("click", () => openResultModal(j));
          row.appendChild(v);
        }
        card.addEventListener("click", (e) => {
          if (e.target.tagName !== "BUTTON") {
            if (j.run) openResultModal(j);
            else status(`[${j.title}] 아직 집행되지 않았습니다. '집행'을 눌러 시작하세요.`);
          }
        });
        if (key === "queued" || key === "failed") {
          const b = document.createElement("button");
          put(b, "집행");
          b.addEventListener("click", async () => {
            await api(`/api/jobs/${j.id}/dispatch?engine=opencode`, { method: "POST" });
            renderJobs();
          });
          row.appendChild(b);
        }
        if (key === "running") {
          const b = document.createElement("button");
          put(b, "정산");
          b.addEventListener("click", async () => {
            const r = await api(`/api/jobs/${j.id}/settle`, { method: "POST" });
            if (r.status === "review") renderInbox();
            renderJobs();
          });
          row.appendChild(b);
        }
        if (key === "review") {
          for (const v of ["approve", "reject"]) {
            const b = document.createElement("button");
            put(b, v === "approve" ? "승인" : "반려");
            b.addEventListener("click", async () => {
              await api(`/api/jobs/${j.id}/approve`, {
                method: "POST", body: JSON.stringify({ verdict: v }),
              });
              renderJobs(); renderInbox();
            });
            row.appendChild(b);
          }
        }
        card.appendChild(row);
        col.appendChild(card);
      }
      box.appendChild(col);
    }
  }

  async function renderInbox() {
    const box = $("#inbox-list");
    if (!box) return;
    box.replaceChildren();
    let jobs = [];
    try { jobs = ((await api("/api/jobs?status=review")).jobs) || []; } catch { return; }
    if (!jobs.length) { const p = document.createElement("p"); put(p, "비어 있음."); box.appendChild(p); }
    for (const j of jobs) {
      const d = document.createElement("div");
      d.className = "kb-card";
      d.style.cursor = "pointer";
      const t = document.createElement("strong");
      put(t, j.title);
      const m = document.createElement("small");
      put(m, `${j.duty} · ${j.skill || "자동배정"} · 클릭하여 결과 확인`);
      d.append(t, m);
      d.addEventListener("click", () => openResultModal(j));
      box.appendChild(d);
    }
    const badge = $("#btn-inbox");
    if (badge) put(badge, `인박스${jobs.length ? ` (${jobs.length})` : ""}`);
  }

  async function renderBudget() {
    const box = $("#budget-view");
    if (!box) return;
    box.replaceChildren();
    try {
      const h = await api("/api/health");
      const p = document.createElement("p");
      put(p, `오늘 사용 ${h.spent_today} / 상한 ${h.budget} (추정 토큰)`);
      const bar = document.createElement("div");
      bar.className = "budget-bar";
      const fill = document.createElement("div");
      fill.className = "budget-fill";
      fill.style.width = `${Math.min(100, (h.spent_today / Math.max(1, h.budget)) * 100)}%`;
      bar.appendChild(fill);
      box.append(p, bar);
    } catch { /* 조용히 */ }
  }

  function openDock(panel) {
    $("#dock")?.classList.remove("hidden");
    document.querySelectorAll(".dock-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.panel === panel));
    for (const p of ["jobs", "inbox", "run", "budget"]) {
      $(`#panel-${p}`)?.classList.toggle("hidden", p !== panel);
    }
    if (panel === "jobs") renderJobs();
    if (panel === "inbox") renderInbox();
    if (panel === "run" && inspRun) renderRun();
    if (panel === "budget") renderBudget();
  }

  // ---------- 실행창: 선택 run의 실시간 출력 ----------
  let inspRun = null, inspTimer = 0;
  async function renderRun() {
    const box = $("#run-view");
    if (!box || !inspRun) return;
    try {
      const run = await api(`/api/runs/${inspRun}`);
      const ev = await api(`/api/runs/${inspRun}/events?limit=200`);
      box.replaceChildren();
      const head = document.createElement("div");
      head.className = "run-head";
      const dur = run.finished && run.created
        ? `${Math.round(run.finished - run.created)}초` : "진행중";
      put(head, `${run.id} · ${run.agent} · ${run.engine}${run.model ? "/" + run.model : ""} · ${run.status} · ${dur} · 토큰~${run.tokens || 0}`);
      head.appendChild(document.createElement("br"));
      const out = document.createElement("pre");
      out.className = "run-output";
      const lines = (ev.events || []).map((e) => `[${e.type}] ${e.message}`);
      put(out, lines.join("\n").slice(-8000) || "(아직 출력 없음)");
      box.append(head, out);
      out.scrollTop = out.scrollHeight;
      const active = !["completed", "failed", "canceled"].includes(run.status);
      clearInterval(inspTimer);
      if (active && !$("#panel-run")?.classList.contains("hidden")) {
        inspTimer = setInterval(renderRun, 2000);
      }
    } catch { /* api가 이미 상태 표시 */ }
  }
  function openRun(runId) {
    inspRun = runId;
    clearInterval(inspTimer);
    openDock("run");
  }

  // ---------- 실행 결과 상세 모달 뷰어 ----------
  let modalRunId = null, modalTimer = 0, currentJobData = null;

  async function openResultModal(item) {
    let job = typeof item === "object" ? item : null;
    let runId = job ? job.run : item;

    if (!runId && job) {
      status(`[${job.title}] 아직 집행되지 않은 작업입니다. 카드 하단의 '집행' 버튼을 눌러주세요.`);
      return;
    }
    if (!runId) return;

    modalRunId = runId;
    currentJobData = job;
    clearInterval(modalTimer);

    const modal = $("#result-modal");
    if (!modal) return;
    modal.classList.remove("hidden");

    // 기본 탭 활성화
    switchModalTab("output");
    await renderResultModal();

    // 실행 중일 경우 1.5초 간격 실시간 폴링
    clearInterval(modalTimer);
    modalTimer = setInterval(async () => {
      if (modal.classList.contains("hidden")) {
        clearInterval(modalTimer);
        return;
      }
      await renderResultModal(true);
    }, 1500);
  }

  function closeResultModal() {
    clearInterval(modalTimer);
    modalRunId = null;
    currentJobData = null;
    $("#result-modal")?.classList.add("hidden");
  }

  function switchModalTab(tabName) {
    document.querySelectorAll(".modal-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    for (const t of ["output", "files", "events"]) {
      $(`#tab-${t}`)?.classList.toggle("hidden", t !== tabName);
    }
  }

  async function renderResultModal(isPolling = false) {
    if (!modalRunId) return;
    try {
      const data = await api(`/api/runs/${modalRunId}/details`);
      const run = data.run || {};
      const job = data.job || currentJobData || {};

      // Title & Badge
      put($("#rm-title"), job.title || `실행 ${run.id}`);
      const badge = $("#rm-status-badge");
      if (badge) {
        const st = run.status || job.status || "queued";
        badge.className = `badge ${st}`;
        const labels = { completed: "완료", review: "검토 대기", running: "실행중", failed: "실패", queued: "대기", done: "완료" };
        put(badge, labels[st] || st);
      }

      // Meta
      const meta = $("#rm-meta");
      if (meta) {
        const dur = run.finished && run.created ? `${Math.round(run.finished - run.created)}초 소요` : "진행중";
        put(meta, `${run.agent || job.skill || "에이전트"} · ${run.engine || "opencode"}${run.model ? "/" + run.model : ""} · ${dur} · 토큰~${run.tokens || 0}`);
      }

      // Output
      const out = $("#rm-output");
      if (out) {
        const cleanOut = (data.output || "").trim();
        put(out, cleanOut || (run.status === "running" ? "에이전트가 작업 중입니다... (실시간 수신 대기)" : "(출력 결과가 없습니다)"));
        if (!isPolling) out.scrollTop = out.scrollHeight;
      }

      // Files
      const fileList = $("#rm-file-list");
      const fileCount = $("#rm-file-count");
      const files = data.files || [];
      if (fileCount) put(fileCount, files.length);
      if (fileList) {
        fileList.replaceChildren();
        if (!files.length) {
          const p = document.createElement("p");
          p.className = "empty-hint";
          put(p, "생성된 산출물 파일이 없습니다.");
          fileList.appendChild(p);
        } else {
          for (const f of files) {
            const card = document.createElement("div");
            card.className = "file-card";
            const title = document.createElement("div");
            title.className = "file-card-title";
            put(title, f.name);
            const size = document.createElement("div");
            size.className = "file-card-meta";
            put(size, `${(f.size / 1024).toFixed(1)} KB`);
            const btn = document.createElement("a");
            btn.className = "file-btn";
            btn.href = f.url;
            btn.download = f.name;
            btn.target = "_blank";
            put(btn, "파일 다운로드 / 열기");
            card.append(title, size, btn);
            fileList.appendChild(card);
          }
        }
      }

      // Events
      const evPre = $("#rm-events");
      if (evPre) {
        const lines = (data.events || []).map((e) => `[${e.type}] ${e.message}`);
        put(evPre, lines.join("\n") || "(로그 없음)");
      }

      // Actions in Modal Footer
      const actBox = $("#rm-actions");
      if (actBox && job && job.id) {
        actBox.replaceChildren();
        const curStatus = job.status || run.status;
        if (curStatus === "review") {
          const appBtn = document.createElement("button");
          appBtn.className = "btn-approve";
          put(appBtn, "✓ 결과 승인 (Done)");
          appBtn.addEventListener("click", async () => {
            await api(`/api/jobs/${job.id}/approve`, { method: "POST", body: JSON.stringify({ verdict: "approve" }) });
            status("업무가 승인되었습니다.");
            closeResultModal();
            renderJobs(); renderInbox();
          });
          const rejBtn = document.createElement("button");
          rejBtn.className = "btn-reject";
          put(rejBtn, "✗ 반려 (재실행 대기)");
          rejBtn.addEventListener("click", async () => {
            await api(`/api/jobs/${job.id}/approve`, { method: "POST", body: JSON.stringify({ verdict: "reject" }) });
            status("업무가 반려되어 대기열로 복귀했습니다.");
            closeResultModal();
            renderJobs(); renderInbox();
          });
          actBox.append(appBtn, rejBtn);
        } else if (curStatus === "running") {
          const setBtn = document.createElement("button");
          setBtn.className = "btn-secondary";
          put(setBtn, "수동 정산 확인");
          setBtn.addEventListener("click", async () => {
            await api(`/api/jobs/${job.id}/settle`, { method: "POST" });
            renderJobs();
            await renderResultModal();
          });
          actBox.appendChild(setBtn);
        }
      }

      // 실행 완료 시 폴링 중단
      if (["completed", "failed", "canceled"].includes(run.status)) {
        clearInterval(modalTimer);
      }
    } catch { /* 조용히 */ }
  }

  async function fillModels() {
    const dl = $("#model-list");
    if (dl && !dl.children.length) {
      try {
        const d = await api("/api/models");
        const seen = new Set();
        for (const m of [...(d.pinned || []), ...(d.models || [])]) {
          if (seen.has(m)) continue;
          seen.add(m);
          const o = document.createElement("option");
          o.value = m;
          dl.appendChild(o);
        }
      } catch { /* 자유 입력으로 대체 */ }
    }
    const sl = $("#skill-list");
    if (sl && !sl.children.length) {
      try {
        const d = await api("/api/inventory");
        for (const a of d.agents || []) {
          const o = document.createElement("option");
          o.value = a.name;
          sl.appendChild(o);
        }
      } catch { /* 자유 입력으로 대체 */ }
    }
  }

  function boot() {
    fillModels();
    const showTokenState = () => {
      const hint = $(".token-hint");
      if (hint) put(hint, TOKEN ? "기억된 토큰 있음 ✓ (비우고 저장이 곧 잊기)"
                                : "한 번 저장하면 브라우저가 기억 (비우고 저장이 곧 잊기)");
    };
    showTokenState();
    const doSave = async () => {
      const v = $("#token-input")?.value.trim() || "";
      if ($("#token-input")) $("#token-input").value = "";
      // 보안 절충(사용자 명시 요청): 브라우저에 저장해 새로고침 후에도 유지.
      // 비우기+저장이 곧 '잊기'이다. XSS 대비 출력은 전부 textContent 전용.
      try {
        if (v) localStorage.setItem("corp_token", v);
        else localStorage.removeItem("corp_token");
      } catch { /* 프라이빗 모드 — 메모리 유지로 추락 */ }
      TOKEN = v;
      if (!TOKEN) { status("토큰을 잊었습니다.", true); return; }
      status("토큰 저장됨 (브라우저에 기억).");
      if (pendingRetry) {
        const retry = pendingRetry;
        pendingRetry = null;
        try {
          await api(retry.url, retry.opt);
          status("이어서 진행됨.");
          renderJobs(); renderInbox();
        } catch { /* api가 이미 상태 표시 */ }
      }
      showTokenState();
    };
    $("#token-save")?.addEventListener("click", doSave);
    $("#token-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSave(); }  // 엔터=저장
    });
    $("#btn-jobs")?.addEventListener("click", () => openDock("jobs"));
    $("#btn-inbox")?.addEventListener("click", () => openDock("inbox"));
    $("#btn-budget")?.addEventListener("click", () => openDock("budget"));
    $("#dock-close")?.addEventListener("click", () => $("#dock")?.classList.add("hidden"));
    document.querySelectorAll(".dock-tab").forEach((b) =>
      b.addEventListener("click", () => openDock(b.dataset.panel)));
    $("#job-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = $("#job-title")?.value.trim();
      if (!title) return;
      await api("/api/jobs", { method: "POST", body: JSON.stringify({
        title, body: $("#job-body")?.value || "", duty: $("#job-duty")?.value || "coder",
        skill: $("#job-skill")?.value.trim() || "",
        model: $("#job-model")?.value.trim() || "",
      }) });
      $("#job-title").value = ""; $("#job-body").value = "";
      status(`접수됨: ${title}`);
      renderJobs();
    });
    // 실행 결과 모달 이벤트 바인딩
    $("#rm-close")?.addEventListener("click", closeResultModal);
    $("#rm-close-bottom")?.addEventListener("click", closeResultModal);
    $("#result-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "result-modal") closeResultModal();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#result-modal")?.classList.contains("hidden")) {
        closeResultModal();
      }
    });
    document.querySelectorAll(".modal-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchModalTab(btn.dataset.tab));
    });
    $("#btn-copy-output")?.addEventListener("click", () => {
      const text = $("#rm-output")?.textContent || "";
      if (!text) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          const btn = $("#btn-copy-output");
          if (btn) {
            const old = btn.textContent;
            btn.textContent = "복사 완료! ✓";
            setTimeout(() => { btn.textContent = old; }, 2000);
          }
        });
      }
    });

    // 인박스 배지는 폴링으로 갱신 (SSE는 office3d가 담당)
    setInterval(renderInbox, 20000);
    renderInbox();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
