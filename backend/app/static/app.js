(function () {
  const DEFAULT_WRITE_API_TOKEN = "custom-codex-agent-local-token";
  const WRITE_API_TOKEN_KEY = "custom-codex-agent-write-token";
  const WORKSPACE_ROOT_KEY = "custom-codex-agent-workspace-root";
  const SANDBOX_MODE_KEY = "custom-codex-agent-sandbox-mode";
  const APPROVAL_POLICY_KEY = "custom-codex-agent-approval-policy";
  const WORKFLOW_STEP_DRAG_TYPE = "application/x-custom-codex-workflow-step";
  const FALLBACK_REFRESH_INTERVAL_MS = 120000;
  const RUN_EVENT_TYPES = new Set(["run:queued", "run:started", "run:stdout", "run:stderr", "run:completed", "run:failed", "run:canceled"]);
  const WORKFLOW_EVENT_TYPES = new Set([
    "workflow:queued",
    "workflow:started",
    "workflow:step:started",
    "workflow:step:completed",
    "workflow:step:failed",
    "workflow:step:canceled",
    "workflow:completed",
    "workflow:failed",
    "workflow:canceled",
  ]);

  const state = {
    tab: "org",
    overview: null,
    org: null,
    dashboard: null,
    executableAgents: [],
    runs: [],
    selectedRunId: null,
    selectedAgentName: "",
    selectedWorkspaceRoot: "",
    selectedSandboxMode: "workspace-write",
    selectedApprovalPolicy: "on-request",
    workflowUiConfig: null,
    workflowRecommendations: [],
    workflowRecommendationStatus: "대기 중",
    workflowDraft: {
      goalPrompt: "",
      steps: [],
    },
    workflowEditorSource: "draft",
    workflowAgentFilter: "",
    selectedWorkflowAgentName: "",
    workflowRuns: [],
    selectedWorkflowRunId: null,
    selectedWorkflowStepIndex: 0,
    selectedWorkflowRunSteps: [],
    workflowEventsByRunId: new Map(),
    selectedWorkflowWorkspaceRoot: "",
    selectedWorkflowSandboxMode: "workspace-write",
    selectedWorkflowApprovalPolicy: "on-request",
    inspector: null,
    selectedInspectorAgentName: "",
    selectedInspectorScriptPath: "",
    selectedInspectorReferencePath: "",
    workspacePicker: {
      open: false,
      currentPath: "",
      parentPath: null,
      directories: [],
    },
    runEventsByRunId: new Map(),
    hasError: false,
    liveText: "초기화 중...",
    collapsedNodeIds: new Set(),
    commandPalette: {
      open: false,
      query: "",
      activeIndex: 0,
    },
  };

  const el = {
    liveState: document.getElementById("live-state"),
    errorBanner: document.getElementById("error-banner"),
    orgView: document.getElementById("org-view"),
    dashboardView: document.getElementById("dashboard-view"),
    consoleView: document.getElementById("console-view"),
    workflowView: document.getElementById("workflow-view"),
    inspectorView: document.getElementById("inspector-view"),
    tabOrg: document.getElementById("tab-org"),
    tabDashboard: document.getElementById("tab-dashboard"),
    tabConsole: document.getElementById("tab-console"),
    tabWorkflow: document.getElementById("tab-workflow"),
    tabInspector: document.getElementById("tab-inspector"),
    scanBtn: document.getElementById("scan-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    backupBtn: document.getElementById("backup-btn"),
    restoreBtn: document.getElementById("restore-btn"),
    toastContainer: document.getElementById("toast-container"),
    orgTree: document.getElementById("org-tree"),
    overviewMetrics: document.getElementById("overview-metrics"),
    departmentMetrics: document.getElementById("department-metrics"),
    statusMetrics: document.getElementById("status-metrics"),
    dashboardMetrics: document.getElementById("dashboard-metrics"),
    timelineList: document.getElementById("timeline-list"),
    activeAgents: document.getElementById("active-agents"),
    recentSkills: document.getElementById("recent-skills"),
    recentThreads: document.getElementById("recent-threads"),
    runAgentSelect: document.getElementById("run-agent-select"),
    runWorkspaceInput: document.getElementById("run-workspace-input"),
    runWorkspacePickerBtn: document.getElementById("run-workspace-picker-btn"),
    runSandboxSelect: document.getElementById("run-sandbox-select"),
    runApprovalSelect: document.getElementById("run-approval-select"),
    workspacePickerModal: document.getElementById("workspace-picker-modal"),
    workspacePickerClose: document.getElementById("workspace-picker-close"),
    workspacePickerCurrent: document.getElementById("workspace-picker-current"),
    workspacePickerUp: document.getElementById("workspace-picker-up"),
    workspacePickerChoose: document.getElementById("workspace-picker-choose"),
    workspacePickerList: document.getElementById("workspace-picker-list"),
    runPromptWrap: document.getElementById("run-prompt-wrap"),
    runPromptInput: document.getElementById("run-prompt-input"),
    runCommandPalette: document.getElementById("run-command-palette"),
    runSubmitBtn: document.getElementById("run-submit-btn"),
    runCancelBtn: document.getElementById("run-cancel-btn"),
    runRetryBtn: document.getElementById("run-retry-btn"),
    runList: document.getElementById("run-list"),
    runLog: document.getElementById("run-log"),
    runMeta: document.getElementById("run-meta"),
    workflowGoalInput: document.getElementById("workflow-goal-input"),
    workflowRecommendBtn: document.getElementById("workflow-recommend-btn"),
    workflowClearBtn: document.getElementById("workflow-clear-btn"),
    workflowRecommendationStatus: document.getElementById("workflow-recommendation-status"),
    workflowStageCount: document.getElementById("workflow-stage-count"),
    workflowSelectedRunLabel: document.getElementById("workflow-selected-run-label"),
    workflowRecommendationList: document.getElementById("workflow-recommendation-list"),
    workflowRecommendationMeta: document.getElementById("workflow-recommendation-meta"),
    workflowAgentFilterInput: document.getElementById("workflow-agent-filter-input"),
    workflowAgentSelect: document.getElementById("workflow-agent-select"),
    workflowAgentAddBtn: document.getElementById("workflow-agent-add-btn"),
    workflowStepList: document.getElementById("workflow-step-list"),
    workflowStepInspector: document.getElementById("workflow-step-inspector"),
    workflowEditorMeta: document.getElementById("workflow-editor-meta"),
    workflowWorkspaceInput: document.getElementById("workflow-workspace-input"),
    workflowWorkspacePickerBtn: document.getElementById("workflow-workspace-picker-btn"),
    workflowSandboxSelect: document.getElementById("workflow-sandbox-select"),
    workflowApprovalSelect: document.getElementById("workflow-approval-select"),
    workflowRunBtn: document.getElementById("workflow-run-btn"),
    workflowCancelBtn: document.getElementById("workflow-cancel-btn"),
    workflowRetryBtn: document.getElementById("workflow-retry-btn"),
    workflowRunList: document.getElementById("workflow-run-list"),
    workflowMeta: document.getElementById("workflow-meta"),
    workflowLog: document.getElementById("workflow-log"),
    inspectorAgentList: document.getElementById("inspector-agent-list"),
    inspectorSummary: document.getElementById("inspector-summary"),
    inspectorAgentName: document.getElementById("inspector-agent-name"),
    inspectorAgentRole: document.getElementById("inspector-agent-role"),
    inspectorSkillName: document.getElementById("inspector-skill-name"),
    inspectorSkillPath: document.getElementById("inspector-skill-path"),
    inspectorSkillContent: document.getElementById("inspector-skill-content"),
    inspectorAgentTomlPath: document.getElementById("inspector-agent-toml-path"),
    inspectorAgentTomlContent: document.getElementById("inspector-agent-toml-content"),
    inspectorScriptsList: document.getElementById("inspector-scripts-list"),
    inspectorScriptContent: document.getElementById("inspector-script-content"),
    inspectorReferencesList: document.getElementById("inspector-references-list"),
    inspectorReferenceContent: document.getElementById("inspector-reference-content"),
  };

  let refreshTimer = null;
  let toastTimer = null;

  function fmtDate(value) {
    if (!value) return "시각 정보 없음";
    try {
      return new Date(value).toLocaleString("ko-KR");
    } catch (_err) {
      return String(value);
    }
  }

  function statusBadge(status) {
    const safe = status || "passive";
    return `<span class="badge ${safe}">${safe}</span>`;
  }

  function createDepartmentThemes(labels) {
    const safeLabels = Array.from(new Set((labels || []).map((item) => String(item || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ko-KR")
    );
    const map = new Map();
    safeLabels.forEach((label, index) => {
      const hue = (index * 137.508) % 360;
      map.set(label, {
        border: `hsl(${hue} 64% 58%)`,
        top: `hsl(${hue} 46% 22%)`,
        bottom: `hsl(${hue} 42% 16%)`,
      });
    });
    return map;
  }

  function getDepartmentThemeMap() {
    const orgLabels =
      state.org && Array.isArray(state.org.nodes)
        ? state.org.nodes
            .filter((node) => node && node.type === "department")
            .map((node) => String(node.label || "").trim())
            .filter(Boolean)
        : [];
    const fallbackLabels = Array.isArray(state.executableAgents)
      ? state.executableAgents.map((agent) => String((agent && agent.department_label_ko) || "").trim()).filter(Boolean)
      : [];
    const labels = orgLabels.length > 0 ? orgLabels : fallbackLabels;
    return createDepartmentThemes(labels);
  }

  function departmentChipMarkup(label, departmentThemes) {
    const safeLabel = String(label || "").trim();
    if (!safeLabel) return "";
    const theme = departmentThemes ? departmentThemes.get(safeLabel) : null;
    if (!theme) {
      return `<span class="inspector-department-chip">${escapeHtml(safeLabel)}</span>`;
    }
    return `<span class="inspector-department-chip dept-themed" style="--dept-border:${theme.border};--dept-bg-top:${theme.top};--dept-bg-bottom:${theme.bottom};">${escapeHtml(
      safeLabel
    )}</span>`;
  }

  function runStatusBadge(status) {
    const safe = status || "queued";
    return `<span class="badge ${escapeHtml(safe)}">${escapeHtml(safe)}</span>`;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let unitIndex = -1;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function showToast(message, variant) {
    if (!el.toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast-item ${variant || "info"}`;
    toast.textContent = String(message || "");
    el.toastContainer.appendChild(toast);
    window.requestAnimationFrame(function () {
      toast.classList.add("visible");
    });

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastTimer = setTimeout(function () {
      toast.classList.remove("visible");
      window.setTimeout(function () {
        toast.remove();
      }, 240);
      toastTimer = null;
    }, 3800);
  }

  function renderMetrics(container, metrics) {
    if (!container) return;
    const list = metrics || [];
    if (list.length === 0) {
      container.innerHTML = `<div class="metric-row"><span>데이터 없음</span><strong>-</strong></div>`;
      return;
    }
    container.innerHTML = list
      .map(
        (m) =>
          `<div class="metric-row"><span>${escapeHtml(m.label)}</span><strong>${Number(m.value || 0)}</strong></div>`
      )
      .join("");
  }

  function renderActivityList(container, items) {
    if (!container) return;
    const list = items || [];
    if (list.length === 0) {
      container.innerHTML = `<li class="activity-item"><div class="activity-sub">데이터 없음</div></li>`;
      return;
    }
    container.innerHTML = list
      .map(
        (item) => `
      <li class="activity-item">
        <div class="activity-title">${escapeHtml(item.title || "-")}</div>
        <div class="activity-sub">${escapeHtml(item.subtitle || "")}</div>
        <div class="activity-time">${fmtDate(item.timestamp)}</div>
      </li>
    `
      )
      .join("");
  }

  function renderRunAgentOptions() {
    if (!el.runAgentSelect) return;
    const list = Array.isArray(state.executableAgents) ? state.executableAgents : [];
    if (list.length === 0) {
      el.runAgentSelect.innerHTML = `<option value="">실행 가능한 에이전트 없음</option>`;
      return;
    }

    if (!state.selectedAgentName || !list.some((item) => item.name === state.selectedAgentName && item.runnable)) {
      const firstRunnable = list.find((item) => item.runnable);
      state.selectedAgentName = firstRunnable ? firstRunnable.name : list[0].name;
    }

    el.runAgentSelect.innerHTML = list
      .map((item) => {
        const disabled = item.runnable ? "" : "disabled";
        const selected = item.name === state.selectedAgentName ? "selected" : "";
        const short = item.short_description ? ` - ${item.short_description}` : "";
        const label = `${item.department_label_ko} / ${item.role_label_ko} (${item.name})${short}`;
        return `<option value="${escapeHtml(item.name)}" ${disabled} ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function renderRunList() {
    if (!el.runList) return;
    const runs = Array.isArray(state.runs) ? state.runs : [];
    if (runs.length === 0) {
      el.runList.innerHTML = `<li class="activity-item"><div class="activity-sub">실행 이력이 없습니다.</div></li>`;
      return;
    }

    if (!state.selectedRunId || !runs.some((run) => run.run_id === state.selectedRunId)) {
      state.selectedRunId = runs[0].run_id;
    }

    el.runList.innerHTML = runs
      .map((run) => {
        const selectedClass = run.run_id === state.selectedRunId ? "selected-run-item" : "";
        return `
          <li class="activity-item ${selectedClass}" data-run-id="${escapeHtml(run.run_id)}">
            <div class="activity-title">${escapeHtml(run.agent_name)}</div>
            <div class="activity-sub">${escapeHtml(run.workspace_root || "")}</div>
            <div class="activity-sub">${escapeHtml(run.prompt_preview || "")}</div>
            <div class="activity-sub">${runStatusBadge(run.status)}</div>
            <div class="activity-time">${fmtDate(run.created_at)}</div>
          </li>
        `;
      })
      .join("");
  }

  function renderRunLog() {
    if (!el.runLog || !el.runMeta) return;
    if (!state.selectedRunId) {
      el.runMeta.textContent = "선택된 실행 없음";
      el.runLog.textContent = "";
      return;
    }

    const selectedRun = (state.runs || []).find((run) => run.run_id === state.selectedRunId);
    const events = state.runEventsByRunId.get(state.selectedRunId) || [];
    const runStatus = selectedRun ? selectedRun.status : "unknown";
    const runError = selectedRun && selectedRun.error_message ? ` / 오류: ${selectedRun.error_message}` : "";
    const workspaceInfo = selectedRun && selectedRun.workspace_root ? ` / 폴더=${selectedRun.workspace_root}` : "";
    el.runMeta.textContent = `run_id=${state.selectedRunId} / 상태=${runStatus}${workspaceInfo}${runError}`;
    el.runLog.textContent = events
      .map((event) => `[${fmtDate(event.created_at)}] ${event.event_type} ${event.message}`)
      .join("\n");
    el.runLog.scrollTop = el.runLog.scrollHeight;
  }

  function renderConsole() {
    if (el.runWorkspaceInput && el.runWorkspaceInput.value !== state.selectedWorkspaceRoot) {
      el.runWorkspaceInput.value = state.selectedWorkspaceRoot || "";
    }
    if (el.runSandboxSelect && el.runSandboxSelect.value !== state.selectedSandboxMode) {
      el.runSandboxSelect.value = state.selectedSandboxMode || "workspace-write";
    }
    if (el.runApprovalSelect && el.runApprovalSelect.value !== state.selectedApprovalPolicy) {
      el.runApprovalSelect.value = state.selectedApprovalPolicy || "on-request";
    }
    renderRunAgentOptions();
    renderCommandPalette();
    renderRunList();
    renderRunLog();
  }

  function renderWorkflowOptionSelect(selectEl, options, selectedValue) {
    if (!selectEl) return;
    const list = Array.isArray(options) ? options : [];
    selectEl.innerHTML = list
      .map((item) => {
        const value = String((item && item.value) || "");
        const label = String((item && item.label) || value);
        const selected = value === selectedValue ? "selected" : "";
        return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function normalizeWorkflowDraftStepsForEditing() {
    state.workflowDraft.steps = ((state.workflowDraft && state.workflowDraft.steps) || []).map((step) =>
      Object.assign({}, step, {
        status: "ready",
        runId: "",
      })
    );
  }

  function setWorkflowRecommendationStatus(nextStatus) {
    state.workflowRecommendationStatus = String(nextStatus || "").trim() || "대기 중";
  }

  function normalizeWorkflowStepSelection() {
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    if (steps.length === 0) {
      state.selectedWorkflowStepIndex = -1;
      return;
    }
    if (!Number.isInteger(state.selectedWorkflowStepIndex) || state.selectedWorkflowStepIndex < 0) {
      state.selectedWorkflowStepIndex = 0;
      return;
    }
    if (state.selectedWorkflowStepIndex >= steps.length) {
      state.selectedWorkflowStepIndex = steps.length - 1;
    }
  }

  function selectWorkflowStep(index) {
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) return;
    state.selectedWorkflowStepIndex = index;
    renderWorkflowSteps();
    renderWorkflowStepInspector();
  }

  function getWorkflowStepStatusLabel(status) {
    const statuses = (state.workflowUiConfig && state.workflowUiConfig.workflow_step_statuses) || [];
    const matched = statuses.find((item) => item.value === status);
    return matched ? matched.label : status || "unknown";
  }

  function getWorkflowIconSvg(iconKey) {
    const key = String(iconKey || "bot");
    const icons = {
      shield: `<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z"></path>`,
      "check-circle": `<path d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z"></path><path d="M9 12l2 2 4-4"></path>`,
      "file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path><path d="M8 9h2"></path>`,
      database: `<ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"></path><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>`,
      layout: `<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path><path d="M9 9h12"></path>`,
      server: `<rect x="4" y="4" width="16" height="6" rx="2"></rect><rect x="4" y="14" width="16" height="6" rx="2"></rect><path d="M8 7h.01"></path><path d="M8 17h.01"></path>`,
      "play-square": `<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M10 8l6 4-6 4V8z"></path>`,
      folder: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path>`,
      table: `<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 4v16"></path><path d="M15 4v16"></path>`,
      presentation: `<path d="M4 4h16v10H4z"></path><path d="M12 14v6"></path><path d="M8 20h8"></path>`,
      bot: `<rect x="7" y="8" width="10" height="8" rx="2"></rect><path d="M9 8V6a3 3 0 0 1 6 0v2"></path><path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M12 16v2"></path>`,
    };
    const body = icons[key] || icons.bot;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="workflow-agent-icon-svg">${body}</svg>`;
  }

  function workflowStatusBadge(status) {
    const safe = String(status || "queued");
    return `<span class="badge workflow-status ${escapeHtml(safe)}">${escapeHtml(getWorkflowStepStatusLabel(safe))}</span>`;
  }

  function getWorkflowRecommendationCardStatus(agentName) {
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    if (steps.some((step) => step.agentName === agentName)) {
      return {
        label: "선정됨",
        className: "selected",
      };
    }
    if (state.workflowRecommendationStatus === "추천 중") {
      return {
        label: "분석 중",
        className: "pending",
      };
    }
    return {
      label: "후보",
      className: "idle",
    };
  }

  function renderWorkflowRecommendations() {
    if (!el.workflowRecommendationList || !el.workflowRecommendationMeta) return;
    const list = Array.isArray(state.workflowRecommendations) ? state.workflowRecommendations : [];
    el.workflowRecommendationMeta.textContent = list.length > 0 ? `${list.length}개 추천됨` : "추천 결과 없음";
    if (state.workflowRecommendationStatus === "추천 중" && list.length === 0) {
      el.workflowRecommendationList.innerHTML = Array.from({ length: 3 })
        .map(
          () => `
            <article class="workflow-recommend-card workflow-recommend-card-loading" aria-hidden="true">
              <div class="workflow-agent-avatar workflow-agent-avatar-loading"></div>
              <div class="workflow-card-body">
                <div class="workflow-skeleton workflow-skeleton-title"></div>
                <div class="workflow-skeleton workflow-skeleton-sub"></div>
                <div class="workflow-skeleton workflow-skeleton-body"></div>
              </div>
              <div class="workflow-skeleton workflow-skeleton-button"></div>
            </article>
          `
        )
        .join("");
      return;
    }
    if (list.length === 0) {
      el.workflowRecommendationList.innerHTML = `<div class="workflow-empty">작업 목표를 입력하고 추천을 실행하세요.</div>`;
      return;
    }
    el.workflowRecommendationList.innerHTML = list
      .map(
        (item, index) => {
          const cardStatus = getWorkflowRecommendationCardStatus(item.agent_name);
          return `
          <article class="workflow-recommend-card workflow-palette-card">
            <div class="workflow-agent-avatar workflow-palette-avatar">
              <div class="workflow-agent-avatar-glow"></div>
              <div class="workflow-agent-icon workflow-agent-icon-lg">${getWorkflowIconSvg(item.icon_key)}</div>
              <span class="workflow-card-state workflow-card-state-${cardStatus.className}">${escapeHtml(cardStatus.label)}</span>
            </div>
            <div class="workflow-card-body">
              <div class="workflow-card-kicker">Agent Palette</div>
              <div class="workflow-card-title-row">
                <strong>${escapeHtml(item.agent_name)}</strong>
                <span class="workflow-node-chip workflow-node-chip-skill">${escapeHtml(item.skill_name || "스킬 없음")}</span>
              </div>
              <div class="workflow-node-chip-row">
                <span class="workflow-node-chip">${escapeHtml(item.department_label_ko || "-")}</span>
                <span class="workflow-node-chip">${escapeHtml(item.role_label_ko || "-")}</span>
              </div>
              <div class="workflow-card-desc">${escapeHtml(item.short_description || item.reason || "")}</div>
              <div class="workflow-card-reason">${escapeHtml(item.reason || "")}</div>
            </div>
            <button class="btn workflow-node-add-btn" type="button" data-workflow-add-index="${index}">+ Stage</button>
          </article>
        `;
        }
      )
      .join("");
  }

  function filterWorkflowAgents(query) {
    const normalized = String(query || "")
      .trim()
      .toLowerCase();
    const candidates = (state.executableAgents || []).filter((item) => item && item.runnable);
    if (!normalized) return candidates;
    return candidates.filter((item) => {
      const haystacks = [item.name, item.role_label_ko, item.department_label_ko, item.short_description];
      return haystacks.some((value) => String(value || "").toLowerCase().includes(normalized));
    });
  }

  function buildDefaultWorkflowPrompt(agentMeta) {
    const role = String((agentMeta && agentMeta.role_label_ko) || "담당 에이전트").trim();
    const goal = String((state.workflowDraft && state.workflowDraft.goalPrompt) || "").trim();
    if (!goal) {
      return `${role} 관점에서 현재 단계에서 필요한 작업을 수행하고 다음 단계에 전달할 핵심 결과를 정리해줘.`;
    }
    return `전체 목표는 '${goal}' 입니다. ${role} 관점에서 현재 단계에서 필요한 작업만 수행하고, 다음 단계에 전달할 핵심 결과를 정리해줘.`;
  }

  function resolveWorkflowIconKeyForAgent(agentMeta) {
    const haystack = [
      agentMeta && agentMeta.name,
      agentMeta && agentMeta.role_label_ko,
      agentMeta && agentMeta.department_label_ko,
      agentMeta && agentMeta.short_description,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    const iconRules = (state.workflowUiConfig && state.workflowUiConfig.agent_icons) || [];
    for (const rule of iconRules) {
      const keywords = Array.isArray(rule && rule.keywords) ? rule.keywords : [];
      if (keywords.some((keyword) => String(keyword || "").toLowerCase() && haystack.includes(String(keyword || "").toLowerCase()))) {
        return String(rule.key || "bot");
      }
    }
    return "bot";
  }

  function renderWorkflowManualAgentOptions() {
    if (!el.workflowAgentSelect) return;
    const candidates = filterWorkflowAgents(state.workflowAgentFilter);
    if (!state.selectedWorkflowAgentName || !candidates.some((item) => item.name === state.selectedWorkflowAgentName)) {
      state.selectedWorkflowAgentName = candidates.length > 0 ? candidates[0].name : "";
    }
    if (candidates.length === 0) {
      el.workflowAgentSelect.innerHTML = `<option value="">일치하는 에이전트 없음</option>`;
      return;
    }
    el.workflowAgentSelect.innerHTML = candidates
      .map((item) => {
        const selected = item.name === state.selectedWorkflowAgentName ? "selected" : "";
        const label = `${item.department_label_ko} / ${item.role_label_ko} (${item.name})`;
        return `<option value="${escapeHtml(item.name)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function hasApprovalPending(runEvents) {
    const events = Array.isArray(runEvents) ? runEvents : [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] || {};
      const eventType = String(event.event_type || "");
      const message = String(event.message || "").toLowerCase();
      if (eventType === "run:completed" || eventType === "run:failed" || eventType === "run:canceled") {
        return false;
      }
      if (
        message.includes("approval") ||
        message.includes("approve") ||
        message.includes("승인") ||
        message.includes("allow") ||
        message.includes("permission")
      ) {
        return true;
      }
    }
    return false;
  }

  function getWorkflowDisplayStatus(step) {
    const baseStatus = String((step && step.status) || "ready");
    if (baseStatus !== "running" || !step || !step.runId) {
      return baseStatus;
    }
    const runEvents = state.runEventsByRunId.get(step.runId) || [];
    return hasApprovalPending(runEvents) ? "approval_required" : baseStatus;
  }

  function getWorkflowProgressText(step) {
    if (!step) return "";
    if (step.runId) {
      const runEvents = state.runEventsByRunId.get(step.runId) || [];
      for (let index = runEvents.length - 1; index >= 0; index -= 1) {
        const event = runEvents[index] || {};
        const eventType = String(event.event_type || "");
        if (eventType === "run:stdout" || eventType === "run:stderr" || eventType === "run:failed" || eventType === "run:completed") {
          return String(event.message || "").trim();
        }
      }
    }
    return String(step.progressText || "").trim();
  }

  function renderWorkflowSteps() {
    if (!el.workflowStepList || !el.workflowEditorMeta) return;
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    el.workflowEditorMeta.textContent = steps.length > 0 ? `${steps.length}개 단계 / 드래그로 순서 변경` : "단계를 추가하세요";
    normalizeWorkflowStepSelection();
    if (steps.length === 0) {
      el.workflowStepList.innerHTML = `<div class="workflow-empty">추천 결과에서 에이전트를 추가하거나 수동으로 구성하세요.</div>`;
      return;
    }
    el.workflowStepList.innerHTML = `
      <div class="workflow-flow-canvas">
        <div class="workflow-flow-board">
          ${steps
            .map((step, index) => {
              const displayStatus = getWorkflowDisplayStatus(step);
              const progressText = getWorkflowProgressText(step);
              const isSelected = state.selectedWorkflowStepIndex === index;
              const progressLabel = progressText || "대기 중";
              return `
                <article
                  class="workflow-step-card workflow-node-card workflow-stage-compact ${step.status === "running" ? "is-running" : ""} ${
                isSelected ? "selected" : ""
              }"
                  draggable="true"
                  data-workflow-step-index="${index}"
                  data-workflow-select-index="${index}"
                >
                  <div class="workflow-node-rail">
                    <span class="workflow-node-rail-dot"></span>
                    ${index < steps.length - 1 ? `<span class="workflow-node-rail-line"></span>` : ""}
                  </div>
                  <div class="workflow-step-handle workflow-node-drag" title="순서 변경">::</div>
                  <div class="workflow-agent-avatar workflow-step-avatar">
                    <div class="workflow-agent-avatar-glow"></div>
                    <div class="workflow-agent-icon workflow-agent-icon-lg">${getWorkflowIconSvg(step.iconKey)}</div>
                    <span class="workflow-card-state workflow-card-state-${escapeHtml(displayStatus)}">${escapeHtml(
                      getWorkflowStepStatusLabel(displayStatus)
                    )}</span>
                  </div>
                  <div class="workflow-step-main workflow-node-main workflow-stage-summary">
                    <div class="workflow-node-header">
                      <div>
                        <div class="workflow-card-kicker">Stage ${index + 1}</div>
                        <div class="workflow-card-title-row">
                          <strong>${escapeHtml(step.agentName)}</strong>
                          <span class="workflow-node-chip workflow-node-chip-skill">${escapeHtml(step.skillName || "스킬 없음")}</span>
                        </div>
                      </div>
                      <span class="workflow-step-index">Step ${index + 1}</span>
                    </div>
                    <div class="workflow-node-progress workflow-node-progress-compact">
                      <span class="workflow-node-progress-label">Current Execution</span>
                      <div class="workflow-node-progress-text">${escapeHtml(progressLabel)}</div>
                    </div>
                  </div>
                  <div class="workflow-step-actions workflow-node-actions workflow-stage-actions">
                    <button class="btn" type="button" data-workflow-select-index="${index}">${isSelected ? "선택됨" : "열기"}</button>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderWorkflowStepInspector() {
    if (!el.workflowStepInspector) return;
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    normalizeWorkflowStepSelection();
    if (steps.length === 0 || state.selectedWorkflowStepIndex < 0 || state.selectedWorkflowStepIndex >= steps.length) {
      el.workflowStepInspector.innerHTML = `
        <div class="workflow-inspector-empty">
          <h4>Step Inspector</h4>
          <p>단계를 선택하면 상세 지시와 고급 제어를 이 레이어에서 편집할 수 있습니다.</p>
        </div>
      `;
      return;
    }

    const step = steps[state.selectedWorkflowStepIndex];
    const displayStatus = getWorkflowDisplayStatus(step);
    const progressText = getWorkflowProgressText(step) || "대기 중";
    const showRetryFromStep = !!state.selectedWorkflowRunId && (step.status === "failed" || step.status === "canceled");
    const showSkipStep =
      !!state.selectedWorkflowRunId &&
      (step.status === "failed" || step.status === "canceled") &&
      state.selectedWorkflowStepIndex < steps.length - 1;

    el.workflowStepInspector.innerHTML = `
      <article class="workflow-inspector-card">
        <div class="workflow-inspector-head">
          <div>
            <p class="workflow-card-kicker">Step Inspector</p>
            <h4>Stage ${state.selectedWorkflowStepIndex + 1} · ${escapeHtml(step.agentName)}</h4>
          </div>
          <span class="workflow-card-state workflow-card-state-${escapeHtml(displayStatus)}">${escapeHtml(
      getWorkflowStepStatusLabel(displayStatus)
    )}</span>
        </div>
        <div class="workflow-node-chip-row">
          <span class="workflow-node-chip workflow-node-chip-skill">${escapeHtml(step.skillName || "스킬 없음")}</span>
          <span class="workflow-node-chip">${escapeHtml(step.departmentLabel || "-")}</span>
          <span class="workflow-node-chip">${escapeHtml(step.roleLabel || "-")}</span>
        </div>
        <div class="workflow-node-progress">
          <span class="workflow-node-progress-label">Current Execution</span>
          <div class="workflow-node-progress-text">${escapeHtml(progressText)}</div>
        </div>
        <label class="field-label" for="workflow-step-prompt-${state.selectedWorkflowStepIndex}">Instruction</label>
        <textarea
          id="workflow-step-prompt-${state.selectedWorkflowStepIndex}"
          class="input workflow-step-prompt workflow-inspector-prompt"
          data-workflow-prompt-index="${state.selectedWorkflowStepIndex}"
        >${escapeHtml(step.prompt || "")}</textarea>
        <details class="workflow-inspector-details">
          <summary>고급 메타데이터</summary>
          <div class="workflow-inspector-detail-grid">
            <div><span>run_id</span><strong>${escapeHtml(step.runId || "-")}</strong></div>
            <div><span>status</span><strong>${escapeHtml(step.status || "-")}</strong></div>
          </div>
        </details>
        <div class="workflow-step-actions workflow-inspector-actions">
          <button class="btn" type="button" data-workflow-duplicate-index="${state.selectedWorkflowStepIndex}">Duplicate</button>
          <button class="btn" type="button" data-workflow-remove-index="${state.selectedWorkflowStepIndex}">Remove</button>
          ${showRetryFromStep ? `<button class="btn" type="button" data-workflow-retry-from-step-index="${state.selectedWorkflowStepIndex}">Retry From Here</button>` : ""}
          ${showSkipStep ? `<button class="btn" type="button" data-workflow-skip-step-index="${state.selectedWorkflowStepIndex}">Skip Step</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderWorkflowRunList() {
    if (!el.workflowRunList) return;
    const runs = Array.isArray(state.workflowRuns) ? state.workflowRuns : [];
    if (runs.length === 0) {
      el.workflowRunList.innerHTML = `<li class="activity-item"><div class="activity-sub">워크플로 실행 이력이 없습니다.</div></li>`;
      return;
    }
    if (!state.selectedWorkflowRunId || !runs.some((run) => run.workflow_run_id === state.selectedWorkflowRunId)) {
      state.selectedWorkflowRunId = runs[0].workflow_run_id;
    }
    el.workflowRunList.innerHTML = runs
      .map((run) => {
        const selectedClass = run.workflow_run_id === state.selectedWorkflowRunId ? "selected-run-item" : "";
        const currentStepText =
          run.current_step_index === null || run.current_step_index === undefined
            ? `총 ${run.total_steps}단계`
            : `${run.current_step_index + 1} / ${run.total_steps} 단계`;
        return `
          <li class="activity-item ${selectedClass}" data-workflow-run-id="${escapeHtml(run.workflow_run_id)}">
            <div class="activity-title">${escapeHtml(run.goal_prompt_preview || "-")}</div>
            <div class="activity-sub">${escapeHtml(run.workspace_root || "")}</div>
            <div class="activity-sub">${runStatusBadge(run.status)}</div>
            <div class="activity-sub">${escapeHtml(currentStepText)}</div>
            <div class="activity-time">${fmtDate(run.created_at)}</div>
          </li>
        `;
      })
      .join("");
  }

  function renderWorkflowLog() {
    if (!el.workflowMeta || !el.workflowLog) return;
    if (!state.selectedWorkflowRunId) {
      el.workflowMeta.textContent = "선택된 워크플로 없음";
      el.workflowLog.textContent = "";
      return;
    }
    const selectedRun = (state.workflowRuns || []).find((item) => item.workflow_run_id === state.selectedWorkflowRunId);
    const runMeta = selectedRun
      ? `workflow_run_id=${selectedRun.workflow_run_id} / 상태=${selectedRun.status} / 단계=${selectedRun.current_step_index === null || selectedRun.current_step_index === undefined ? "-" : selectedRun.current_step_index + 1}/${selectedRun.total_steps}`
      : `workflow_run_id=${state.selectedWorkflowRunId}`;
    el.workflowMeta.textContent = runMeta;
    el.workflowLog.textContent = collectWorkflowCombinedLogLines().join("\n");
    el.workflowLog.scrollTop = el.workflowLog.scrollHeight;
  }

  function renderWorkflow() {
    if (el.workflowGoalInput && el.workflowGoalInput.value !== (state.workflowDraft.goalPrompt || "")) {
      el.workflowGoalInput.value = state.workflowDraft.goalPrompt || "";
    }
    if (el.workflowWorkspaceInput && el.workflowWorkspaceInput.value !== state.selectedWorkflowWorkspaceRoot) {
      el.workflowWorkspaceInput.value = state.selectedWorkflowWorkspaceRoot || "";
    }
    const workflowConfig = state.workflowUiConfig || {};
    renderWorkflowOptionSelect(el.workflowSandboxSelect, workflowConfig.sandbox_modes || [], state.selectedWorkflowSandboxMode);
    renderWorkflowOptionSelect(el.workflowApprovalSelect, workflowConfig.approval_policies || [], state.selectedWorkflowApprovalPolicy);
    if (el.workflowRecommendationStatus) {
      el.workflowRecommendationStatus.textContent = state.workflowRecommendationStatus || "대기 중";
    }
    if (el.workflowStageCount) {
      el.workflowStageCount.textContent = String(((state.workflowDraft && state.workflowDraft.steps) || []).length);
    }
    if (el.workflowSelectedRunLabel) {
      const selectedRun = (state.workflowRuns || []).find((item) => item.workflow_run_id === state.selectedWorkflowRunId);
      el.workflowSelectedRunLabel.textContent = selectedRun
        ? `${selectedRun.status} · ${selectedRun.workflow_run_id.slice(0, 8)}`
        : state.selectedWorkflowRunId
        ? state.selectedWorkflowRunId.slice(0, 8)
        : "없음";
    }
    if (el.workflowAgentFilterInput && el.workflowAgentFilterInput.value !== state.workflowAgentFilter) {
      el.workflowAgentFilterInput.value = state.workflowAgentFilter || "";
    }
    renderWorkflowManualAgentOptions();
    renderWorkflowRecommendations();
    renderWorkflowSteps();
    renderWorkflowStepInspector();
    renderWorkflowRunList();
    renderWorkflowLog();
  }

  function filterCommandPaletteAgents(query) {
    const normalized = String(query || "")
      .trim()
      .toLowerCase();
    const agents = (state.executableAgents || []).filter((item) => item && item.runnable);
    if (!normalized) return agents;
    return agents.filter((item) => {
      const haystacks = [
        item.name,
        item.role_label_ko,
        item.department_label_ko,
        item.short_description,
      ];
      return haystacks.some((value) => String(value || "").toLowerCase().includes(normalized));
    });
  }

  function closeCommandPalette() {
    state.commandPalette.open = false;
    state.commandPalette.query = "";
    state.commandPalette.activeIndex = 0;
    renderCommandPalette();
  }

  function openCommandPalette(query) {
    const candidates = filterCommandPaletteAgents(query);
    state.commandPalette.open = true;
    state.commandPalette.query = String(query || "");
    state.commandPalette.activeIndex = candidates.length > 0 ? Math.min(state.commandPalette.activeIndex, candidates.length - 1) : 0;
    renderCommandPalette();
  }

  function moveCommandPalette(step) {
    const candidates = filterCommandPaletteAgents(state.commandPalette.query);
    if (!state.commandPalette.open || candidates.length === 0) return;
    const size = candidates.length;
    const current = state.commandPalette.activeIndex || 0;
    state.commandPalette.activeIndex = (current + step + size) % size;
    renderCommandPalette();
  }

  function selectCommandPaletteAgentByIndex(index) {
    const candidates = filterCommandPaletteAgents(state.commandPalette.query);
    if (candidates.length === 0) return;
    const safeIndex = Math.max(0, Math.min(index, candidates.length - 1));
    const target = candidates[safeIndex];
    if (!target) return;

    state.selectedAgentName = target.name;
    if (el.runAgentSelect) {
      el.runAgentSelect.value = target.name;
    }
    if (el.runPromptInput) {
      const prev = String(el.runPromptInput.value || "");
      const cleaned = prev.replace(/(?:^|\s)\/([^\n\r]*)$/, "").replace(/\s+$/, "");
      el.runPromptInput.value = cleaned;
      el.runPromptInput.focus();
    }
    state.liveText = `실행 대상 선택: ${target.department_label_ko} / ${target.role_label_ko}`;
    closeCommandPalette();
    render();
  }

  function updateCommandPaletteByPromptValue() {
    if (!el.runPromptInput) return;
    const value = String(el.runPromptInput.value || "");
    const match = value.match(/(?:^|\s)\/([^\n\r]*)$/);
    if (!match) {
      closeCommandPalette();
      return;
    }
    const query = match[1] || "";
    openCommandPalette(query);
  }

  function extractSlashCommandQuery(value) {
    const match = String(value || "").match(/(?:^|\s)\/([^\n\r]*)$/);
    return match ? match[1] || "" : null;
  }

  function renderCommandPalette() {
    if (!el.runCommandPalette) return;
    if (!state.commandPalette.open) {
      el.runCommandPalette.classList.add("hidden");
      el.runCommandPalette.innerHTML = "";
      return;
    }
    const candidates = filterCommandPaletteAgents(state.commandPalette.query);
    el.runCommandPalette.classList.remove("hidden");
    if (candidates.length === 0) {
      el.runCommandPalette.innerHTML = `<div class="command-palette-empty">일치하는 에이전트가 없습니다.</div>`;
      return;
    }
    el.runCommandPalette.innerHTML = `<ul class="command-palette-list">${candidates
      .map((item, idx) => {
        const isActive = idx === state.commandPalette.activeIndex;
        const label = `${item.department_label_ko} / ${item.role_label_ko}`;
        const sub = `${item.name}${item.short_description ? ` - ${item.short_description}` : ""}`;
        return `<li class="command-palette-item"><button type="button" class="command-palette-btn ${
          isActive ? "active" : ""
        }" data-command-agent-index="${idx}"><div class="command-palette-main">${escapeHtml(
          label
        )}</div><div class="command-palette-sub">${escapeHtml(sub)}</div></button></li>`;
      })
      .join("")}</ul>`;
  }

  async function loadInspector(agentName) {
    const normalized = String(agentName || "").trim();
    if (!normalized) return;
    let data = null;
    try {
      data = await fetchJson(`/api/agents/${encodeURIComponent(normalized)}/inspector`);
    } catch (err) {
      const msg = String((err && err.message) || err || "");
      // 구버전 백엔드(inspector API 미배포)에서는 404가 날 수 있다. 이 경우 메타데이터로 폴백한다.
      if (!msg.includes("404")) {
        throw err;
      }
      const inventory = await fetchJson("/api/inventory");
      const invAgent = (inventory && inventory.agents ? inventory.agents : []).find((item) => item.name === normalized);
      if (!invAgent) {
        throw err;
      }
      data = {
        agent_name: invAgent.name,
        role_label_ko: invAgent.role_label_ko,
        department_label_ko: invAgent.department_label_ko,
        description: invAgent.description || "",
        short_description: invAgent.short_description || "",
        one_click_prompt: invAgent.one_click_prompt || "",
        skill_name: invAgent.skill_name || "",
        skill_path: invAgent.skill_path || "",
        agent_toml_path: "",
        agent_json_path: "",
        skill_markdown: null,
        agent_toml: null,
        agent_json: null,
        references: [],
        scripts: [],
      };
    }
    state.selectedInspectorAgentName = normalized;
    state.inspector = data;
    const scripts = Array.isArray(data.scripts) ? data.scripts : [];
    const references = Array.isArray(data.references) ? data.references : [];
    if (!state.selectedInspectorScriptPath || !scripts.some((item) => item.path === state.selectedInspectorScriptPath)) {
      state.selectedInspectorScriptPath = scripts.length > 0 ? scripts[0].path : "";
    }
    if (!state.selectedInspectorReferencePath || !references.some((item) => item.path === state.selectedInspectorReferencePath)) {
      state.selectedInspectorReferencePath = references.length > 0 ? references[0].path : "";
    }
  }

  function renderInspector() {
    if (!el.inspectorAgentList) return;
    const agents = Array.isArray(state.executableAgents) ? state.executableAgents : [];
    const departmentThemes = getDepartmentThemeMap();
    if (agents.length === 0) {
      el.inspectorAgentList.innerHTML = `<li class="activity-item"><div class="activity-sub">에이전트 데이터 없음</div></li>`;
    } else {
      el.inspectorAgentList.innerHTML = agents
        .map((agent) => {
          const isActive = state.selectedInspectorAgentName === agent.name;
          const desc = agent.short_description ? `<div class="activity-sub">${escapeHtml(agent.short_description)}</div>` : "";
          const departmentChip = departmentChipMarkup(agent.department_label_ko, departmentThemes) || `<span class="inspector-department-chip">-</span>`;
          return `
            <li class="activity-item">
              <button class="inspector-item-btn ${isActive ? "active" : ""}" type="button" data-inspector-agent="${escapeHtml(agent.name)}">
                <div class="activity-title">${departmentChip}<span class="inspector-role-text">${escapeHtml(agent.role_label_ko || "-")}</span></div>
                <div class="activity-sub">${escapeHtml(agent.name)}</div>
                ${desc}
              </button>
            </li>
          `;
        })
        .join("");
    }

    const data = state.inspector;
    if (!data) {
      if (el.inspectorSummary) el.inspectorSummary.textContent = "좌측에서 에이전트를 선택하세요.";
      if (el.inspectorAgentName) el.inspectorAgentName.textContent = "-";
      if (el.inspectorAgentRole) el.inspectorAgentRole.textContent = "-";
      if (el.inspectorSkillName) el.inspectorSkillName.textContent = "-";
      if (el.inspectorSkillPath) el.inspectorSkillPath.textContent = "";
      if (el.inspectorSkillContent) el.inspectorSkillContent.textContent = "";
      if (el.inspectorAgentTomlPath) el.inspectorAgentTomlPath.textContent = "";
      if (el.inspectorAgentTomlContent) el.inspectorAgentTomlContent.textContent = "";
      if (el.inspectorScriptsList) el.inspectorScriptsList.innerHTML = "";
      if (el.inspectorScriptContent) el.inspectorScriptContent.textContent = "";
      if (el.inspectorReferencesList) el.inspectorReferencesList.innerHTML = "";
      if (el.inspectorReferenceContent) el.inspectorReferenceContent.textContent = "";
      return;
    }

    if (el.inspectorSummary) {
      const short = data.short_description ? ` / ${data.short_description}` : "";
      el.inspectorSummary.textContent = `실시간 보기: ${data.agent_name}${short}`;
    }
    if (el.inspectorAgentName) el.inspectorAgentName.textContent = data.agent_name || "-";
    if (el.inspectorAgentRole) {
      const departmentChip = departmentChipMarkup(data.department_label_ko, departmentThemes) || `<span class="inspector-department-chip">-</span>`;
      el.inspectorAgentRole.innerHTML = `${departmentChip}<span class="inspector-role-text">${escapeHtml(data.role_label_ko || "-")}</span>`;
    }
    if (el.inspectorSkillName) el.inspectorSkillName.textContent = data.skill_name || "-";

    if (el.inspectorSkillPath) el.inspectorSkillPath.textContent = data.skill_markdown && data.skill_markdown.path ? data.skill_markdown.path : "";
    if (el.inspectorSkillContent)
      el.inspectorSkillContent.textContent = data.skill_markdown && data.skill_markdown.content ? data.skill_markdown.content : "SKILL.md 없음";

    if (el.inspectorAgentTomlPath) el.inspectorAgentTomlPath.textContent = data.agent_toml && data.agent_toml.path ? data.agent_toml.path : "";
    if (el.inspectorAgentTomlContent)
      el.inspectorAgentTomlContent.textContent =
        (data.agent_toml && data.agent_toml.content) ||
        (data.agent_json && data.agent_json.content) ||
        "agent.toml / config.json 없음";

    const scripts = Array.isArray(data.scripts) ? data.scripts : [];
    if (el.inspectorScriptsList) {
      el.inspectorScriptsList.innerHTML =
        scripts.length === 0
          ? `<li class="activity-item"><div class="activity-sub">scripts 없음</div></li>`
          : scripts
              .map((file) => {
                const active = file.path === state.selectedInspectorScriptPath;
                return `
                  <li class="activity-item">
                    <button class="inspector-item-btn ${active ? "active" : ""}" type="button" data-inspector-script="${escapeHtml(
                      file.path
                    )}">
                      <div class="activity-title">${escapeHtml(file.name)}</div>
                      <div class="activity-sub">${escapeHtml(file.path)}</div>
                    </button>
                  </li>
                `;
              })
              .join("");
    }
    if (el.inspectorScriptContent) {
      const target = scripts.find((item) => item.path === state.selectedInspectorScriptPath);
      el.inspectorScriptContent.textContent = target ? target.content : "";
    }

    const references = Array.isArray(data.references) ? data.references : [];
    if (el.inspectorReferencesList) {
      el.inspectorReferencesList.innerHTML =
        references.length === 0
          ? `<li class="activity-item"><div class="activity-sub">references 없음</div></li>`
          : references
              .map((file) => {
                const active = file.path === state.selectedInspectorReferencePath;
                return `
                  <li class="activity-item">
                    <button class="inspector-item-btn ${active ? "active" : ""}" type="button" data-inspector-reference="${escapeHtml(
                      file.path
                    )}">
                      <div class="activity-title">${escapeHtml(file.name)}</div>
                      <div class="activity-sub">${escapeHtml(file.path)}</div>
                    </button>
                  </li>
                `;
              })
              .join("");
    }
    if (el.inspectorReferenceContent) {
      const target = references.find((item) => item.path === state.selectedInspectorReferencePath);
      el.inspectorReferenceContent.textContent = target ? target.content : "";
    }
  }

  function openConsoleWithAgent(agentName) {
    const normalized = String(agentName || "").trim();
    if (!normalized) return;

    const target = (state.executableAgents || []).find((item) => item.name === normalized);
    if (target && !target.runnable) {
      state.liveText = `실행 불가 에이전트: ${normalized}`;
      state.tab = "console";
      render();
      return;
    }

    state.selectedAgentName = normalized;
    state.tab = "console";
    render();
  }

  function updateWorkflowDraftFromRunDetail(detail) {
    const steps = Array.isArray(detail && detail.steps)
      ? detail.steps.map((step) => {
          const agentMeta = findExecutableAgent(step.agent_name);
          return {
            agentName: step.agent_name,
            skillName: step.skill_name || "",
            roleLabel: (agentMeta && agentMeta.role_label_ko) || "",
            departmentLabel: (agentMeta && agentMeta.department_label_ko) || "",
            iconKey: step.icon_key || "bot",
            prompt: step.prompt || "",
            status: step.status || "queued",
            runId: step.run_id || "",
            progressText: step.last_event_message || step.summary || "",
          };
        })
      : [];
    state.workflowDraft = {
      goalPrompt: (detail && detail.goal_prompt) || state.workflowDraft.goalPrompt || "",
      steps: steps,
    };
    state.selectedWorkflowRunSteps = steps.map((step) => Object.assign({}, step));
    if (!Number.isInteger(state.selectedWorkflowStepIndex) || state.selectedWorkflowStepIndex < 0) {
      state.selectedWorkflowStepIndex = 0;
    }
    normalizeWorkflowStepSelection();
    state.workflowEditorSource = "run";
  }

  function findExecutableAgent(agentName) {
    return (state.executableAgents || []).find((item) => item.name === agentName) || null;
  }

  function addWorkflowRecommendation(index) {
    const item = (state.workflowRecommendations || [])[index];
    if (!item) return;
    const agentMeta = findExecutableAgent(item.agent_name);
    state.workflowDraft.steps = (state.workflowDraft.steps || []).concat([
      {
        agentName: item.agent_name,
        skillName: item.skill_name || "",
        roleLabel: (agentMeta && agentMeta.role_label_ko) || item.role_label_ko || "",
        departmentLabel: (agentMeta && agentMeta.department_label_ko) || item.department_label_ko || "",
        iconKey: item.icon_key || "bot",
        prompt: item.default_prompt || "",
        status: "ready",
        runId: "",
        progressText: item.reason || "",
      },
    ]);
    normalizeWorkflowDraftStepsForEditing();
    state.selectedWorkflowStepIndex = (state.workflowDraft.steps || []).length - 1;
    setWorkflowRecommendationStatus("후보 선별 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
  }

  function moveWorkflowStep(fromIndex, toIndex) {
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= steps.length || toIndex >= steps.length) {
      return;
    }
    const selectedIndex = state.selectedWorkflowStepIndex;
    const next = steps.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    state.workflowDraft.steps = next;
    if (selectedIndex === fromIndex) {
      state.selectedWorkflowStepIndex = toIndex;
    } else if (selectedIndex > fromIndex && selectedIndex <= toIndex) {
      state.selectedWorkflowStepIndex = selectedIndex - 1;
    } else if (selectedIndex < fromIndex && selectedIndex >= toIndex) {
      state.selectedWorkflowStepIndex = selectedIndex + 1;
    }
    normalizeWorkflowDraftStepsForEditing();
    setWorkflowRecommendationStatus("단계 재배치 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
  }

  async function loadWorkflowEvents(workflowRunId) {
    if (!workflowRunId) return;
    const data = await fetchJson(`/api/workflow-runs/${encodeURIComponent(workflowRunId)}/events?limit=1200`);
    state.workflowEventsByRunId.set(workflowRunId, data.events || []);
  }

  async function loadWorkflowRunDetail(workflowRunId) {
    if (!workflowRunId) return;
    const detail = await fetchJson(`/api/workflow-runs/${encodeURIComponent(workflowRunId)}`);
    updateWorkflowDraftFromRunDetail(detail);
  }

  async function recommendWorkflow() {
    const goalPrompt = ((el.workflowGoalInput && el.workflowGoalInput.value) || "").trim();
    if (!goalPrompt) {
      state.liveText = "워크플로 목표를 입력하세요.";
      render();
      return;
    }
    state.workflowDraft.goalPrompt = goalPrompt;
    normalizeWorkflowDraftStepsForEditing();
    setWorkflowRecommendationStatus("추천 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
    try {
      const maxAgents = (state.workflowUiConfig && state.workflowUiConfig.recommendation_max_agents) || null;
      const result = await postJsonWithAuth("/api/workflows/recommend", {
        goal_prompt: goalPrompt,
        max_agents: maxAgents,
      });
      state.workflowRecommendations = result.recommended_agents || [];
      setWorkflowRecommendationStatus(state.workflowRecommendations.length > 0 ? `후보 ${state.workflowRecommendations.length}개 준비` : "추천 결과 없음");
      state.liveText = `워크플로 추천 완료: ${state.workflowRecommendations.length}개`;
      renderWorkflow();
    } catch (err) {
      setWorkflowRecommendationStatus("추천 실패");
      state.hasError = true;
      state.liveText = `워크플로 추천 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function createWorkflowRun() {
    const goalPrompt = ((el.workflowGoalInput && el.workflowGoalInput.value) || "").trim();
    const steps = (state.workflowDraft && state.workflowDraft.steps) || [];
    if (!goalPrompt) {
      state.liveText = "워크플로 목표를 입력하세요.";
      render();
      return;
    }
    if (steps.length === 0) {
      state.liveText = "워크플로 단계를 하나 이상 추가하세요.";
      render();
      return;
    }
    try {
      setWorkflowRecommendationStatus("워크플로 실행 중");
      renderWorkflow();
      const created = await postJsonWithAuth("/api/workflow-runs", {
        goal_prompt: goalPrompt,
        workspace_root: (state.selectedWorkflowWorkspaceRoot || "").trim() || null,
        sandbox_mode: (state.selectedWorkflowSandboxMode || "").trim() || null,
        approval_policy: (state.selectedWorkflowApprovalPolicy || "").trim() || null,
        steps: steps.map((step) => ({
          agent_name: step.agentName,
          prompt: step.prompt,
          icon_key: step.iconKey,
          skill_name: step.skillName || null,
        })),
      });
      state.selectedWorkflowRunId = created.workflow_run_id;
      state.workflowEditorSource = "run";
      state.liveText = `워크플로 실행 생성: ${created.workflow_run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `워크플로 실행 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function retryWorkflowFromStep(stepIndex) {
    if (!state.selectedWorkflowRunId) return;
    try {
      const retried = await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/retry-from-step`, {
        step_index: stepIndex,
      });
      state.selectedWorkflowRunId = retried.workflow_run_id;
      state.workflowEditorSource = "run";
      state.liveText = `단계 ${stepIndex + 1}부터 재시도: ${retried.workflow_run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `단계 재시도 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function skipWorkflowStep(stepIndex) {
    if (!state.selectedWorkflowRunId) return;
    try {
      const retried = await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/skip-step`, {
        step_index: stepIndex,
      });
      state.selectedWorkflowRunId = retried.workflow_run_id;
      state.workflowEditorSource = "run";
      state.liveText = `단계 ${stepIndex + 1} 건너뛰고 계속: ${retried.workflow_run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `단계 건너뛰기 실패: ${String(err.message || err)}`;
      render();
    }
  }

  function updateWorkflowStepPrompt(index, value) {
    if (!Number.isInteger(index) || !state.workflowDraft.steps[index]) return;
    state.workflowDraft.steps[index].prompt = value || "";
    normalizeWorkflowDraftStepsForEditing();
    setWorkflowRecommendationStatus("단계 편집 중");
    state.workflowEditorSource = "draft";
    state.selectedWorkflowStepIndex = index;
  }

  function removeWorkflowStepByIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.workflowDraft.steps.length) return;
    state.workflowDraft.steps.splice(index, 1);
    normalizeWorkflowDraftStepsForEditing();
    if (state.selectedWorkflowStepIndex > index) {
      state.selectedWorkflowStepIndex -= 1;
    } else if (state.selectedWorkflowStepIndex === index) {
      state.selectedWorkflowStepIndex = Math.max(0, index - 1);
    }
    setWorkflowRecommendationStatus("단계 편집 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
  }

  function duplicateWorkflowStepByIndex(index) {
    if (!Number.isInteger(index) || !state.workflowDraft.steps[index]) return;
    const clone = Object.assign({}, state.workflowDraft.steps[index], {
      status: "ready",
      runId: "",
      progressText: "복제된 단계",
    });
    state.workflowDraft.steps.splice(index + 1, 0, clone);
    normalizeWorkflowDraftStepsForEditing();
    state.selectedWorkflowStepIndex = index + 1;
    setWorkflowRecommendationStatus("단계 편집 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
  }

  function handleWorkflowStepActionClick(target) {
    if (!(target instanceof HTMLElement)) return false;
    const selectButton = target.closest("[data-workflow-select-index]");
    if (selectButton) {
      const index = Number(selectButton.getAttribute("data-workflow-select-index"));
      if (Number.isInteger(index)) {
        selectWorkflowStep(index);
      }
      return true;
    }
    const removeButton = target.closest("[data-workflow-remove-index]");
    if (removeButton) {
      const index = Number(removeButton.getAttribute("data-workflow-remove-index"));
      if (Number.isInteger(index)) {
        removeWorkflowStepByIndex(index);
      }
      return true;
    }
    const duplicateButton = target.closest("[data-workflow-duplicate-index]");
    if (duplicateButton) {
      const index = Number(duplicateButton.getAttribute("data-workflow-duplicate-index"));
      if (Number.isInteger(index)) {
        duplicateWorkflowStepByIndex(index);
      }
      return true;
    }
    const retryFromStepButton = target.closest("[data-workflow-retry-from-step-index]");
    if (retryFromStepButton) {
      const index = Number(retryFromStepButton.getAttribute("data-workflow-retry-from-step-index"));
      if (Number.isInteger(index)) {
        retryWorkflowFromStep(index);
      }
      return true;
    }
    const skipStepButton = target.closest("[data-workflow-skip-step-index]");
    if (skipStepButton) {
      const index = Number(skipStepButton.getAttribute("data-workflow-skip-step-index"));
      if (Number.isInteger(index)) {
        skipWorkflowStep(index);
      }
      return true;
    }
    return false;
  }

  function addSelectedWorkflowAgent() {
    const agentMeta = findExecutableAgent(state.selectedWorkflowAgentName);
    if (!agentMeta) {
      state.liveText = "수동 추가할 에이전트를 선택하세요.";
      render();
      return;
    }
    state.workflowDraft.steps = (state.workflowDraft.steps || []).concat([
      {
        agentName: agentMeta.name,
        skillName: "",
        roleLabel: agentMeta.role_label_ko || "",
        departmentLabel: agentMeta.department_label_ko || "",
        iconKey: resolveWorkflowIconKeyForAgent(agentMeta),
        prompt: buildDefaultWorkflowPrompt(agentMeta),
        status: "ready",
        runId: "",
        progressText: "수동 추가된 단계",
      },
    ]);
    normalizeWorkflowDraftStepsForEditing();
    state.selectedWorkflowStepIndex = (state.workflowDraft.steps || []).length - 1;
    setWorkflowRecommendationStatus("수동 편집 중");
    state.workflowEditorSource = "draft";
    renderWorkflow();
  }

  function collectWorkflowCombinedLogLines() {
    if (!state.selectedWorkflowRunId) return [];
    const workflowEvents = state.workflowEventsByRunId.get(state.selectedWorkflowRunId) || [];
    const steps =
      state.workflowEditorSource === "run"
        ? (state.workflowDraft && state.workflowDraft.steps) || []
        : state.selectedWorkflowRunSteps || [];
    const lines = workflowEvents.map((event) => ({
      createdAt: event.created_at,
      sortKey: `[workflow]${event.event_id || 0}`,
      text: `[${fmtDate(event.created_at)}] ${event.event_type}${
        Number.isInteger(event.step_index) ? ` [step ${Number(event.step_index) + 1}]` : ""
      } ${event.message}`,
    }));

    steps.forEach((step, index) => {
      if (!step.runId) return;
      const runEvents = state.runEventsByRunId.get(step.runId) || [];
      runEvents.forEach((event) => {
        lines.push({
          createdAt: event.created_at,
          sortKey: `[run:${step.runId}]${event.event_id || 0}`,
          text: `[${fmtDate(event.created_at)}] ${event.event_type} [step ${index + 1}] ${event.message}`,
        });
      });
    });

    lines.sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.sortKey).localeCompare(String(right.sortKey));
    });
    return lines.map((item) => item.text);
  }

  async function cancelSelectedWorkflowRun() {
    if (!state.selectedWorkflowRunId) return;
    try {
      await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/cancel`);
      state.liveText = `워크플로 취소: ${state.selectedWorkflowRunId}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `워크플로 취소 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function retrySelectedWorkflowRun() {
    if (!state.selectedWorkflowRunId) return;
    try {
      const retried = await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/retry`);
      state.selectedWorkflowRunId = retried.workflow_run_id;
      state.workflowEditorSource = "run";
      state.liveText = `워크플로 재실행 생성: ${retried.workflow_run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `워크플로 재실행 실패: ${String(err.message || err)}`;
      render();
    }
  }

  function renderWorkspacePicker() {
    if (!el.workspacePickerModal || !el.workspacePickerCurrent || !el.workspacePickerList || !el.workspacePickerUp) return;
    el.workspacePickerModal.classList.toggle("hidden", !state.workspacePicker.open);
    el.workspacePickerCurrent.textContent = state.workspacePicker.currentPath || "경로 정보 없음";
    el.workspacePickerUp.disabled = !state.workspacePicker.parentPath;

    const dirs = Array.isArray(state.workspacePicker.directories) ? state.workspacePicker.directories : [];
    if (dirs.length === 0) {
      el.workspacePickerList.innerHTML = `<li class="activity-item"><div class="activity-sub">하위 폴더가 없습니다.</div></li>`;
      return;
    }
    el.workspacePickerList.innerHTML = dirs
      .map(
        (item) => `
        <li class="activity-item" data-dir-path="${escapeHtml(item.path)}">
          <div class="activity-title">${escapeHtml(item.name)}</div>
          <div class="activity-sub">${escapeHtml(item.path)}</div>
        </li>
      `
      )
      .join("");
  }

  function renderOrgTree(org) {
    if (!el.orgTree) return;
    if (!org || !Array.isArray(org.nodes) || org.nodes.length === 0) {
      el.orgTree.innerHTML = `<div class="org-node">조직도 데이터가 없습니다.</div>`;
      return;
    }

    const typePriority = {
      department: 0,
      agent: 1,
      router: 2,
      skill: 3,
      keyword: 4,
    };
    const nodesById = new Map();
    const childrenByParent = new Map();
    const childSet = new Set();
    const parentByChild = new Map();

    org.nodes.forEach((node) => {
      nodesById.set(node.id, node);
    });

    state.collapsedNodeIds = new Set(Array.from(state.collapsedNodeIds).filter((nodeId) => nodesById.has(nodeId)));

    (org.edges || []).forEach((edge) => {
      if (!childrenByParent.has(edge.source)) {
        childrenByParent.set(edge.source, []);
      }
      childrenByParent.get(edge.source).push(edge.target);
      childSet.add(edge.target);
      if (!parentByChild.has(edge.target)) {
        parentByChild.set(edge.target, edge.source);
      }
    });

    nodesById.forEach((_node, nodeId) => {
      if (!childrenByParent.has(nodeId)) {
        childrenByParent.set(nodeId, []);
      }
    });

    const compareNodes = (leftId, rightId) => {
      const left = nodesById.get(leftId);
      const right = nodesById.get(rightId);
      const leftTypeOrder = typePriority[left && left.type] ?? 99;
      const rightTypeOrder = typePriority[right && right.type] ?? 99;
      if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder;
      return String((left && left.label) || leftId).localeCompare(String((right && right.label) || rightId), "ko-KR");
    };

    const rootIds = Array.from(nodesById.keys())
      .filter((nodeId) => !childSet.has(nodeId))
      .sort(compareNodes);

    const departmentThemes = getDepartmentThemeMap();

    const resolveDepartmentLabel = (nodeId, node) => {
      if (!node) return "";
      if (node.type === "department") return String(node.label || "").trim();

      const metadataDepartment = node.metadata && typeof node.metadata["부서"] === "string" ? node.metadata["부서"].trim() : "";
      if (metadataDepartment) return metadataDepartment;

      let current = nodeId;
      for (let depth = 0; depth < 20; depth += 1) {
        const parentId = parentByChild.get(current);
        if (!parentId) break;
        const parentNode = nodesById.get(parentId);
        if (!parentNode) break;
        if (parentNode.type === "department") {
          return String(parentNode.label || "").trim();
        }
        current = parentId;
      }
      return "";
    };

    const renderBranch = (nodeId, depth, ancestry) => {
      const node = nodesById.get(nodeId);
      if (!node) return "";
      if (ancestry.has(nodeId)) return "";
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(nodeId);
      const rawNodeType = node.type || "unknown";
      const departmentLabel = resolveDepartmentLabel(nodeId, node);
      const departmentTheme = departmentLabel ? departmentThemes.get(departmentLabel) : null;
      const nodeStyle = departmentTheme
        ? ` style="--dept-border:${departmentTheme.border};--dept-bg-top:${departmentTheme.top};--dept-bg-bottom:${departmentTheme.bottom};"`
        : "";
      const titleMarkup =
        rawNodeType === "agent"
          ? `<div class="title-line"><span class="title">${escapeHtml(node.label || node.id)}</span><span class="sub inline-sub">${escapeHtml(
              node.sublabel || ""
            )}</span></div>`
          : `<div class="title">${escapeHtml(node.label || node.id)}</div><div class="sub">${escapeHtml(node.sublabel || "")}</div>`;
      const shortDescription =
        rawNodeType === "agent"
          ? String((node.metadata && node.metadata.short_description) || "").trim()
          : "";
      const rawAgentName =
        rawNodeType === "agent"
          ? String(node.sublabel || "").trim() || (String(node.id || "").startsWith("agent:") ? String(node.id).slice(6) : "")
          : "";

      const children = (childrenByParent.get(nodeId) || [])
        .filter((childId) => nodesById.has(childId))
        .sort(compareNodes);
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren ? state.collapsedNodeIds.has(nodeId) : false;
      const childMarkup = children
        .map((childId) => renderBranch(childId, depth + 1, nextAncestry))
        .filter(Boolean)
        .join("");

      return `
        <li class="tree-branch depth-${depth} ${isCollapsed ? "collapsed" : ""}">
          <article class="org-node ${escapeHtml(rawNodeType)} ${departmentTheme ? "dept-themed" : ""}"${nodeStyle}>
            ${
              hasChildren
                ? `<button class="node-toggle" type="button" data-node-id="${escapeHtml(nodeId)}" aria-expanded="${
                    isCollapsed ? "false" : "true"
                  }" aria-label="${isCollapsed ? "펼치기" : "접기"}">${isCollapsed ? "+" : "-"}</button>`
                : ""
            }
            ${titleMarkup}
            ${shortDescription ? `<div class="agent-short-desc">${escapeHtml(shortDescription)}</div>` : ""}
            <div class="org-node-status-row">
              ${statusBadge(node.status)}
              ${
                rawAgentName
                  ? `<button class="btn mini-btn run-agent-btn" type="button" data-agent-name="${escapeHtml(
                      rawAgentName
                    )}">실행</button>
                     <button class="btn mini-btn run-agent-once-btn" type="button" data-agent-name="${escapeHtml(
                       rawAgentName
                     )}">원클릭</button>`
                  : ""
              }
            </div>
          </article>
          ${childMarkup ? `<ul class="tree-children" ${isCollapsed ? "hidden" : ""}>${childMarkup}</ul>` : ""}
        </li>
      `;
    };

    const roots = rootIds.length > 0 ? rootIds : Array.from(nodesById.keys()).sort(compareNodes);
    const treeMarkup = roots.map((rootId) => renderBranch(rootId, 0, new Set())).filter(Boolean).join("");

    el.orgTree.innerHTML = `<ul class="org-chart">${treeMarkup}</ul>`;
  }

  function renderDashboardMetrics(metrics) {
    if (!el.dashboardMetrics) return;
    const list = metrics || [];
    if (list.length === 0) {
      el.dashboardMetrics.innerHTML = `<div class="metric-card">데이터 없음</div>`;
      return;
    }
    el.dashboardMetrics.innerHTML = list
      .map(
        (m) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${Number(m.value || 0)}</div>
        </div>
      `
      )
      .join("");
  }

  function renderOverview(overview) {
    if (!el.overviewMetrics) return;
    if (!overview) {
      el.overviewMetrics.innerHTML = `<div class="metric-row"><span>개요 없음</span><strong>-</strong></div>`;
      return;
    }

    const rows = [
      ["총 스킬", overview.total_skills],
      ["총 에이전트", overview.total_agents],
      ["라우팅 연결", overview.routed_agents],
      ["라우트 힌트", overview.route_hints],
      ["깨진 매핑", overview.broken_mappings],
      ["활성 스레드", overview.active_threads],
      ["활성 에이전트", overview.active_agents],
    ];
    el.overviewMetrics.innerHTML = rows
      .map((row) => `<div class="metric-row"><span>${row[0]}</span><strong>${Number(row[1] || 0)}</strong></div>`)
      .join("");
  }

  function render() {
    if (el.liveState) {
      el.liveState.textContent = state.liveText;
    }

    if (el.errorBanner) {
      if (state.hasError) {
        el.errorBanner.classList.remove("hidden");
        el.errorBanner.textContent = "API 연결에 실패했습니다. 서버 상태를 확인하세요.";
      } else {
        el.errorBanner.classList.add("hidden");
        el.errorBanner.textContent = "";
      }
    }

    if (state.tab === "org") {
      toggleTab("org");
    } else if (state.tab === "dashboard") {
      toggleTab("dashboard");
    } else if (state.tab === "workflow") {
      toggleTab("workflow");
    } else if (state.tab === "inspector") {
      toggleTab("inspector");
    } else {
      toggleTab("console");
    }

    renderOverview(state.overview);
    renderOrgTree(state.org);
    renderMetrics(el.departmentMetrics, state.dashboard && state.dashboard.department_breakdown);
    renderMetrics(el.statusMetrics, state.dashboard && state.dashboard.status_breakdown);
    renderDashboardMetrics(state.dashboard && state.dashboard.metrics);
    renderActivityList(el.timelineList, state.dashboard && state.dashboard.timeline);
    renderActivityList(el.activeAgents, state.dashboard && state.dashboard.active_agents);
    renderActivityList(el.recentSkills, state.dashboard && state.dashboard.recent_skills);
    renderActivityList(el.recentThreads, state.dashboard && state.dashboard.recent_threads);
    renderConsole();
    renderWorkflow();
    renderInspector();
    renderWorkspacePicker();
  }

  function renderChromeState() {
    if (el.liveState) {
      el.liveState.textContent = state.liveText;
    }

    if (el.errorBanner) {
      if (state.hasError) {
        el.errorBanner.classList.remove("hidden");
        el.errorBanner.textContent = "API 연결에 실패했습니다. 서버 상태를 확인하세요.";
      } else {
        el.errorBanner.classList.add("hidden");
        el.errorBanner.textContent = "";
      }
    }
  }

  function toggleTab(tabName) {
    const showOrg = tabName === "org";
    const showDashboard = tabName === "dashboard";
    const showConsole = tabName === "console";
    const showWorkflow = tabName === "workflow";
    const showInspector = tabName === "inspector";

    el.orgView.classList.toggle("hidden", !showOrg);
    el.dashboardView.classList.toggle("hidden", !showDashboard);
    el.consoleView.classList.toggle("hidden", !showConsole);
    if (el.workflowView) {
      el.workflowView.classList.toggle("hidden", !showWorkflow);
    }
    if (el.inspectorView) {
      el.inspectorView.classList.toggle("hidden", !showInspector);
    }
    el.tabOrg.classList.toggle("active", showOrg);
    el.tabDashboard.classList.toggle("active", showDashboard);
    el.tabConsole.classList.toggle("active", showConsole);
    if (el.tabWorkflow) {
      el.tabWorkflow.classList.toggle("active", showWorkflow);
    }
    if (el.tabInspector) {
      el.tabInspector.classList.toggle("active", showInspector);
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    return res.json();
  }

  function getWriteToken() {
    return window.localStorage.getItem(WRITE_API_TOKEN_KEY) || DEFAULT_WRITE_API_TOKEN;
  }

  function setWriteToken(token) {
    window.localStorage.setItem(WRITE_API_TOKEN_KEY, token);
  }

  async function postJsonWithAuth(url, body) {
    let token = getWriteToken();
    const request = async (targetToken) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Token": targetToken,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

    let res = await request(token);
    if (res.status === 401) {
      const nextToken = window.prompt("쓰기 API 토큰을 입력하세요", token || "");
      if (!nextToken || !nextToken.trim()) {
        throw new Error("write token required");
      }
      token = nextToken.trim();
      setWriteToken(token);
      res = await request(token);
    }
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    return res.json();
  }

  async function loadRunEvents(runId) {
    if (!runId) return;
    const data = await fetchJson(`/api/runs/${encodeURIComponent(runId)}/events?limit=800`);
    state.runEventsByRunId.set(runId, data.events || []);
  }

  async function loadWorkspaceDirectories(path) {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const data = await fetchJson(`/api/fs/directories${query}`);
    state.workspacePicker.currentPath = data.current_path || "";
    state.workspacePicker.parentPath = data.parent_path || null;
    state.workspacePicker.directories = data.directories || [];
  }

  async function openWorkspacePicker() {
    const basisPath = (state.tab === "workflow" ? state.selectedWorkflowWorkspaceRoot : state.selectedWorkspaceRoot || "").trim();
    try {
      await loadWorkspaceDirectories(basisPath || null);
      state.workspacePicker.open = true;
      render();
    } catch (err) {
      state.hasError = true;
      state.liveText = `폴더 목록 조회 실패: ${String(err.message || err)}`;
      render();
    }
  }

  function closeWorkspacePicker() {
    state.workspacePicker.open = false;
    render();
  }

  async function refreshAll() {
    try {
      const [overview, org, dashboard, executableAgentsData, runsData, runConfig, workflowUiConfig, workflowRunsData] = await Promise.all([
        fetchJson("/api/overview"),
        fetchJson("/api/graph/org"),
        fetchJson("/api/dashboard"),
        fetchJson("/api/agents/executable"),
        fetchJson("/api/runs?limit=40"),
        fetchJson("/api/run-config"),
        fetchJson("/api/workflows/ui-config"),
        fetchJson("/api/workflow-runs?limit=40"),
      ]);
      state.overview = overview;
      state.org = org;
      state.dashboard = dashboard;
      state.executableAgents = executableAgentsData.agents || [];
      state.runs = runsData.runs || [];
      state.workflowUiConfig = workflowUiConfig;
      state.workflowRuns = workflowRunsData.runs || [];
      const storedWorkspace = window.localStorage.getItem(WORKSPACE_ROOT_KEY) || "";
      const storedSandboxMode = window.localStorage.getItem(SANDBOX_MODE_KEY) || "";
      const storedApprovalPolicy = window.localStorage.getItem(APPROVAL_POLICY_KEY) || "";
      const defaultWorkspace = (runConfig && runConfig.default_workspace_root) || "";
      state.selectedWorkspaceRoot = storedWorkspace || state.selectedWorkspaceRoot || defaultWorkspace;
      state.selectedSandboxMode = storedSandboxMode || state.selectedSandboxMode || "workspace-write";
      state.selectedApprovalPolicy = storedApprovalPolicy || state.selectedApprovalPolicy || "on-request";
      state.selectedWorkflowWorkspaceRoot = state.selectedWorkflowWorkspaceRoot || state.selectedWorkspaceRoot || defaultWorkspace;
      state.selectedWorkflowSandboxMode = state.selectedWorkflowSandboxMode || state.selectedSandboxMode || "workspace-write";
      state.selectedWorkflowApprovalPolicy = state.selectedWorkflowApprovalPolicy || state.selectedApprovalPolicy || "on-request";
      if (state.selectedWorkspaceRoot) {
        window.localStorage.setItem(WORKSPACE_ROOT_KEY, state.selectedWorkspaceRoot);
      }
      window.localStorage.setItem(SANDBOX_MODE_KEY, state.selectedSandboxMode);
      window.localStorage.setItem(APPROVAL_POLICY_KEY, state.selectedApprovalPolicy);

      if (!state.selectedRunId && state.runs.length > 0) {
        state.selectedRunId = state.runs[0].run_id;
      }

      if (state.selectedRunId) {
        await loadRunEvents(state.selectedRunId);
      }

      if (!state.selectedWorkflowRunId && state.workflowRuns.length > 0) {
        state.selectedWorkflowRunId = state.workflowRuns[0].workflow_run_id;
      }
      if (
        state.selectedWorkflowRunId &&
        !state.workflowRuns.some((item) => item.workflow_run_id === state.selectedWorkflowRunId)
      ) {
        state.selectedWorkflowRunId = state.workflowRuns.length > 0 ? state.workflowRuns[0].workflow_run_id : null;
      }
      if (state.selectedWorkflowRunId) {
        const workflowPromises = [loadWorkflowEvents(state.selectedWorkflowRunId)];
        if (state.workflowEditorSource === "run") {
          workflowPromises.push(loadWorkflowRunDetail(state.selectedWorkflowRunId));
        }
        await Promise.all(workflowPromises);
        const workflowStepRunIds = ((state.workflowDraft && state.workflowDraft.steps) || [])
          .map((step) => String(step.runId || "").trim())
          .filter(Boolean);
        if (workflowStepRunIds.length > 0) {
          await Promise.all(workflowStepRunIds.map((runId) => loadRunEvents(runId)));
        }
      }

      if (state.tab === "inspector") {
        const fallbackAgent =
          state.selectedInspectorAgentName ||
          (state.executableAgents && state.executableAgents.length > 0 ? state.executableAgents[0].name : "");
        if (fallbackAgent) {
          await loadInspector(fallbackAgent);
        }
      }

      state.hasError = false;
      if (!state.liveText || state.liveText.startsWith("마지막 갱신:") || state.liveText === "이벤트 연결됨") {
        state.liveText = `마지막 갱신: ${fmtDate(overview.last_scanned_at)}`;
      }
    } catch (err) {
      state.hasError = true;
      state.liveText = `오류: ${String(err.message || err)}`;
    }
    render();
  }

  function scheduleRefresh(delayMs) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshAll();
    }, delayMs);
  }

  async function postAction(url) {
    try {
      await postJsonWithAuth(url);
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `요청 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function backupSkillAgentFiles() {
    if (el.backupBtn) {
      el.backupBtn.disabled = true;
    }
    if (el.restoreBtn) {
      el.restoreBtn.disabled = true;
    }
    try {
      const result = await postJsonWithAuth("/api/backups/skills-agents");
      const backupPath = result && result.backup_path ? String(result.backup_path) : "";
      const backupSize = formatBytes(result && result.size_bytes ? result.size_bytes : 0);
      const deletedCount = Number((result && result.deleted_entry_count) || 0);
      showToast(`백업 완료: ${backupPath} (${backupSize}) / 삭제 ${deletedCount}건`, "success");
      state.liveText = `백업 완료: ${backupPath} (삭제 ${deletedCount}건)`;
      await refreshAll();
    } catch (err) {
      const message = `백업 실패: ${String((err && err.message) || err || "")}`;
      showToast(message, "error");
      state.hasError = true;
      state.liveText = message;
      render();
    } finally {
      if (el.backupBtn) {
        el.backupBtn.disabled = false;
      }
      if (el.restoreBtn) {
        el.restoreBtn.disabled = false;
      }
    }
  }

  async function restoreSkillAgentFiles() {
    if (el.backupBtn) {
      el.backupBtn.disabled = true;
    }
    if (el.restoreBtn) {
      el.restoreBtn.disabled = true;
    }
    try {
      const result = await postJsonWithAuth("/api/backups/skills-agents/restore");
      const restoredFromPath = result && result.restored_from_path ? String(result.restored_from_path) : "";
      const restoredCount = Number((result && result.restored_member_count) || 0);
      const deletedCount = Number((result && result.deleted_entry_count_before_restore) || 0);
      showToast(`리스토어 완료: ${restoredFromPath} (복원 ${restoredCount}개, 기존삭제 ${deletedCount}건)`, "success");
      state.liveText = `리스토어 완료: ${restoredFromPath}`;
      await refreshAll();
    } catch (err) {
      const message = `리스토어 실패: ${String((err && err.message) || err || "")}`;
      showToast(message, "error");
      state.hasError = true;
      state.liveText = message;
      render();
    } finally {
      if (el.backupBtn) {
        el.backupBtn.disabled = false;
      }
      if (el.restoreBtn) {
        el.restoreBtn.disabled = false;
      }
    }
  }

  async function createRun() {
    if (!state.selectedAgentName) {
      state.liveText = "실행 가능한 에이전트를 선택하세요.";
      render();
      return;
    }
    const prompt = (el.runPromptInput && el.runPromptInput.value) || "";
    const workspaceRoot = (state.selectedWorkspaceRoot || "").trim();
    const sandboxMode = (state.selectedSandboxMode || "").trim();
    const approvalPolicy = (state.selectedApprovalPolicy || "").trim();
    try {
      const created = await postJsonWithAuth("/api/runs", {
        agent_name: state.selectedAgentName,
        prompt: prompt,
        workspace_root: workspaceRoot || null,
        sandbox_mode: sandboxMode || null,
        approval_policy: approvalPolicy || null,
      });
      state.selectedRunId = created.run_id;
      state.liveText = `실행 생성: ${created.run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `실행 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function createRunWithPreset(agentName) {
    const normalized = String(agentName || "").trim();
    if (!normalized) return;
    const workspaceRoot = (state.selectedWorkspaceRoot || "").trim();
    const sandboxMode = (state.selectedSandboxMode || "").trim();
    const approvalPolicy = (state.selectedApprovalPolicy || "").trim();
    const matched = (state.executableAgents || []).find((item) => item.name === normalized);
    let promptSource = "fallback";
    let shortDescription = matched && matched.short_description ? String(matched.short_description).trim() : "";
    let oneClickPrompt = matched && matched.one_click_prompt ? String(matched.one_click_prompt).trim() : "";

    // state 캐시가 비어 있거나 구버전 데이터일 수 있어, 클릭 시 inventory를 다시 조회해 보강한다.
    if (!oneClickPrompt) {
      try {
        const inventory = await fetchJson("/api/inventory");
        const invAgent = (inventory && inventory.agents ? inventory.agents : []).find((item) => item.name === normalized);
        if (invAgent) {
          if (!shortDescription && invAgent.description) {
            shortDescription = String(invAgent.description).trim();
          }
          if (invAgent.one_click_prompt) {
            oneClickPrompt = String(invAgent.one_click_prompt).trim();
          }
        }
      } catch (_err) {
        // inventory 조회 실패 시에는 기존 fallback 로직을 사용한다.
      }
    }

    if (oneClickPrompt) {
      promptSource = "agent.toml";
    } else if (shortDescription) {
      promptSource = "short_description";
    }

    const preset =
      oneClickPrompt ||
      (shortDescription
        ? `Run the mapped skill workflow focused on: ${shortDescription}`
        : "Run the mapped skill workflow for this request.");
    try {
      const created = await postJsonWithAuth("/api/runs", {
        agent_name: normalized,
        prompt: preset,
        workspace_root: workspaceRoot || null,
        sandbox_mode: sandboxMode || null,
        approval_policy: approvalPolicy || null,
      });
      state.selectedAgentName = normalized;
      state.selectedRunId = created.run_id;
      state.tab = "console";
      state.liveText = `원클릭 실행 생성: ${created.run_id} / prompt=${promptSource}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `원클릭 실행 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function cancelSelectedRun() {
    if (!state.selectedRunId) return;
    try {
      await postJsonWithAuth(`/api/runs/${encodeURIComponent(state.selectedRunId)}/cancel`);
      state.liveText = `실행 취소: ${state.selectedRunId}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `취소 실패: ${String(err.message || err)}`;
      render();
    }
  }

  async function retrySelectedRun() {
    if (!state.selectedRunId) return;
    try {
      const retried = await postJsonWithAuth(`/api/runs/${encodeURIComponent(state.selectedRunId)}/retry`);
      state.selectedRunId = retried.run_id;
      state.liveText = `재시도 생성: ${retried.run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `재시도 실패: ${String(err.message || err)}`;
      render();
    }
  }

  function appendRunEventFromSse(payload) {
    const runId = payload && payload.runId;
    const eventType = payload && payload.eventType;
    if (!runId || !eventType) return;
    const message = String(payload.message || "");
    const createdAt = payload.createdAt || new Date().toISOString();
    const next = state.runEventsByRunId.get(runId) ? state.runEventsByRunId.get(runId).slice() : [];
    next.push({
      event_id: Number(payload.eventId || 0),
      run_id: runId,
      event_type: eventType,
      message: message,
      created_at: createdAt,
    });
    if (next.length > 800) {
      next.splice(0, next.length - 800);
    }
    state.runEventsByRunId.set(runId, next);
  }

  function appendWorkflowEventFromSse(payload) {
    const workflowRunId = payload && payload.workflowRunId;
    const eventType = payload && payload.eventType;
    if (!workflowRunId || !eventType) return;
    const next = state.workflowEventsByRunId.get(workflowRunId) ? state.workflowEventsByRunId.get(workflowRunId).slice() : [];
    next.push({
      event_id: Number(payload.eventId || 0),
      workflow_run_id: workflowRunId,
      step_index: payload.stepIndex === null || payload.stepIndex === undefined ? null : Number(payload.stepIndex),
      event_type: eventType,
      message: String(payload.message || ""),
      created_at: payload.createdAt || new Date().toISOString(),
    });
    if (next.length > 1200) {
      next.splice(0, next.length - 1200);
    }
    state.workflowEventsByRunId.set(workflowRunId, next);
  }

  function selectedWorkflowUsesRunId(runId) {
    const normalizedRunId = String(runId || "").trim();
    if (!normalizedRunId) return false;
    const steps =
      state.workflowEditorSource === "run"
        ? (state.workflowDraft && state.workflowDraft.steps) || []
        : state.selectedWorkflowRunSteps || [];
    return steps.some((step) => String((step && step.runId) || "").trim() === normalizedRunId);
  }

  function setupEvents() {
    const eventSource = new EventSource("/api/events");
    eventSource.onopen = function () {
      if (!state.liveText || state.liveText.startsWith("마지막 갱신:") || state.liveText.includes("재연결")) {
        state.liveText = "이벤트 연결됨";
        renderChromeState();
      }
    };
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.type || payload.type === "heartbeat") return;

        if (RUN_EVENT_TYPES.has(payload.type)) {
          const runPayload = payload.payload || {};
          const payloadRunId = runPayload.runId;
          appendRunEventFromSse(runPayload);
          renderChromeState();
          if (payloadRunId === state.selectedRunId) {
            renderRunLog();
          }
          if (selectedWorkflowUsesRunId(payloadRunId)) {
            renderWorkflowLog();
          }

          if (payload.type === "run:stdout" || payload.type === "run:stderr") {
            if (state.tab === "console" && payloadRunId === state.selectedRunId) {
              renderRunLog();
            }
            if (state.tab === "workflow" && selectedWorkflowUsesRunId(payloadRunId)) {
              renderWorkflowSteps();
              renderWorkflowLog();
            }
            return;
          }
          scheduleRefresh(400);
          if (state.tab === "console") {
            renderConsole();
          } else if (state.tab === "workflow") {
            renderWorkflow();
          }
          return;
        }

        if (WORKFLOW_EVENT_TYPES.has(payload.type)) {
          appendWorkflowEventFromSse(payload.payload || {});
          renderChromeState();
          if ((payload.payload && payload.payload.workflowRunId) === state.selectedWorkflowRunId) {
            renderWorkflowLog();
          }
          scheduleRefresh(350);
          if (state.tab === "workflow") {
            renderWorkflow();
          }
          return;
        }

        renderChromeState();
        scheduleRefresh(200);
      } catch (_err) {
        /* ignore malformed events */
      }
    };
    eventSource.onerror = function () {
      state.liveText = "이벤트 재연결 중...";
      renderChromeState();
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function isEditableElement(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return true;
    if (target instanceof HTMLTextAreaElement) return true;
    return target.isContentEditable;
  }

  function bind() {
    if (el.tabOrg) {
      el.tabOrg.addEventListener("click", function () {
        state.tab = "org";
        render();
      });
    }
    if (el.tabDashboard) {
      el.tabDashboard.addEventListener("click", function () {
        state.tab = "dashboard";
        render();
      });
    }
    if (el.tabConsole) {
      el.tabConsole.addEventListener("click", function () {
        state.tab = "console";
        render();
      });
    }
    if (el.tabWorkflow) {
      el.tabWorkflow.addEventListener("click", function () {
        state.tab = "workflow";
        render();
      });
    }
    if (el.tabInspector) {
      el.tabInspector.addEventListener("click", function () {
        state.tab = "inspector";
        const fallbackAgent =
          state.selectedInspectorAgentName ||
          (state.executableAgents && state.executableAgents.length > 0 ? state.executableAgents[0].name : "");
        if (!fallbackAgent) {
          render();
          return;
        }
        loadInspector(fallbackAgent)
          .then(render)
          .catch((err) => {
            state.hasError = true;
            state.liveText = `인스펙터 로딩 실패: ${String(err.message || err)}`;
            render();
          });
      });
    }
    if (el.scanBtn) {
      el.scanBtn.addEventListener("click", function () {
        postAction("/api/scan");
      });
    }
    if (el.refreshBtn) {
      el.refreshBtn.addEventListener("click", function () {
        postAction("/api/activity/refresh");
      });
    }
    if (el.backupBtn) {
      el.backupBtn.addEventListener("click", function () {
        backupSkillAgentFiles();
      });
    }
    if (el.restoreBtn) {
      el.restoreBtn.addEventListener("click", function () {
        restoreSkillAgentFiles();
      });
    }
    if (el.runAgentSelect) {
      el.runAgentSelect.addEventListener("change", function () {
        state.selectedAgentName = el.runAgentSelect.value;
        closeCommandPalette();
      });
    }
    if (el.runPromptInput) {
      el.runPromptInput.addEventListener("input", function () {
        updateCommandPaletteByPromptValue();
      });
      el.runPromptInput.addEventListener("keydown", function (event) {
        if (event.key === "/" || event.code === "Slash") {
          window.setTimeout(function () {
            updateCommandPaletteByPromptValue();
          }, 0);
        }
        const slashQuery = extractSlashCommandQuery((el.runPromptInput && el.runPromptInput.value) || "");
        if (!state.commandPalette.open && slashQuery !== null && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          openCommandPalette(slashQuery);
          moveCommandPalette(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (!state.commandPalette.open) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveCommandPalette(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveCommandPalette(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          selectCommandPaletteAgentByIndex(state.commandPalette.activeIndex || 0);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
        }
      });
      el.runPromptInput.addEventListener("blur", function () {
        window.setTimeout(function () {
          closeCommandPalette();
        }, 120);
      });
    }
    if (el.runCommandPalette) {
      el.runCommandPalette.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-command-agent-index]");
        if (!button) return;
        const rawIndex = button.getAttribute("data-command-agent-index");
        const index = Number(rawIndex);
        if (!Number.isInteger(index)) return;
        selectCommandPaletteAgentByIndex(index);
      });
    }
    if (el.runWorkspaceInput) {
      el.runWorkspaceInput.addEventListener("change", function () {
        state.selectedWorkspaceRoot = (el.runWorkspaceInput.value || "").trim();
        window.localStorage.setItem(WORKSPACE_ROOT_KEY, state.selectedWorkspaceRoot);
      });
    }
    if (el.runSandboxSelect) {
      el.runSandboxSelect.addEventListener("change", function () {
        state.selectedSandboxMode = (el.runSandboxSelect.value || "").trim() || "workspace-write";
        window.localStorage.setItem(SANDBOX_MODE_KEY, state.selectedSandboxMode);
      });
    }
    if (el.runApprovalSelect) {
      el.runApprovalSelect.addEventListener("change", function () {
        state.selectedApprovalPolicy = (el.runApprovalSelect.value || "").trim() || "on-request";
        window.localStorage.setItem(APPROVAL_POLICY_KEY, state.selectedApprovalPolicy);
      });
    }
    if (el.runWorkspacePickerBtn) {
      el.runWorkspacePickerBtn.addEventListener("click", function () {
        openWorkspacePicker();
      });
    }
    if (el.workspacePickerClose) {
      el.workspacePickerClose.addEventListener("click", function () {
        closeWorkspacePicker();
      });
    }
    if (el.workspacePickerUp) {
      el.workspacePickerUp.addEventListener("click", function () {
        const parentPath = state.workspacePicker.parentPath;
        if (!parentPath) return;
        loadWorkspaceDirectories(parentPath)
          .then(render)
          .catch((err) => {
            state.hasError = true;
            state.liveText = `상위 폴더 이동 실패: ${String(err.message || err)}`;
            render();
          });
      });
    }
    if (el.workspacePickerChoose) {
      el.workspacePickerChoose.addEventListener("click", function () {
        const selectedPath = state.workspacePicker.currentPath || "";
        if (state.tab === "workflow") {
          state.selectedWorkflowWorkspaceRoot = selectedPath;
        } else {
          state.selectedWorkspaceRoot = selectedPath;
          window.localStorage.setItem(WORKSPACE_ROOT_KEY, selectedPath);
        }
        closeWorkspacePicker();
      });
    }
    if (el.workspacePickerList) {
      el.workspacePickerList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const item = target.closest("[data-dir-path]");
        if (!item) return;
        const dirPath = item.getAttribute("data-dir-path");
        if (!dirPath) return;
        loadWorkspaceDirectories(dirPath)
          .then(render)
          .catch((err) => {
            state.hasError = true;
            state.liveText = `폴더 이동 실패: ${String(err.message || err)}`;
            render();
          });
      });
    }
    if (el.runSubmitBtn) {
      el.runSubmitBtn.addEventListener("click", function () {
        createRun();
      });
    }
    if (el.runCancelBtn) {
      el.runCancelBtn.addEventListener("click", function () {
        cancelSelectedRun();
      });
    }
    if (el.runRetryBtn) {
      el.runRetryBtn.addEventListener("click", function () {
        retrySelectedRun();
      });
    }
    if (el.runList) {
      el.runList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const item = target.closest("[data-run-id]");
        if (!item) return;
        const runId = item.getAttribute("data-run-id");
        if (!runId) return;
        state.selectedRunId = runId;
        loadRunEvents(runId).finally(render);
      });
    }
    if (el.workflowGoalInput) {
      el.workflowGoalInput.addEventListener("input", function () {
        state.workflowDraft.goalPrompt = el.workflowGoalInput.value || "";
        normalizeWorkflowDraftStepsForEditing();
        if (state.workflowDraft.goalPrompt.trim()) {
          setWorkflowRecommendationStatus("초안 편집 중");
        }
        state.workflowEditorSource = "draft";
      });
    }
    if (el.workflowRecommendBtn) {
      el.workflowRecommendBtn.addEventListener("click", function () {
        recommendWorkflow();
      });
    }
    if (el.workflowAgentFilterInput) {
      el.workflowAgentFilterInput.addEventListener("input", function () {
        state.workflowAgentFilter = el.workflowAgentFilterInput.value || "";
        renderWorkflowManualAgentOptions();
      });
    }
    if (el.workflowAgentSelect) {
      el.workflowAgentSelect.addEventListener("change", function () {
        state.selectedWorkflowAgentName = el.workflowAgentSelect.value || "";
      });
    }
    if (el.workflowAgentAddBtn) {
      el.workflowAgentAddBtn.addEventListener("click", function () {
        addSelectedWorkflowAgent();
      });
    }
    if (el.workflowClearBtn) {
      el.workflowClearBtn.addEventListener("click", function () {
        state.workflowRecommendations = [];
        state.workflowDraft = {
          goalPrompt: (el.workflowGoalInput && el.workflowGoalInput.value) || "",
          steps: [],
        };
        setWorkflowRecommendationStatus("대기 중");
        state.workflowEditorSource = "draft";
        renderWorkflow();
      });
    }
    if (el.workflowWorkspaceInput) {
      el.workflowWorkspaceInput.addEventListener("change", function () {
        state.selectedWorkflowWorkspaceRoot = (el.workflowWorkspaceInput.value || "").trim();
      });
    }
    if (el.workflowSandboxSelect) {
      el.workflowSandboxSelect.addEventListener("change", function () {
        state.selectedWorkflowSandboxMode = (el.workflowSandboxSelect.value || "").trim() || "workspace-write";
      });
    }
    if (el.workflowApprovalSelect) {
      el.workflowApprovalSelect.addEventListener("change", function () {
        state.selectedWorkflowApprovalPolicy = (el.workflowApprovalSelect.value || "").trim() || "on-request";
      });
    }
    if (el.workflowWorkspacePickerBtn) {
      el.workflowWorkspacePickerBtn.addEventListener("click", function () {
        openWorkspacePicker();
      });
    }
    if (el.workflowRunBtn) {
      el.workflowRunBtn.addEventListener("click", function () {
        createWorkflowRun();
      });
    }
    if (el.workflowCancelBtn) {
      el.workflowCancelBtn.addEventListener("click", function () {
        cancelSelectedWorkflowRun();
      });
    }
    if (el.workflowRetryBtn) {
      el.workflowRetryBtn.addEventListener("click", function () {
        retrySelectedWorkflowRun();
      });
    }
    if (el.workflowRecommendationList) {
      el.workflowRecommendationList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-workflow-add-index]");
        if (!button) return;
        const rawIndex = button.getAttribute("data-workflow-add-index");
        const index = Number(rawIndex);
        if (!Number.isInteger(index)) return;
        addWorkflowRecommendation(index);
      });
    }
    if (el.workflowStepList) {
      el.workflowStepList.addEventListener("click", function (event) {
        const target = event.target;
        if (handleWorkflowStepActionClick(target)) return;
      });
      el.workflowStepList.addEventListener("dragstart", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest("[data-workflow-step-index]");
        if (!card) return;
        const index = card.getAttribute("data-workflow-step-index");
        if (!event.dataTransfer || index === null) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(WORKFLOW_STEP_DRAG_TYPE, index);
        card.classList.add("dragging");
      });
      el.workflowStepList.addEventListener("dragend", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest("[data-workflow-step-index]");
        if (!card) return;
        card.classList.remove("dragging");
      });
      el.workflowStepList.addEventListener("dragover", function (event) {
        event.preventDefault();
      });
      el.workflowStepList.addEventListener("drop", function (event) {
        event.preventDefault();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest("[data-workflow-step-index]");
        if (!event.dataTransfer || !card) return;
        const fromIndex = Number(event.dataTransfer.getData(WORKFLOW_STEP_DRAG_TYPE));
        const toIndex = Number(card.getAttribute("data-workflow-step-index"));
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        moveWorkflowStep(fromIndex, toIndex);
      });
    }
    if (el.workflowStepInspector) {
      el.workflowStepInspector.addEventListener("input", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const textarea = target.closest("[data-workflow-prompt-index]");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const index = Number(textarea.getAttribute("data-workflow-prompt-index"));
        if (!Number.isInteger(index)) return;
        updateWorkflowStepPrompt(index, textarea.value || "");
      });
      el.workflowStepInspector.addEventListener("click", function (event) {
        const target = event.target;
        handleWorkflowStepActionClick(target);
      });
    }
    if (el.workflowRunList) {
      el.workflowRunList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const item = target.closest("[data-workflow-run-id]");
        if (!item) return;
        const workflowRunId = item.getAttribute("data-workflow-run-id");
        if (!workflowRunId) return;
        state.selectedWorkflowRunId = workflowRunId;
        state.workflowEditorSource = "run";
        Promise.all([loadWorkflowRunDetail(workflowRunId), loadWorkflowEvents(workflowRunId)])
          .then(async function () {
            const workflowStepRunIds = ((state.workflowDraft && state.workflowDraft.steps) || [])
              .map((step) => String(step.runId || "").trim())
              .filter(Boolean);
            if (workflowStepRunIds.length > 0) {
              await Promise.all(workflowStepRunIds.map((runId) => loadRunEvents(runId)));
            }
          })
          .finally(render);
      });
    }
    if (el.orgTree) {
      el.orgTree.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const runButton = target.closest(".run-agent-btn");
        if (runButton) {
          const agentName = runButton.getAttribute("data-agent-name");
          if (!agentName) return;
          openConsoleWithAgent(agentName);
          return;
        }
        const runOnceButton = target.closest(".run-agent-once-btn");
        if (runOnceButton) {
          const agentName = runOnceButton.getAttribute("data-agent-name");
          if (!agentName) return;
          createRunWithPreset(agentName);
          return;
        }
        const toggleButton = target.closest(".node-toggle");
        if (!toggleButton) return;

        const nodeId = toggleButton.getAttribute("data-node-id");
        if (!nodeId) return;

        if (state.collapsedNodeIds.has(nodeId)) {
          state.collapsedNodeIds.delete(nodeId);
        } else {
          state.collapsedNodeIds.add(nodeId);
        }
        renderOrgTree(state.org);
      });
    }
    if (el.inspectorAgentList) {
      el.inspectorAgentList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-inspector-agent]");
        if (!button) return;
        const agentName = button.getAttribute("data-inspector-agent");
        if (!agentName) return;
        loadInspector(agentName)
          .then(render)
          .catch((err) => {
            state.hasError = true;
            state.liveText = `인스펙터 조회 실패: ${String(err.message || err)}`;
            render();
          });
      });
    }
    if (el.inspectorScriptsList) {
      el.inspectorScriptsList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-inspector-script]");
        if (!button) return;
        const path = button.getAttribute("data-inspector-script");
        if (!path) return;
        state.selectedInspectorScriptPath = path;
        renderInspector();
      });
    }
    if (el.inspectorReferencesList) {
      el.inspectorReferencesList.addEventListener("click", function (event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-inspector-reference]");
        if (!button) return;
        const path = button.getAttribute("data-inspector-reference");
        if (!path) return;
        state.selectedInspectorReferencePath = path;
        renderInspector();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (state.tab !== "console") return;
      if (!(event.key === "/" || event.code === "Slash")) return;
      if (!el.runPromptInput) return;
      if (isEditableElement(event.target)) return;
      event.preventDefault();
      el.runPromptInput.focus();
      if (!String(el.runPromptInput.value || "").startsWith("/")) {
        el.runPromptInput.value = "/";
      }
      updateCommandPaletteByPromptValue();
    });
    document.addEventListener("click", function (event) {
      if (!state.commandPalette.open || !el.runPromptWrap) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (el.runPromptWrap.contains(target)) return;
      closeCommandPalette();
    });
  }

  bind();
  refreshAll();
  setupEvents();
  setInterval(refreshAll, FALLBACK_REFRESH_INTERVAL_MS);
})();
