(function () {
  const WRITE_API_TOKEN_KEY = "custom-codex-agent-write-token";
  const WORKSPACE_ROOT_KEY = "custom-codex-agent-workspace-root";
  const SANDBOX_MODE_KEY = "custom-codex-agent-sandbox-mode";
  const APPROVAL_POLICY_KEY = "custom-codex-agent-approval-policy";
  const ENGINE_KEY = "custom-codex-agent-engine";
  const UI_THEME_KEY = "custom-codex-agent-ui-theme";
  const ORG_HUD_EXPANDED_KEY = "custom-codex-agent-org-hud-expanded";
  const WORKFLOW_LOG_VIEW_KEY = "custom-codex-agent-workflow-log-view";
  const REFRESH_INTERVAL_MS = 120000;
  const WORKFLOW_DRAG_THRESHOLD_PX = 10;
  const WORKFLOW_ORDER_SNAP_PX = 140;

  const THEME_META = {
    cyber_fusion: {
      bodyTheme: "cyber-fusion",
      label: "Cyber Fusion",
      titles: {
        org: "MANAGEMENT_TOPOLOGY",
        dashboard: "OPERATIONAL_HUD",
        console: "TACTICAL_CONSOLE",
        workflow: "ORCHESTRATION_NETWORK",
        inspector: "LOGIC_INSPECTOR",
      },
    },
    glass_enterprise: {
      bodyTheme: "glass-enterprise",
      label: "Glass Enterprise",
      titles: {
        org: "기업 조직도",
        dashboard: "운영 대시보드",
        console: "실행 콘솔",
        workflow: "인터랙티브 로직",
        inspector: "스킬 인스펙터",
      },
    },
    minimal_pro: {
      bodyTheme: "minimal-pro",
      label: "Minimal Pro",
      titles: {
        org: "01_STRUCTURE",
        dashboard: "02_DASHBOARD",
        console: "03_COMMANDS",
        workflow: "04_NETWORK",
        inspector: "05_INSPECTOR",
      },
    },
  };

  let workflowStepSerial = 0;
  let refreshTimer = null;
  let toastTimer = null;
  let dragState = null;
  let lastWorkflowDragEndedAt = 0;
  let workflowSceneRenderQueued = false;
  let deferredInteractiveRender = false;
  let writeTokenPromptResolver = null;

  const state = {
    tab: "org",
    theme: "cyber_fusion",
    defaultWorkspaceRoot: "",
    defaultWriteApiToken: "",
    writeApiEnabled: true,
    overview: null,
    org: null,
    dashboard: null,
    executableAgents: [],
    runs: [],
    runDetails: new Map(),
    runEvents: new Map(),
    selectedRunId: "",
    workflowUiConfig: null,
    workflowRecommendations: [],
    workflowDraft: {
      goalPrompt: "",
      steps: [],
    },
    workflowRuns: [],
    workflowRunDetails: new Map(),
    workflowEvents: new Map(),
    selectedWorkflowRunId: "",
    selectedWorkflowWorkspaceRoot: "",
    selectedWorkflowSandboxMode: "workspace-write",
    selectedWorkflowApprovalPolicy: "on-request",
    selectedWorkspaceRoot: "",
    selectedSandboxMode: "workspace-write",
    selectedApprovalPolicy: "on-request",
    selectedEngine: "codex",
    availableEngines: ["codex"],
    selectedAgentName: "",
    workflowAgentFilter: "",
    selectedWorkflowAgentName: "",
    inspectorCache: new Map(),
    selectedInspectorAgentName: "",
    selectedInspectorScriptPath: "",
    selectedInspectorReferencePath: "",
    orgHudExpanded: false,
    workflowConversationStepIndex: 0,
    workflowConversationText: "",
    workflowLogView: "codex",
    drawer: {
      open: false,
      kicker: "UNIT_PROFILE",
      title: "Target",
      subtitle: "",
      bodyHtml: "",
    },
    workspacePicker: {
      open: false,
      target: "run",
      currentPath: "",
      parentPath: null,
      directories: [],
    },
    writeTokenModal: {
      open: false,
      description: "쓰기 작업을 진행하려면 토큰이 필요합니다.",
      draft: "",
    },
    liveText: "초기화 중...",
    hasError: false,
    errorMessage: "",
    workflowProgressVisible: false,
    workflowProgressText: "Analyzing Strategic Objectives...",
    workflowNodePositions: {},
  };

  const el = {
    body: document.body,
    viewportTitle: document.getElementById("viewport-title"),
    liveState: document.getElementById("live-state"),
    errorBanner: document.getElementById("error-banner"),
    themeSwitcher: document.getElementById("theme-switcher"),
    globalEngineSelect: document.getElementById("global-engine-select"),
    themeQuickButtons: Array.from(document.querySelectorAll("[data-theme-value]")),
    tabOrg: document.getElementById("tab-org"),
    tabDashboard: document.getElementById("tab-dashboard"),
    tabConsole: document.getElementById("tab-console"),
    tabWorkflow: document.getElementById("tab-workflow"),
    tabInspector: document.getElementById("tab-inspector"),
    orgView: document.getElementById("org-view"),
    dashboardView: document.getElementById("dashboard-view"),
    consoleView: document.getElementById("console-view"),
    workflowView: document.getElementById("workflow-view"),
    inspectorView: document.getElementById("inspector-view"),
    scanBtn: document.getElementById("scan-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    backupBtn: document.getElementById("backup-btn"),
    restoreBtn: document.getElementById("restore-btn"),
    orgHudGrid: document.getElementById("org-hud-grid"),
    orgTree: document.getElementById("org-tree"),
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
    runPromptInput: document.getElementById("run-prompt-input"),
    runSubmitBtn: document.getElementById("run-submit-btn"),
    runCancelBtn: document.getElementById("run-cancel-btn"),
    runRetryBtn: document.getElementById("run-retry-btn"),
    runList: document.getElementById("run-list"),
    runMeta: document.getElementById("run-meta"),
    runLog: document.getElementById("run-log"),
    workflowProgressHud: document.getElementById("workflow-progress-hud"),
    workflowProgressText: document.getElementById("workflow-progress-text"),
    workflowStepList: document.getElementById("workflow-step-list"),
    workflowEmptyState: document.getElementById("workflow-empty-state"),
    workflowStageDock: document.querySelector(".workflow-stage-dock"),
    workflowGoalInput: document.getElementById("workflow-goal-input"),
    workflowWorkspaceInput: document.getElementById("workflow-workspace-input"),
    workflowWorkspacePickerBtn: document.getElementById("workflow-workspace-picker-btn"),
    workflowSandboxSelect: document.getElementById("workflow-sandbox-select"),
    workflowApprovalSelect: document.getElementById("workflow-approval-select"),
    workflowRecommendBtn: document.getElementById("workflow-recommend-btn"),
    workflowAgentAddBtn: document.getElementById("workflow-agent-add-btn"),
    workflowRunBtn: document.getElementById("workflow-run-btn"),
    workflowCancelBtn: document.getElementById("workflow-cancel-btn"),
    workflowRetryBtn: document.getElementById("workflow-retry-btn"),
    workflowAgentFilterInput: document.getElementById("workflow-agent-filter-input"),
    workflowAgentSelect: document.getElementById("workflow-agent-select"),
    workflowRecommendationStatus: document.getElementById("workflow-recommendation-status"),
    workflowStageCount: document.getElementById("workflow-stage-count"),
    workflowSelectedRunLabel: document.getElementById("workflow-selected-run-label"),
    workflowRecommendationMeta: document.getElementById("workflow-recommendation-meta"),
    workflowRunList: document.getElementById("workflow-run-list"),
    workflowMeta: document.getElementById("workflow-meta"),
    workflowLogViewCodexBtn: document.getElementById("workflow-log-view-codex"),
    workflowLogViewRawBtn: document.getElementById("workflow-log-view-raw"),
    workflowCodexLogFeed: document.getElementById("workflow-codex-log-feed"),
    workflowLog: document.getElementById("workflow-log"),
    workflowConversationStatus: document.getElementById("workflow-conversation-status"),
    workflowConversationHint: document.getElementById("workflow-conversation-hint"),
    workflowConversationStepSelect: document.getElementById("workflow-conversation-step-select"),
    workflowConversationInput: document.getElementById("workflow-conversation-input"),
    workflowConversationApplyBtn: document.getElementById("workflow-conversation-apply-btn"),
    workflowConversationRetryBtn: document.getElementById("workflow-conversation-retry-btn"),
    orgHudToggleBtn: document.getElementById("org-hud-toggle-btn"),
    orgHudPanel: document.getElementById("org-hud-panel"),
    inspectorAgentList: document.getElementById("inspector-agent-list"),
    inspectorAgentName: document.getElementById("inspector-agent-name"),
    inspectorSummary: document.getElementById("inspector-summary"),
    inspectorAgentRole: document.getElementById("inspector-agent-role"),
    inspectorSkillName: document.getElementById("inspector-skill-name"),
    inspectorSkillPath: document.getElementById("inspector-skill-path"),
    inspectorSkillContent: document.getElementById("inspector-skill-content"),
    inspectorSkillSaveBtn: document.getElementById("inspector-skill-save-btn"),
    inspectorAgentTomlPath: document.getElementById("inspector-agent-toml-path"),
    inspectorAgentTomlContent: document.getElementById("inspector-agent-toml-content"),
    inspectorAgentConfigSaveBtn: document.getElementById("inspector-agent-config-save-btn"),
    inspectorScriptsList: document.getElementById("inspector-scripts-list"),
    inspectorScriptContent: document.getElementById("inspector-script-content"),
    inspectorScriptSaveBtn: document.getElementById("inspector-script-save-btn"),
    inspectorReferencesList: document.getElementById("inspector-references-list"),
    inspectorReferenceContent: document.getElementById("inspector-reference-content"),
    inspectorReferenceSaveBtn: document.getElementById("inspector-reference-save-btn"),
    drawer: document.getElementById("context-drawer"),
    drawerKicker: document.getElementById("drawer-kicker"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerSubtitle: document.getElementById("drawer-subtitle"),
    drawerBody: document.getElementById("drawer-body"),
    drawerCloseBtn: document.getElementById("drawer-close-btn"),
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    workspacePickerModal: document.getElementById("workspace-picker-modal"),
    workspacePickerClose: document.getElementById("workspace-picker-close"),
    workspacePickerCurrent: document.getElementById("workspace-picker-current"),
    workspacePickerUp: document.getElementById("workspace-picker-up"),
    workspacePickerChoose: document.getElementById("workspace-picker-choose"),
    workspacePickerList: document.getElementById("workspace-picker-list"),
    writeTokenModal: document.getElementById("write-token-modal"),
    writeTokenClose: document.getElementById("write-token-close"),
    writeTokenDescription: document.getElementById("write-token-description"),
    writeTokenInput: document.getElementById("write-token-input"),
    writeTokenDefault: document.getElementById("write-token-default"),
    writeTokenSave: document.getElementById("write-token-save"),
    toastContainer: document.getElementById("toast-container"),
  };

  function normalizeTheme(themeId) {
    return Object.prototype.hasOwnProperty.call(THEME_META, themeId) ? themeId : "cyber_fusion";
  }

  function getCurrentTheme() {
    return THEME_META[normalizeTheme(state.theme)] || THEME_META.cyber_fusion;
  }

  function hashText(text) {
    return Array.from(String(text || "")).reduce(function (acc, char) {
      return ((acc * 31) + char.charCodeAt(0)) >>> 0;
    }, 7);
  }

  function getDepartmentAccent(department) {
    const palettes = {
      cyber_fusion: [
        { solid: "hsl(155 92% 52%)", soft: "hsla(155, 92%, 52%, 0.12)", glow: "hsla(155, 92%, 52%, 0.24)" },
        { solid: "hsl(196 92% 58%)", soft: "hsla(196, 92%, 58%, 0.12)", glow: "hsla(196, 92%, 58%, 0.24)" },
        { solid: "hsl(34 100% 58%)", soft: "hsla(34, 100%, 58%, 0.12)", glow: "hsla(34, 100%, 58%, 0.24)" },
        { solid: "hsl(279 80% 68%)", soft: "hsla(279, 80%, 68%, 0.12)", glow: "hsla(279, 80%, 68%, 0.22)" },
        { solid: "hsl(344 92% 64%)", soft: "hsla(344, 92%, 64%, 0.12)", glow: "hsla(344, 92%, 64%, 0.22)" },
        { solid: "hsl(88 72% 56%)", soft: "hsla(88, 72%, 56%, 0.12)", glow: "hsla(88, 72%, 56%, 0.2)" },
      ],
      glass_enterprise: [
        { solid: "hsl(224 72% 56%)", soft: "hsla(224, 72%, 56%, 0.1)", glow: "hsla(224, 72%, 56%, 0.16)" },
        { solid: "hsl(170 62% 40%)", soft: "hsla(170, 62%, 40%, 0.1)", glow: "hsla(170, 62%, 40%, 0.16)" },
        { solid: "hsl(24 82% 54%)", soft: "hsla(24, 82%, 54%, 0.1)", glow: "hsla(24, 82%, 54%, 0.16)" },
        { solid: "hsl(286 58% 58%)", soft: "hsla(286, 58%, 58%, 0.1)", glow: "hsla(286, 58%, 58%, 0.16)" },
        { solid: "hsl(348 72% 58%)", soft: "hsla(348, 72%, 58%, 0.1)", glow: "hsla(348, 72%, 58%, 0.16)" },
        { solid: "hsl(92 54% 42%)", soft: "hsla(92, 54%, 42%, 0.1)", glow: "hsla(92, 54%, 42%, 0.16)" },
      ],
      minimal_pro: [
        { solid: "hsl(0 0% 100%)", soft: "hsla(0, 0%, 100%, 0.08)", glow: "hsla(0, 0%, 100%, 0.14)" },
        { solid: "hsl(208 16% 82%)", soft: "hsla(208, 16%, 82%, 0.1)", glow: "hsla(208, 16%, 82%, 0.14)" },
        { solid: "hsl(49 100% 80%)", soft: "hsla(49, 100%, 80%, 0.08)", glow: "hsla(49, 100%, 80%, 0.14)" },
        { solid: "hsl(160 44% 78%)", soft: "hsla(160, 44%, 78%, 0.08)", glow: "hsla(160, 44%, 78%, 0.14)" },
        { solid: "hsl(339 48% 80%)", soft: "hsla(339, 48%, 80%, 0.08)", glow: "hsla(339, 48%, 80%, 0.14)" },
        { solid: "hsl(264 40% 84%)", soft: "hsla(264, 40%, 84%, 0.08)", glow: "hsla(264, 40%, 84%, 0.14)" },
      ],
    };
    const themeId = normalizeTheme(state.theme);
    const palette = palettes[themeId] || palettes.cyber_fusion;
    return palette[hashText(department) % palette.length];
  }

  function getOrgAccentStyle(accent, isFounder) {
    const solid = isFounder ? "var(--accent)" : accent.solid;
    const soft = isFounder ? "var(--accent-glow)" : accent.soft;
    const glow = isFounder ? "var(--accent-glow)" : accent.glow;
    return `--org-accent-color:${solid};--org-accent-soft:${soft};--org-accent-glow:${glow};`;
  }

  function getDepartmentAccentStyle(departmentLabel) {
    const label = String(departmentLabel || "").trim() || "관리지원";
    const departmentNode = ((state.org && state.org.nodes) || []).find(function (node) {
      return node && node.type === "department" && String(node.label || "").trim() === label;
    });
    const departmentKey = departmentNode ? departmentNode.id : `dept:${label}`;
    return getOrgAccentStyle(getDepartmentAccent(departmentKey), false);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtDate(value) {
    if (!value) return "시각 정보 없음";
    try {
      return new Date(value).toLocaleString("ko-KR");
    } catch (_err) {
      return String(value);
    }
  }

  function hasActiveFormInteraction() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return Boolean(active.closest("select, textarea, input"));
  }

  function renderWithInteractionGuard() {
    if (hasActiveFormInteraction()) {
      deferredInteractiveRender = true;
      return;
    }
    deferredInteractiveRender = false;
    render();
  }

  function flushDeferredInteractiveRender() {
    if (!deferredInteractiveRender || hasActiveFormInteraction()) return;
    deferredInteractiveRender = false;
    render();
  }

  function getWriteToken() {
    return normalizeWriteToken(window.localStorage.getItem(WRITE_API_TOKEN_KEY) || state.defaultWriteApiToken || "");
  }

  function normalizeWriteToken(token) {
    return String(token || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
  }

  function isSafeHeaderToken(token) {
    return /^[\x21-\x7e]+$/.test(token);
  }

  function setWriteToken(token) {
    const normalized = normalizeWriteToken(token);
    if (!normalized) {
      window.localStorage.removeItem(WRITE_API_TOKEN_KEY);
      return;
    }
    window.localStorage.setItem(WRITE_API_TOKEN_KEY, normalized);
  }

  function renderWriteTokenModal() {
    if (!el.writeTokenModal || !el.writeTokenDescription || !el.writeTokenInput || !el.writeTokenDefault) return;
    el.writeTokenModal.classList.toggle("hidden", !state.writeTokenModal.open);
    el.writeTokenDescription.textContent = state.writeTokenModal.description || "쓰기 작업을 진행하려면 토큰이 필요합니다.";
    if (el.writeTokenInput.value !== state.writeTokenModal.draft) {
      el.writeTokenInput.value = state.writeTokenModal.draft || "";
    }
    el.writeTokenDefault.disabled = !state.defaultWriteApiToken;
    if (state.writeTokenModal.open) {
      window.setTimeout(function () {
        if (!el.writeTokenInput) return;
        el.writeTokenInput.focus();
        el.writeTokenInput.select();
      }, 0);
    }
  }

  function closeWriteTokenModal(result, cancelled) {
    state.writeTokenModal.open = false;
    renderWriteTokenModal();
    const resolver = writeTokenPromptResolver;
    writeTokenPromptResolver = null;
    if (!resolver) return;
    resolver({ token: result, cancelled: Boolean(cancelled) });
  }

  async function requestWriteToken(description, initialToken) {
    if (!el.writeTokenModal || !el.writeTokenInput) {
      return { token: normalizeWriteToken(initialToken || state.defaultWriteApiToken), cancelled: false };
    }
    state.writeTokenModal.open = true;
    state.writeTokenModal.description = description || "쓰기 작업을 진행하려면 토큰이 필요합니다.";
    state.writeTokenModal.draft = normalizeWriteToken(initialToken || state.defaultWriteApiToken);
    renderWriteTokenModal();
    return new Promise(function (resolve) {
      writeTokenPromptResolver = resolve;
    });
  }

  async function fetchJson(url, label) {
    const target = label || url;
    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      const detail = err && err.message ? String(err.message) : "네트워크 연결 실패";
      throw new Error(`${target} 요청 중 네트워크 오류: ${detail}`);
    }
    if (!response.ok) {
      throw new Error(`${target} 요청 실패 (${response.status})`);
    }
    return response.json();
  }

  async function postJsonWithAuth(url, body) {
    let token = normalizeWriteToken(getWriteToken());
    if (token && !isSafeHeaderToken(token)) {
      setWriteToken("");
      throw new Error("저장된 쓰기 API 토큰 형식이 잘못되었습니다. 토큰을 다시 입력하세요.");
    }
    const request = async (targetToken) => {
      try {
        const headers = {
          "Content-Type": "application/json",
        };
        if (targetToken) {
          headers["X-API-Token"] = targetToken;
        }
        return await fetch(url, {
          method: "POST",
          headers: headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        const detail = err && err.message ? String(err.message) : "네트워크 연결 실패";
        throw new Error(`${url} POST 중 네트워크 오류: ${detail}`);
      }
    };

    let response = await request(token);
    if (response.status === 503) {
      throw new Error("write api disabled");
    }
    if (response.status === 401) {
      const promptResult = await requestWriteToken("쓰기 API 토큰이 필요합니다. 비워두면 서버 기본값을 사용합니다.", token);
      const normalized = normalizeWriteToken(promptResult && promptResult.token);
      if (promptResult && promptResult.cancelled) {
        throw new Error("write token required");
      }
      if (!normalized) {
        if (!state.defaultWriteApiToken) {
          throw new Error("write token required");
        }
        token = state.defaultWriteApiToken;
      } else {
        if (!isSafeHeaderToken(normalized)) {
          throw new Error("쓰기 API 토큰에는 줄바꿈이나 특수 제어문자를 사용할 수 없습니다.");
        }
        token = normalized;
      }
      setWriteToken(token);
      response = await request(token);
    }
    if (!response.ok) {
      throw new Error(`${url} 요청 실패 (${response.status})`);
    }
    return response.json();
  }

  function showToast(message, variant) {
    if (!el.toastContainer) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    Array.from(el.toastContainer.children).forEach(function (item) {
      item.remove();
    });
    const toast = document.createElement("div");
    toast.className = `toast-item ${variant || ""}`;
    toast.textContent = String(message || "");
    el.toastContainer.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add("visible");
    });
    toastTimer = setTimeout(function () {
      toast.classList.remove("visible");
      setTimeout(function () {
        toast.remove();
      }, 220);
      toastTimer = null;
    }, 3200);
  }

  function nextWorkflowStepId() {
    workflowStepSerial += 1;
    return `wf-step-${workflowStepSerial}`;
  }

  function renderThemeChrome() {
    const theme = getCurrentTheme();
    el.body.setAttribute("data-theme", theme.bodyTheme);
    if (el.themeSwitcher && el.themeSwitcher.value !== state.theme) {
      el.themeSwitcher.value = state.theme;
    }
    if (el.themeQuickButtons && el.themeQuickButtons.length > 0) {
      el.themeQuickButtons.forEach(function (button) {
        const active = button.getAttribute("data-theme-value") === state.theme;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    if (el.viewportTitle) {
      el.viewportTitle.textContent = theme.titles[state.tab] || theme.titles.org;
    }
    document.title = `Custom Codex Agent · ${theme.label}`;
  }

  function renderTabs() {
    const map = {
      org: el.orgView,
      dashboard: el.dashboardView,
      console: el.consoleView,
      workflow: el.workflowView,
      inspector: el.inspectorView,
    };
    Object.entries(map).forEach(function ([key, view]) {
      if (!view) return;
      view.classList.toggle("active-view", key === state.tab);
      view.classList.toggle("hidden", key !== state.tab);
    });
    const buttons = {
      org: el.tabOrg,
      dashboard: el.tabDashboard,
      console: el.tabConsole,
      workflow: el.tabWorkflow,
      inspector: el.tabInspector,
    };
    Object.entries(buttons).forEach(function ([key, button]) {
      if (!button) return;
      button.classList.toggle("active", key === state.tab);
    });
  }

  function renderChrome() {
    renderThemeChrome();
    renderTabs();
    if (el.liveState) {
      el.liveState.textContent = state.liveText;
    }
    if (el.errorBanner) {
      el.errorBanner.classList.toggle("hidden", !state.hasError);
      el.errorBanner.textContent = state.hasError ? (state.errorMessage || "API 연결에 실패했습니다. 서버 상태를 확인하세요.") : "";
    }
  }

  function openDrawerHtml(config) {
    state.drawer = {
      open: true,
      kicker: config.kicker || "UNIT_PROFILE",
      title: config.title || "Target",
      subtitle: config.subtitle || "",
      bodyHtml: config.bodyHtml || "",
    };
    renderDrawer();
  }

  function closeDrawer() {
    state.drawer.open = false;
    renderDrawer();
  }

  function renderDrawer() {
    if (!el.drawer || !el.drawerBody) return;
    el.drawer.classList.toggle("open", !!state.drawer.open);
    el.drawer.setAttribute("aria-hidden", state.drawer.open ? "false" : "true");
    if (el.drawerBackdrop) {
      el.drawerBackdrop.classList.toggle("hidden", !state.drawer.open);
    }
    if (el.drawerKicker) el.drawerKicker.textContent = state.drawer.kicker || "UNIT_PROFILE";
    if (el.drawerTitle) el.drawerTitle.textContent = state.drawer.title || "Target";
    if (el.drawerSubtitle) el.drawerSubtitle.textContent = state.drawer.subtitle || "";
    el.drawerBody.innerHTML = state.drawer.bodyHtml || "";
  }

  function renderOverviewHud() {
    if (!el.orgHudGrid) return;
    if (el.orgHudPanel) {
      el.orgHudPanel.classList.toggle("hidden", !state.orgHudExpanded);
    }
    if (el.orgHudToggleBtn) {
      el.orgHudToggleBtn.textContent = state.orgHudExpanded ? "지표 숨기기" : "지표 보기";
      el.orgHudToggleBtn.setAttribute("aria-expanded", state.orgHudExpanded ? "true" : "false");
    }
    const overview = state.overview;
    if (!overview) {
      el.orgHudGrid.innerHTML = "";
      return;
    }
    const overviewItems = [
      ["TOTAL_SKILLS", overview.total_skills],
      ["TOTAL_AGENTS", overview.total_agents],
      ["ACTIVE_THREADS", overview.active_threads],
      ["ACTIVE_AGENTS", overview.active_agents],
    ];
    const dept = ((state.dashboard && state.dashboard.department_breakdown) || []).slice(0, 6);
    const statuses = ((state.dashboard && state.dashboard.status_breakdown) || []).slice(0, 6);
    const hudItems = overviewItems
      .concat(dept.map(function (metric) { return [metric.label, metric.value]; }))
      .concat(statuses.map(function (metric) { return [metric.label, metric.value]; }));

    el.orgHudGrid.innerHTML = hudItems
      .map(function (item) {
        return `<button class="hud-card" type="button" data-hud-title="${escapeHtml(item[0])}" data-hud-value="${escapeHtml(String(item[1]))}"><div class="hud-card-label">${escapeHtml(item[0])}</div><div class="hud-card-value">${escapeHtml(String(item[1]))}</div></button>`;
      })
      .join("");
  }

  function computeGraphLayout(graph, nodeWidth, nodeHeight, gapX, gapY, padX, padY) {
    const nodesById = new Map();
    const childrenByParent = new Map();
    const childSet = new Set();
    (graph.nodes || []).forEach(function (node) {
      nodesById.set(node.id, node);
      if (!childrenByParent.has(node.id)) childrenByParent.set(node.id, []);
    });
    (graph.edges || []).forEach(function (edge) {
      if (!childrenByParent.has(edge.source)) childrenByParent.set(edge.source, []);
      childrenByParent.get(edge.source).push(edge.target);
      childSet.add(edge.target);
    });
    const roots = Array.from(nodesById.keys()).filter(function (id) {
      return !childSet.has(id);
    });
    const depthById = new Map();
    function visit(nodeId, depth, ancestry) {
      if (!nodesById.has(nodeId) || ancestry.has(nodeId)) return;
      const currentDepth = depthById.get(nodeId);
      if (!Number.isInteger(currentDepth) || depth < currentDepth) {
        depthById.set(nodeId, depth);
      }
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(nodeId);
      (childrenByParent.get(nodeId) || []).forEach(function (childId) {
        visit(childId, depth + 1, nextAncestry);
      });
    }
    (roots.length > 0 ? roots : Array.from(nodesById.keys())).forEach(function (id) {
      visit(id, 0, new Set());
    });
    nodesById.forEach(function (_node, id) {
      if (!depthById.has(id)) depthById.set(id, 0);
    });
    const levels = [];
    Array.from(depthById.entries()).forEach(function ([id, depth]) {
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(id);
    });
    const sceneWidth = Math.max(1100, Math.max(1, ...levels.map(function (row) { return row ? row.length : 0; })) * (nodeWidth + gapX));
    const sceneHeight = Math.max(640, levels.length * (nodeHeight + gapY) + padY * 2);
    const positions = new Map();
    levels.forEach(function (row, depth) {
      if (!row || row.length === 0) return;
      const rowWidth = row.length * nodeWidth + Math.max(0, row.length - 1) * gapX;
      const startX = Math.max(padX, (sceneWidth - rowWidth) / 2);
      const top = padY + depth * (nodeHeight + gapY);
      row.forEach(function (id, index) {
        const left = startX + index * (nodeWidth + gapX);
        positions.set(id, {
          left: left,
          top: top,
          centerX: left + nodeWidth / 2,
          centerY: top + nodeHeight / 2,
          bottomY: top + nodeHeight,
        });
      });
    });
    return { nodesById: nodesById, positions: positions, sceneWidth: sceneWidth, sceneHeight: sceneHeight, roots: roots };
  }

  function buildOrgDrawer(node) {
    const agentName = (node.sublabel || "").trim() || (node.label || "").trim();
    const runnableAgent = node.type === "agent"
      ? (state.executableAgents || []).find(function (agent) {
          return agent.name === agentName;
        })
      : null;
    const metaEntries = Object.entries(node.metadata || {});
    const body = `
      <section class="drawer-section">
        <div class="section-kicker">STATUS</div>
        <div class="drawer-list">
          <div>${escapeHtml(node.status || "healthy")}</div>
        </div>
      </section>
      <section class="drawer-section">
        <div class="section-kicker">METADATA</div>
        <ul class="drawer-list">
          ${metaEntries.length > 0 ? metaEntries.map(function (entry) { return `<li><strong>${escapeHtml(entry[0])}</strong><div class="drawer-subtitle">${escapeHtml(entry[1])}</div></li>`; }).join("") : "<li>추가 메타데이터 없음</li>"}
        </ul>
      </section>
      ${
        runnableAgent
          ? `<section class="drawer-section">
               <div class="section-kicker">EXECUTION</div>
               <div class="inline-row">
                 <button class="action-btn" type="button" data-drawer-run-agent="${escapeHtml(runnableAgent.name)}">실행 콘솔 열기</button>
                 <button class="action-btn action-btn-primary" type="button" data-drawer-run-once="${escapeHtml(runnableAgent.name)}">원클릭 실행</button>
               </div>
             </section>`
          : ""
      }
    `;
    openDrawerHtml({
      kicker: (node.type || "NODE").toUpperCase(),
      title: node.label || node.id,
      subtitle: node.sublabel || "",
      bodyHtml: body,
    });
  }

  function buildOrgHierarchy(graph) {
    const nodesById = new Map();
    const childrenByParent = new Map();
    const childSet = new Set();

    (graph.nodes || []).forEach(function (node) {
      nodesById.set(node.id, node);
      if (!childrenByParent.has(node.id)) childrenByParent.set(node.id, []);
    });

    (graph.edges || []).forEach(function (edge) {
      if (!childrenByParent.has(edge.source)) childrenByParent.set(edge.source, []);
      childrenByParent.get(edge.source).push(edge.target);
      childSet.add(edge.target);
    });

    const roots = Array.from(nodesById.values()).filter(function (node) {
      return !childSet.has(node.id);
    });
    const founder = roots[0] || graph.nodes[0] || null;
    const departments = founder
      ? (childrenByParent.get(founder.id) || [])
          .map(function (id) { return nodesById.get(id); })
          .filter(Boolean)
          .sort(function (left, right) {
            if (left.id === "dept:staff") return -1;
            if (right.id === "dept:staff") return 1;
            return String(left.label || left.id).localeCompare(String(right.label || right.id), "ko");
          })
      : [];

    return {
      founder: founder,
      departments: departments,
      nodesById: nodesById,
      childrenByParent: childrenByParent,
    };
  }

  function renderOrg() {
    renderOverviewHud();
    if (!el.orgTree) return;
    const graph = state.org;
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      el.orgTree.innerHTML = `<div class="stage-card" style="padding:24px;">조직도 데이터가 없습니다.</div>`;
      return;
    }
    const hierarchy = buildOrgHierarchy(graph);
    const founder = hierarchy.founder;
    const departments = hierarchy.departments;

    if (!founder) {
      el.orgTree.innerHTML = `<div class="stage-card" style="padding:24px;">조직도 루트 노드를 찾을 수 없습니다.</div>`;
      return;
    }

    const departmentCards = departments
      .map(function (department) {
        const members = (hierarchy.childrenByParent.get(department.id) || [])
          .map(function (id) { return hierarchy.nodesById.get(id); })
          .filter(Boolean)
          .sort(function (left, right) {
            return String(left.label || left.id).localeCompare(String(right.label || right.id), "ko");
          });
        const accent = getDepartmentAccent(department.id);
        const memberMarkup = members.length > 0
          ? members
              .map(function (member) {
                return `
                  <button
                    class="org-member-card"
                    type="button"
                    data-org-node-id="${escapeHtml(member.id)}"
                  >
                    <div class="org-member-main">
                      <span class="org-member-role">${escapeHtml(member.label || member.id)}</span>
                      <span class="org-member-name">${escapeHtml(member.sublabel || "")}</span>
                    </div>
                    <span class="org-member-status">${escapeHtml(member.status || "healthy")}</span>
                  </button>
                `;
              })
              .join("")
          : `<div class="org-member-empty">배정된 에이전트가 없습니다.</div>`;

        return `
          <article class="stage-card org-branch-card" style="${getOrgAccentStyle(accent, false)}">
            <button
              class="org-branch-head"
              type="button"
              data-org-node-id="${escapeHtml(department.id)}"
            >
              <div class="org-branch-kicker">DEPARTMENT</div>
              <div class="org-branch-title">${escapeHtml(department.label || department.id)}</div>
              <div class="org-branch-subtitle">${escapeHtml(department.sublabel || "에이전트 운영 조직")}</div>
              <div class="org-branch-meta">${members.length}개 에이전트</div>
            </button>
            <div class="org-member-list">${memberMarkup}</div>
          </article>
        `;
      })
      .join("");

    el.orgTree.innerHTML = `
      <div class="org-hierarchy">
        <button class="stage-card org-founder-card" type="button" data-org-node-id="${escapeHtml(founder.id)}" style="${getOrgAccentStyle({ solid: "", soft: "", glow: "" }, true)}">
          <div class="org-founder-kicker">TOP LEVEL</div>
          <div class="org-founder-title">${escapeHtml(founder.label || founder.id)}</div>
          <div class="org-founder-name">${escapeHtml(founder.sublabel || "")}</div>
          <div class="org-founder-meta">${departments.length}개 부서와 연결됨</div>
        </button>
        <div class="org-founder-connector" aria-hidden="true">
          <span></span>
        </div>
        <div class="org-branch-grid">${departmentCards}</div>
      </div>
    `;
  }

  function openDrawerForHud(title, value) {
    openDrawerHtml({
      kicker: "LIVE_METRIC",
      title: title,
      subtitle: `Current value: ${value}`,
      bodyHtml: `<section class="drawer-section"><div class="section-kicker">METRIC_VALUE</div><div class="dashboard-value">${escapeHtml(value)}</div></section>`,
    });
  }

  function renderDashboardMetrics() {
    if (!el.dashboardMetrics) return;
    const metrics = (state.dashboard && state.dashboard.metrics) || [];
    if (metrics.length === 0) {
      el.dashboardMetrics.innerHTML = `<div class="dashboard-feed-card span-all">데이터 없음</div>`;
      return;
    }
    el.dashboardMetrics.innerHTML = metrics
      .map(function (metric, index) {
        const trendValues = Array.isArray(metric.trend_values) ? metric.trend_values.map(function (value) { return Number(value || 0); }) : [];
        const hasTrend = trendValues.length > 0 && trendValues.some(function (value) { return value > 0; });
        const maxTrend = hasTrend ? Math.max.apply(null, trendValues) : 0;
        const bars = hasTrend
          ? trendValues
            .map(function (value) {
              const normalized = maxTrend > 0 ? Math.max(14, Math.round((value / maxTrend) * 100)) : 14;
              return `<span style="height:${normalized}%"></span>`;
            })
            .join("")
          : "";
        const trendMarkup = hasTrend
          ? `<div class="dashboard-chart" aria-label="최근 7일 12개 구간 추세">${bars}</div>`
          : `<div class="dashboard-chart-placeholder">최근 7일 추세 데이터 없음</div>`;
        const cardClass = hasTrend ? "dashboard-card" : "dashboard-card dashboard-card-static";
        return `
          <button class="${cardClass}" type="button" data-dashboard-metric="${escapeHtml(metric.key)}">
            <div class="section-kicker">${escapeHtml(metric.key)}</div>
            <div class="dashboard-value">${escapeHtml(String(metric.value))}</div>
            <div class="dashboard-label">${escapeHtml(metric.label)}</div>
            ${trendMarkup}
          </button>
        `;
      })
      .join("");
  }

  function renderFeedList(container, items, kind) {
    if (!container) return;
    const list = items || [];
    if (list.length === 0) {
      container.innerHTML = `<li class="feed-item">데이터 없음</li>`;
      return;
    }
    container.innerHTML = list
      .map(function (item, index) {
        return `<li class="feed-item" data-feed-kind="${escapeHtml(kind)}" data-feed-index="${index}"><div class="feed-title">${escapeHtml(item.title || "-")}</div><div class="node-meta">${escapeHtml(item.subtitle || "")}</div><div class="feed-time">${escapeHtml(fmtDate(item.timestamp))}</div></li>`;
      })
      .join("");
  }

  function renderDashboard() {
    renderDashboardMetrics();
    const dashboard = state.dashboard || {};
    renderFeedList(el.timelineList, dashboard.timeline || [], "timeline");
    renderFeedList(el.activeAgents, dashboard.active_agents || [], "active_agents");
    renderFeedList(el.recentSkills, dashboard.recent_skills || [], "recent_skills");
    renderFeedList(el.recentThreads, dashboard.recent_threads || [], "recent_threads");
  }

  function renderRunAgentOptions() {
    if (!el.runAgentSelect) return;
    const agents = (state.executableAgents || []).filter(function (agent) { return agent.runnable; });
    if (!state.selectedAgentName && agents[0]) {
      state.selectedAgentName = agents[0].name;
    }
    el.runAgentSelect.innerHTML = agents
      .map(function (agent) {
        const selected = state.selectedAgentName === agent.name ? "selected" : "";
        return `<option value="${escapeHtml(agent.name)}" ${selected}>${escapeHtml(agent.department_label_ko)} / ${escapeHtml(agent.role_label_ko)} (${escapeHtml(agent.name)})</option>`;
      })
      .join("");
  }

  async function loadRunEvents(runId) {
    if (!runId) return;
    const data = await fetchJson(`/api/runs/${encodeURIComponent(runId)}/events?limit=800`);
    state.runEvents.set(runId, data.events || []);
  }

  async function loadRunDetail(runId) {
    if (!runId) return null;
    const detail = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
    state.runDetails.set(runId, detail);
    return detail;
  }

  function renderRunList() {
    if (!el.runList) return;
    const runs = state.runs || [];
    if (!state.selectedRunId && runs[0]) {
      state.selectedRunId = runs[0].run_id;
    }
    el.runList.innerHTML = runs
      .map(function (run) {
        const active = state.selectedRunId === run.run_id ? "active" : "";
        return `
          <button class="run-chip ${active}" type="button" data-run-id="${escapeHtml(run.run_id)}">
            <div class="feed-title">${escapeHtml(run.agent_name)} <span style="font-size: 0.75em; opacity: 0.7;">[${escapeHtml(run.engine || "codex")}]</span></div>
            <div class="run-chip-meta">${escapeHtml(run.status)} · ${escapeHtml(fmtDate(run.created_at))}</div>
            <div class="run-chip-meta">${escapeHtml(run.prompt_preview || "")}</div>
          </button>
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
    const run = state.runs.find(function (item) { return item.run_id === state.selectedRunId; });
    const events = state.runEvents.get(state.selectedRunId) || [];
    el.runMeta.textContent = run ? `${run.agent_name} · ${run.status} · ${run.workspace_root || ""}` : state.selectedRunId;
    el.runLog.textContent = events.length > 0 ? events.map(function (event) {
      return `[${fmtDate(event.created_at)}] ${event.event_type} ${event.message}`;
    }).join("\n") : "> Awaiting Mission Input...";
    el.runLog.scrollTop = el.runLog.scrollHeight;
  }

  function renderOptions(selectEl, items, selectedValue) {
    if (!selectEl) return;
    selectEl.innerHTML = (items || [])
      .map(function (item) {
        const selected = item.value === selectedValue ? "selected" : "";
        return `<option value="${escapeHtml(item.value)}" ${selected}>${escapeHtml(item.label)}</option>`;
      })
      .join("");
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
    renderRunList();
    renderRunLog();
  }

  function renderWorkflowOptions() {
    const config = state.workflowUiConfig || {};
    renderOptions(el.workflowSandboxSelect, config.sandbox_modes || [], state.selectedWorkflowSandboxMode);
    renderOptions(el.workflowApprovalSelect, config.approval_policies || [], state.selectedWorkflowApprovalPolicy);
  }

  function filterWorkflowAgents(query) {
    const normalized = String(query || "").trim().toLowerCase();
    return (state.executableAgents || []).filter(function (agent) {
      if (!agent.runnable) return false;
      if (!normalized) return true;
      return [agent.name, agent.role_label_ko, agent.department_label_ko, agent.short_description]
        .some(function (value) { return String(value || "").toLowerCase().includes(normalized); });
    });
  }

  function renderWorkflowAgentOptions() {
    if (!el.workflowAgentSelect) return;
    const agents = filterWorkflowAgents(state.workflowAgentFilter);
    if (!state.selectedWorkflowAgentName && agents[0]) {
      state.selectedWorkflowAgentName = agents[0].name;
    }
    el.workflowAgentSelect.innerHTML = agents
      .map(function (agent) {
        const selected = state.selectedWorkflowAgentName === agent.name ? "selected" : "";
        return `<option value="${escapeHtml(agent.name)}" ${selected}>${escapeHtml(agent.department_label_ko)} / ${escapeHtml(agent.role_label_ko)} (${escapeHtml(agent.name)})</option>`;
      })
      .join("");
  }

  function buildDefaultStepFromAgent(agent, sourceType = "manual") {
    return {
      id: nextWorkflowStepId(),
      agentName: agent.name,
      roleLabel: agent.role_label_ko,
      departmentLabel: agent.department_label_ko,
      skillName: "",
      iconKey: "bot",
      prompt: `전체 목표를 고려해 ${agent.role_label_ko} 관점에서 필요한 작업만 수행하고 다음 단계에 전달할 핵심 결과를 정리해줘.`,
      status: "ready",
      summary: agent.short_description || "",
      runId: "",
      sourceType: sourceType,
    };
  }

  function buildRecommendedWorkflowStep(item) {
    return {
      id: nextWorkflowStepId(),
      agentName: item.agent_name,
      roleLabel: item.role_label_ko,
      departmentLabel: item.department_label_ko,
      skillName: item.skill_name || "",
      iconKey: item.icon_key || "bot",
      prompt: item.default_prompt || "",
      status: "ready",
      summary: item.reason || item.short_description || "",
      runId: "",
      sourceType: "recommended",
    };
  }

  function getDefaultWorkflowNodePosition(index) {
    return {
      left: 120 + index * 260,
      top: 120 + (index % 2 === 0 ? 0 : 160),
    };
  }

  function layoutWorkflowNodes(preserveExisting = false) {
    const positions = {};
    (state.workflowDraft.steps || []).forEach(function (step, index) {
      positions[step.id] = preserveExisting && state.workflowNodePositions[step.id]
        ? state.workflowNodePositions[step.id]
        : getDefaultWorkflowNodePosition(index);
    });
    state.workflowNodePositions = positions;
  }

  function removeWorkflowStep(index) {
    if (!Number.isInteger(index) || index < 0) return;
    const removed = state.workflowDraft.steps.splice(index, 1);
    if (removed[0]) {
      delete state.workflowNodePositions[removed[0].id];
    }
    layoutWorkflowNodes(true);
    renderWorkflow();
  }

  function reorderWorkflowStepsFromCanvas() {
    const steps = (state.workflowDraft.steps || []).slice();
    if (steps.length < 2) {
      layoutWorkflowNodes(true);
      return false;
    }
    const reordered = steps.slice().sort(function (leftStep, rightStep) {
      const leftPos = state.workflowNodePositions[leftStep.id] || { left: 0, top: 0 };
      const rightPos = state.workflowNodePositions[rightStep.id] || { left: 0, top: 0 };
      if (Math.abs(leftPos.left - rightPos.left) > WORKFLOW_ORDER_SNAP_PX) {
        return leftPos.left - rightPos.left;
      }
      return leftPos.top - rightPos.top;
    });
    const changed = reordered.some(function (step, index) {
      return step.id !== steps[index].id;
    });
    state.workflowDraft.steps = reordered;
    layoutWorkflowNodes(true);
    return changed;
  }

  function scheduleWorkflowSceneRender() {
    if (workflowSceneRenderQueued) return;
    workflowSceneRenderQueued = true;
    window.requestAnimationFrame(function () {
      workflowSceneRenderQueued = false;
      renderWorkflowScene();
    });
  }

  function renderWorkflowRecommendations() {
    const items = state.workflowRecommendations || [];
    if (el.workflowRecommendationMeta) {
      el.workflowRecommendationMeta.textContent = items.length > 0 ? `${items.length}개 추천 노드 반영됨` : "추천 결과 없음";
    }
  }

  function applyWorkflowRecommendations(items) {
    const manualSteps = (state.workflowDraft.steps || []).filter(function (step) {
      return step.sourceType !== "recommended";
    });
    const recommendedSteps = (items || []).map(buildRecommendedWorkflowStep);
    state.workflowDraft.steps = manualSteps.concat(recommendedSteps);
    layoutWorkflowNodes(true);
  }

  function normalizeWorkflowPositions() {
    const steps = state.workflowDraft.steps || [];
    const positions = {};
    steps.forEach(function (step, index) {
      positions[step.id] = state.workflowNodePositions[step.id] || getDefaultWorkflowNodePosition(index);
    });
    state.workflowNodePositions = positions;
  }

  function getSelectedWorkflowDetail() {
    return state.selectedWorkflowRunId ? (state.workflowRunDetails.get(state.selectedWorkflowRunId) || null) : null;
  }

  function getWorkflowConversationSteps() {
    const detail = getSelectedWorkflowDetail();
    if (detail && Array.isArray(detail.steps) && detail.steps.length > 0) {
      return detail.steps.map(function (step) {
        return {
          stepIndex: step.step_index,
          title: step.title || `STEP ${String((step.step_index || 0) + 1).padStart(2, "0")}`,
          agentName: step.agent_name || "",
          status: step.status || "ready",
          summary: step.summary || step.last_event_message || "",
          prompt: step.prompt || "",
          source: "runtime",
        };
      });
    }
    return (state.workflowDraft.steps || []).map(function (step, index) {
      return {
        stepIndex: index,
        title: `STEP ${String(index + 1).padStart(2, "0")}`,
        agentName: step.agentName || "",
        status: step.status || "ready",
        summary: step.summary || "",
        prompt: step.prompt || "",
        source: "draft",
      };
    });
  }

  function normalizeWorkflowConversationStepIndex(steps) {
    if (!Array.isArray(steps) || steps.length === 0) {
      state.workflowConversationStepIndex = 0;
      return;
    }
    const hasCurrent = steps.some(function (step) { return step.stepIndex === state.workflowConversationStepIndex; });
    if (hasCurrent) return;
    const detail = getSelectedWorkflowDetail();
    if (detail && Number.isInteger(detail.current_step_index) && steps.some(function (step) { return step.stepIndex === detail.current_step_index; })) {
      state.workflowConversationStepIndex = detail.current_step_index;
      return;
    }
    state.workflowConversationStepIndex = steps[0].stepIndex;
  }

  function getWorkflowRuntimeStep(step, index) {
    const detail = getSelectedWorkflowDetail();
    const runtimeSteps = detail && detail.steps ? detail.steps : [];
    const runtimeStep = runtimeSteps[index];
    if (!runtimeStep) return null;
    if (runtimeStep.agent_name && step.agentName && runtimeStep.agent_name !== step.agentName) {
      const matched = runtimeSteps.find(function (item) {
        return item.step_index === index && item.agent_name === step.agentName;
      });
      return matched || null;
    }
    return runtimeStep;
  }

  function renderWorkflowScene() {
    if (!el.workflowStepList) return;
    normalizeWorkflowPositions();
    const steps = state.workflowDraft.steps || [];
    const sceneWidth = Math.max(1200, steps.length * 280 + 240);
    const sceneHeight = Math.max(540, steps.length > 0 ? 480 : 520);
    const wires = steps
      .slice(0, -1)
      .map(function (step, index) {
        const nextStep = steps[index + 1];
        const from = state.workflowNodePositions[step.id];
        const to = state.workflowNodePositions[nextStep.id];
        if (!from || !to) return "";
        const x1 = from.left + 190;
        const y1 = from.top + 42;
        const x2 = to.left;
        const y2 = to.top + 42;
        const mid = (x1 + x2) / 2;
        return `<path class="workflow-wire active" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" />`;
      })
      .join("");
    const nodes = steps
      .map(function (step, index) {
        const pos = state.workflowNodePositions[step.id] || { left: 120 + index * 260, top: 120 };
        const runtimeStep = getWorkflowRuntimeStep(step, index);
        const runtimeStatus = runtimeStep && runtimeStep.status ? runtimeStep.status : "";
        const displayStatus = runtimeStatus || step.status || "ready";
        const displaySummary = (runtimeStep && (runtimeStep.summary || runtimeStep.last_event_message)) || step.summary || step.skillName || step.prompt || "";
        const activeClass = runtimeStatus === "running" ? " flow-node-active" : "";
        const queuedClass = runtimeStatus === "queued" ? " flow-node-queued" : "";
        const sourceLabel = step.sourceType === "recommended" ? "추천" : "수동";
        return `
          <article class="flow-node${activeClass}${queuedClass}" style="left:${pos.left}px;top:${pos.top}px;" data-workflow-step-index="${index}" data-workflow-step-id="${escapeHtml(step.id)}" data-workflow-step-status="${escapeHtml(displayStatus)}" aria-busy="${runtimeStatus === "running" ? "true" : "false"}">
            <div class="flow-node-head">
              <div class="node-icon">${escapeHtml(step.iconKey && step.iconKey[0] ? step.iconKey[0].toUpperCase() : "●")}</div>
              <div class="flow-node-title">${escapeHtml(step.agentName)}</div>
              <button class="node-delete" type="button" data-remove-workflow-step="${index}" aria-label="${escapeHtml(step.agentName)} remove">✕</button>
            </div>
            <div class="node-meta">${escapeHtml(step.departmentLabel || "")}</div>
            <div class="node-meta">${escapeHtml(displaySummary)}</div>
            <div class="node-actions"><span class="mini-btn">${escapeHtml(sourceLabel)}</span><span class="mini-btn">STEP ${String(index + 1).padStart(2, "0")}</span><span class="mini-btn workflow-step-status workflow-step-status-${escapeHtml(displayStatus)}">${escapeHtml(displayStatus)}</span></div>
          </article>
        `;
      })
      .join("");
    el.workflowStepList.innerHTML = `
      <div class="workflow-scene" style="--scene-width:${sceneWidth}px;--scene-height:${sceneHeight}px;">
        <svg class="workflow-wires" viewBox="0 0 ${sceneWidth} ${sceneHeight}" preserveAspectRatio="xMidYMin meet">${wires}</svg>
        <div class="workflow-layer">${nodes}</div>
      </div>
    `;
  }

  async function loadWorkflowRunDetail(workflowRunId) {
    if (!workflowRunId) return null;
    const detail = await fetchJson(`/api/workflow-runs/${encodeURIComponent(workflowRunId)}`);
    state.workflowRunDetails.set(workflowRunId, detail);
    return detail;
  }

  async function loadWorkflowEvents(workflowRunId) {
    if (!workflowRunId) return;
    const data = await fetchJson(`/api/workflow-runs/${encodeURIComponent(workflowRunId)}/events?limit=1200`);
    state.workflowEvents.set(workflowRunId, data.events || []);
  }

  async function loadWorkflowExecutionLogs(workflowRunId) {
    if (!workflowRunId) return;
    const detail = await loadWorkflowRunDetail(workflowRunId);
    await loadWorkflowEvents(workflowRunId);
    const runIds = (detail && detail.steps ? detail.steps : [])
      .map(function (step) { return step.run_id || ""; })
      .filter(Boolean);
    if (runIds.length > 0) {
      await Promise.all(runIds.map(function (runId) { return loadRunEvents(runId); }));
    }
  }

  function toEpochMs(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseJsonLine(text) {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  }

  function isCodexNoiseLine(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return true;
    if (/^\d[\d,]*$/.test(trimmed)) return true;
    if (/^tokens used$/i.test(trimmed)) return true;
    if (/^\d{4}-\d{2}-\d{2}T.*\b(WARN|INFO|ERROR|DEBUG)\b/.test(trimmed)) return true;
    const parsed = parseJsonLine(trimmed);
    return Boolean(parsed && (parsed.kind === "shape" || parsed.kind === "textbox"));
  }

  function toCodexSignal(event) {
    if (!event || event.source !== "run") return null;
    const eventType = String(event.event_type || "");
    const message = String(event.message || "").trim();
    if (!message || isCodexNoiseLine(message)) return null;
    if (eventType === "run:stdout") {
      return { kind: "answer", label: "Answer", event: event, message: message };
    }
    if (eventType === "run:stderr") {
      return { kind: "reasoning", label: "Reasoning", event: event, message: message };
    }
    return null;
  }

  function buildCodexTranscript(signals) {
    const groups = [];
    let current = null;
    signals.forEach(function (signal) {
      const event = signal.event;
      const stepIndex = Number.isInteger(event.step_index) ? event.step_index : -1;
      const agentName = event.agent_name || "Codex";
      const key = `${stepIndex}:${agentName}`;
      if (!current || current.key !== key) {
        current = {
          key: key,
          step_index: event.step_index,
          agent_name: agentName,
          created_at: event.created_at,
          reasoning: [],
          answers: [],
        };
        groups.push(current);
      }
      current.created_at = event.created_at || current.created_at;
      if (signal.kind === "answer") {
        current.answers.push(signal);
      } else {
        current.reasoning.push(signal);
      }
    });
    return groups;
  }

  function renderCodexTranscript(signals) {
    const groups = buildCodexTranscript(signals);
    if (groups.length === 0) {
      return `<div class="workflow-log-empty">Codex answer 로그가 아직 없습니다. reasoning은 답변이 생기면 접힌 형태로 함께 표시됩니다.</div>`;
    }
    return groups.slice().reverse().map(function (group) {
      const stepLabel = Number.isInteger(group.step_index) ? `STEP ${String(group.step_index + 1).padStart(2, "0")}` : "GLOBAL";
      const reasoningText = group.reasoning.map(function (signal) { return signal.message; }).join("\n\n");
      const answerText = group.answers.map(function (signal) { return signal.message; }).join("\n\n");
      const reasoningBlock = reasoningText
        ? `
          <details class="workflow-codex-reasoning">
            <summary>Reasoning · ${escapeHtml(String(group.reasoning.length))} log${group.reasoning.length === 1 ? "" : "s"}</summary>
            <div class="workflow-codex-reasoning-body">${escapeHtml(reasoningText)}</div>
          </details>
        `
        : "";
      const answerBlock = answerText
        ? `<div class="workflow-codex-answer">${escapeHtml(answerText)}</div>`
        : `<div class="workflow-codex-answer workflow-codex-answer-empty">아직 answer 출력이 없습니다.</div>`;
      return `
        <article class="workflow-log-entry workflow-codex-entry">
          <div class="workflow-log-entry-head">
            <div>
              <div class="workflow-log-entry-type">Answer</div>
              <div class="workflow-log-entry-meta">${escapeHtml(stepLabel)} · ${escapeHtml(group.agent_name)}</div>
            </div>
            <div class="workflow-log-entry-time">${escapeHtml(fmtDate(group.created_at))}</div>
          </div>
          ${reasoningBlock}
          ${answerBlock}
        </article>
      `;
    }).join("");
  }

  function renderWorkflowRunList() {
    if (!el.workflowRunList) return;
    const runs = state.workflowRuns || [];
    if (!state.selectedWorkflowRunId && runs[0]) {
      state.selectedWorkflowRunId = runs[0].workflow_run_id;
    }
    el.workflowRunList.innerHTML = runs
      .map(function (run) {
        const active = state.selectedWorkflowRunId === run.workflow_run_id ? "active" : "";
        return `
          <button class="run-chip ${active}" type="button" data-workflow-run-id="${escapeHtml(run.workflow_run_id)}">
            <div class="feed-title">${escapeHtml(run.status)}</div>
            <div class="run-chip-meta">${escapeHtml(run.goal_prompt_preview || "")}</div>
          </button>
        `;
      })
      .join("");
  }

  function renderWorkflowLog() {
    if (!el.workflowMeta || !el.workflowLog || !el.workflowCodexLogFeed) return;
    if (!state.selectedWorkflowRunId) {
      el.workflowMeta.textContent = "선택된 워크플로 없음";
      el.workflowLog.textContent = "";
      el.workflowCodexLogFeed.innerHTML = `<div class="workflow-log-empty">실행 이력을 선택하면 Codex reasoning과 answer만 여기 표시됩니다.</div>`;
      return;
    }
    const run = state.workflowRuns.find(function (item) { return item.workflow_run_id === state.selectedWorkflowRunId; });
    const workflowEvents = state.workflowEvents.get(state.selectedWorkflowRunId) || [];
    const detail = state.workflowRunDetails.get(state.selectedWorkflowRunId);
    const mergedEvents = workflowEvents
      .map(function (event) {
        return {
          created_at: event.created_at,
          event_type: event.event_type,
          message: event.message,
          step_index: event.step_index,
          agent_name: "",
          source: "workflow",
        };
      });

    (detail && detail.steps ? detail.steps : []).forEach(function (step) {
      const runEvents = step.run_id ? (state.runEvents.get(step.run_id) || []) : [];
      runEvents.forEach(function (event) {
        mergedEvents.push({
          created_at: event.created_at,
          event_type: event.event_type,
          message: event.message,
          step_index: step.step_index,
          agent_name: step.agent_name || "",
          source: "run",
        });
      });
    });

    mergedEvents.sort(function (left, right) {
      return toEpochMs(left.created_at) - toEpochMs(right.created_at);
    });
    el.workflowMeta.textContent = run ? `${run.status} · ${run.goal_prompt_preview}` : state.selectedWorkflowRunId;
    el.workflowLog.textContent = mergedEvents.length > 0 ? mergedEvents.map(function (event) {
      const stepLabel = Number.isInteger(event.step_index) ? ` [step ${event.step_index + 1}]` : "";
      const agentLabel = event.agent_name ? ` [${event.agent_name}]` : "";
      const sourceLabel = event.source === "run" ? " run" : "";
      return `[${fmtDate(event.created_at)}] ${event.event_type}${sourceLabel}${stepLabel}${agentLabel} ${event.message}`;
    }).join("\n") : "> Workflow telemetry idle...";
    const codexSignals = mergedEvents
      .map(toCodexSignal)
      .filter(Boolean);
    el.workflowCodexLogFeed.innerHTML = renderCodexTranscript(codexSignals);
    el.workflowLog.scrollTop = el.workflowLog.scrollHeight;
  }

  function renderWorkflowLogView() {
    const showRaw = state.workflowLogView === "raw";
    if (el.workflowCodexLogFeed) {
      el.workflowCodexLogFeed.classList.toggle("hidden", showRaw);
    }
    if (el.workflowLog) {
      el.workflowLog.classList.toggle("hidden", !showRaw);
    }
    if (el.workflowLogViewCodexBtn) {
      const active = !showRaw;
      el.workflowLogViewCodexBtn.classList.toggle("active", active);
      el.workflowLogViewCodexBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (el.workflowLogViewRawBtn) {
      const active = showRaw;
      el.workflowLogViewRawBtn.classList.toggle("active", active);
      el.workflowLogViewRawBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function renderWorkflowConversation() {
    if (!el.workflowConversationStatus || !el.workflowConversationHint || !el.workflowConversationStepSelect || !el.workflowConversationInput || !el.workflowConversationApplyBtn || !el.workflowConversationRetryBtn) {
      return;
    }
    const steps = getWorkflowConversationSteps();
    normalizeWorkflowConversationStepIndex(steps);
    const selected = steps.find(function (step) { return step.stepIndex === state.workflowConversationStepIndex; }) || null;
    el.workflowConversationStepSelect.innerHTML = steps.length > 0
      ? steps.map(function (step) {
          const selectedAttr = step.stepIndex === state.workflowConversationStepIndex ? "selected" : "";
          return `<option value="${escapeHtml(String(step.stepIndex))}" ${selectedAttr}>${escapeHtml(step.title)} · ${escapeHtml(step.agentName)} · ${escapeHtml(step.status)}</option>`;
        }).join("")
      : `<option value="0">선택 가능한 단계 없음</option>`;
    if (el.workflowConversationInput.value !== state.workflowConversationText) {
      el.workflowConversationInput.value = state.workflowConversationText || "";
    }

    if (!selected) {
      el.workflowConversationStatus.textContent = "실행 중이거나 초안으로 준비된 단계가 아직 없습니다.";
      el.workflowConversationHint.textContent = "먼저 추천 결과를 추가하거나 실행 이력을 선택해 주세요.";
      el.workflowConversationApplyBtn.disabled = true;
      el.workflowConversationRetryBtn.disabled = true;
      return;
    }

    const detail = getSelectedWorkflowDetail();
    const runtimeMode = Boolean(detail && detail.steps && detail.steps.length > 0);
    const statusLabel = selected.status === "approval_required" ? "사용자 답변 필요" : selected.status;
    const draftStep = (state.workflowDraft.steps || [])[selected.stepIndex] || null;
    el.workflowConversationStatus.textContent = runtimeMode
      ? `${selected.title} · ${selected.agentName} · ${statusLabel}`
      : `${selected.title} 초안 편집 모드 · ${selected.agentName}`;
    el.workflowConversationHint.textContent = selected.summary || "질문이 오면 답변을 입력하고, 해당 단계 프롬프트에 반영하거나 다시 실행할 수 있습니다.";
    el.workflowConversationApplyBtn.disabled = !draftStep;
    el.workflowConversationApplyBtn.textContent = draftStep ? "초안 단계에 반영" : "초안 단계 없음";
    el.workflowConversationRetryBtn.disabled = !runtimeMode;
    el.workflowConversationRetryBtn.textContent = runtimeMode ? "선택 단계부터 다시 실행" : "실행 이력 선택 후 가능";
  }

  function renderWorkflow() {
    if (el.workflowGoalInput && el.workflowGoalInput.value !== state.workflowDraft.goalPrompt) {
      el.workflowGoalInput.value = state.workflowDraft.goalPrompt || "";
    }
    if (el.workflowWorkspaceInput && el.workflowWorkspaceInput.value !== state.selectedWorkflowWorkspaceRoot) {
      el.workflowWorkspaceInput.value = state.selectedWorkflowWorkspaceRoot || "";
    }
    renderWorkflowOptions();
    renderWorkflowAgentOptions();
    renderWorkflowRecommendations();
    renderWorkflowScene();
    renderWorkflowRunList();
    renderWorkflowLog();
    renderWorkflowLogView();
    renderWorkflowConversation();
    const hasWorkflowSteps = (state.workflowDraft.steps || []).length > 0;
    const showWorkflowEmptyState = !hasWorkflowSteps && !state.workflowProgressVisible;
    if (el.workflowEmptyState) {
      el.workflowEmptyState.classList.toggle("hidden", !showWorkflowEmptyState);
    }
    if (el.workflowStageDock) {
      el.workflowStageDock.classList.toggle("hidden", !hasWorkflowSteps);
    }
    if (el.workflowRecommendBtn) {
      el.workflowRecommendBtn.disabled = state.workflowProgressVisible || !state.writeApiEnabled;
      el.workflowRecommendBtn.classList.toggle("is-busy", state.workflowProgressVisible);
      el.workflowRecommendBtn.textContent = state.workflowProgressVisible ? "ANALYZING..." : "RECOMMEND";
      el.workflowRecommendBtn.setAttribute("aria-busy", state.workflowProgressVisible ? "true" : "false");
    }
    if (el.workflowRecommendationStatus) {
      el.workflowRecommendationStatus.textContent = state.workflowProgressVisible ? "추천 중" : (state.workflowRecommendations.length > 0 ? `${state.workflowRecommendations.length}개 반영` : "대기 중");
    }
    if (el.workflowStageCount) {
      el.workflowStageCount.textContent = String((state.workflowDraft.steps || []).length);
    }
    if (el.workflowSelectedRunLabel) {
      el.workflowSelectedRunLabel.textContent = state.selectedWorkflowRunId ? state.selectedWorkflowRunId.slice(0, 8) : "없음";
    }
    if (el.workflowProgressHud && el.workflowProgressText) {
      el.workflowProgressHud.classList.toggle("hidden", !state.workflowProgressVisible);
      el.workflowProgressText.textContent = state.workflowProgressText;
    }
  }

  async function loadInspector(agentName) {
    if (!agentName) return null;
    if (state.inspectorCache.has(agentName)) {
      return state.inspectorCache.get(agentName);
    }
    const data = await fetchJson(`/api/agents/${encodeURIComponent(agentName)}/inspector`, `인스펙터 ${agentName}`);
    state.inspectorCache.set(agentName, data);
    return data;
  }

  function getInspectorConfigFile(data) {
    if (!data) return null;
    return data.agent_toml || data.agent_json || null;
  }

  function setEditorValue(editor, value) {
    if (!editor) return;
    const nextValue = value || "";
    if (editor.value !== nextValue) {
      editor.value = nextValue;
    }
  }

  function setSaveButtonState(button, enabled) {
    if (!button) return;
    button.disabled = !enabled || !state.writeApiEnabled;
  }

  function replaceInspectorFileInCache(agentName, file) {
    const data = state.inspectorCache.get(agentName);
    if (!data || !file || !file.path) return;
    const replaceInList = function (files) {
      const index = (files || []).findIndex(function (item) { return item.path === file.path; });
      if (index >= 0) {
        files[index] = file;
        return true;
      }
      return false;
    };
    if (data.skill_markdown && data.skill_markdown.path === file.path) {
      data.skill_markdown = file;
    } else if (data.agent_toml && data.agent_toml.path === file.path) {
      data.agent_toml = file;
    } else if (data.agent_json && data.agent_json.path === file.path) {
      data.agent_json = file;
    } else if (!replaceInList(data.scripts)) {
      replaceInList(data.references);
    }
  }

  function updateInspectorCachedContent(path, content) {
    const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
    if (!data || !path) return;
    const update = function (file) {
      if (file && file.path === path) {
        file.content = content;
        return true;
      }
      return false;
    };
    if (update(data.skill_markdown) || update(data.agent_toml) || update(data.agent_json)) return;
    (data.scripts || []).some(update) || (data.references || []).some(update);
  }

  async function saveInspectorFile(file, editor, label) {
    if (!state.selectedInspectorAgentName || !file || !file.path || !editor) {
      showToast("저장할 파일을 선택하세요.", "error");
      return;
    }
    const content = editor.value || "";
    const result = await postJsonWithAuth(`/api/agents/${encodeURIComponent(state.selectedInspectorAgentName)}/inspector/files`, {
      path: file.path,
      content,
    });
    replaceInspectorFileInCache(state.selectedInspectorAgentName, result.file);
    renderInspector();
    showToast(`${label} 저장 완료`, "success");
  }

  function renderInspector() {
    if (!el.inspectorAgentList) return;
    el.inspectorAgentList.innerHTML = (state.executableAgents || [])
      .map(function (agent) {
        const active = state.selectedInspectorAgentName === agent.name ? "active" : "";
        const accentStyle = getDepartmentAccentStyle(agent.department_label_ko);
        return `
          <button
            class="agent-directory-card ${active}"
            type="button"
            data-inspector-agent="${escapeHtml(agent.name)}"
            style="${accentStyle}"
          >
            <div class="feed-title">${escapeHtml(agent.name)}</div>
            <div class="run-chip-meta">${escapeHtml(agent.department_label_ko)} / ${escapeHtml(agent.role_label_ko)}</div>
            <div class="run-chip-meta">${escapeHtml(agent.short_description || "")}</div>
          </button>
        `;
      })
      .join("");

    const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
    if (!data) {
      if (el.inspectorAgentName) el.inspectorAgentName.textContent = "-";
      if (el.inspectorSummary) el.inspectorSummary.textContent = "에이전트를 선택하면 연결된 스킬과 파일 내용을 확인합니다.";
      if (el.inspectorAgentRole) el.inspectorAgentRole.textContent = "-";
      if (el.inspectorSkillName) el.inspectorSkillName.textContent = "-";
      if (el.inspectorSkillPath) el.inspectorSkillPath.textContent = "";
      setEditorValue(el.inspectorSkillContent, "");
      setSaveButtonState(el.inspectorSkillSaveBtn, false);
      if (el.inspectorAgentTomlPath) el.inspectorAgentTomlPath.textContent = "";
      setEditorValue(el.inspectorAgentTomlContent, "");
      setSaveButtonState(el.inspectorAgentConfigSaveBtn, false);
      if (el.inspectorScriptsList) el.inspectorScriptsList.innerHTML = "";
      setEditorValue(el.inspectorScriptContent, "");
      setSaveButtonState(el.inspectorScriptSaveBtn, false);
      if (el.inspectorReferencesList) el.inspectorReferencesList.innerHTML = "";
      setEditorValue(el.inspectorReferenceContent, "");
      setSaveButtonState(el.inspectorReferenceSaveBtn, false);
      return;
    }

    if (el.inspectorAgentName) el.inspectorAgentName.textContent = data.agent_name || "-";
    if (el.inspectorSummary) el.inspectorSummary.textContent = data.description || data.short_description || "";
    if (el.inspectorAgentRole) el.inspectorAgentRole.textContent = `${data.department_label_ko || "-"} / ${data.role_label_ko || "-"}`;
    if (el.inspectorSkillName) el.inspectorSkillName.textContent = data.skill_name || "-";
    if (el.inspectorSkillPath) el.inspectorSkillPath.textContent = data.skill_markdown && data.skill_markdown.path ? data.skill_markdown.path : "";
    setEditorValue(el.inspectorSkillContent, data.skill_markdown && data.skill_markdown.content ? data.skill_markdown.content : "");
    setSaveButtonState(el.inspectorSkillSaveBtn, Boolean(data.skill_markdown && data.skill_markdown.path));
    const configFile = getInspectorConfigFile(data);
    if (el.inspectorAgentTomlPath) el.inspectorAgentTomlPath.textContent = configFile && configFile.path ? configFile.path : "";
    setEditorValue(el.inspectorAgentTomlContent, configFile && configFile.content ? configFile.content : "");
    setSaveButtonState(el.inspectorAgentConfigSaveBtn, Boolean(configFile && configFile.path));

    const scripts = data.scripts || [];
    if ((!state.selectedInspectorScriptPath || !scripts.some(function (file) { return file.path === state.selectedInspectorScriptPath; })) && scripts[0]) {
      state.selectedInspectorScriptPath = scripts[0].path;
    }
    if (el.inspectorScriptsList) {
      el.inspectorScriptsList.innerHTML = scripts.map(function (file) {
        const active = file.path === state.selectedInspectorScriptPath ? "active" : "";
        return `<button class="file-chip ${active}" type="button" data-inspector-script="${escapeHtml(file.path)}">${escapeHtml(file.name)}</button>`;
      }).join("");
    }
    const activeScript = scripts.find(function (file) { return file.path === state.selectedInspectorScriptPath; });
    setEditorValue(el.inspectorScriptContent, activeScript ? activeScript.content : "");
    setSaveButtonState(el.inspectorScriptSaveBtn, Boolean(activeScript && activeScript.path));

    const references = data.references || [];
    if ((!state.selectedInspectorReferencePath || !references.some(function (file) { return file.path === state.selectedInspectorReferencePath; })) && references[0]) {
      state.selectedInspectorReferencePath = references[0].path;
    }
    if (el.inspectorReferencesList) {
      el.inspectorReferencesList.innerHTML = references.map(function (file) {
        const active = file.path === state.selectedInspectorReferencePath ? "active" : "";
        return `<button class="file-chip ${active}" type="button" data-inspector-reference="${escapeHtml(file.path)}">${escapeHtml(file.name)}</button>`;
      }).join("");
    }
    const activeReference = references.find(function (file) { return file.path === state.selectedInspectorReferencePath; });
    setEditorValue(el.inspectorReferenceContent, activeReference ? activeReference.content : "");
    setSaveButtonState(el.inspectorReferenceSaveBtn, Boolean(activeReference && activeReference.path));
  }

  function renderWorkspacePicker() {
    if (!el.workspacePickerModal || !el.workspacePickerCurrent || !el.workspacePickerList) return;
    el.workspacePickerModal.classList.toggle("hidden", !state.workspacePicker.open);
    el.workspacePickerCurrent.textContent = state.workspacePicker.currentPath || "경로 정보 없음";
    el.workspacePickerList.innerHTML = (state.workspacePicker.directories || []).map(function (dir) {
      return `<button class="directory-item" type="button" data-directory-path="${escapeHtml(dir.path)}">${escapeHtml(dir.name)}<div class="run-chip-meta">${escapeHtml(dir.path)}</div></button>`;
    }).join("");
  }

  function render() {
    renderChrome();
    renderDrawer();
    renderOrg();
    renderDashboard();
    const engineOptions = state.availableEngines.map(function(e) { return { value: e, label: e }; });
    renderOptions(el.globalEngineSelect, engineOptions, state.selectedEngine);

    renderConsole();
    renderWorkflow();
    renderInspector();
    renderWorkspacePicker();
    renderWriteTokenModal();
  }

  async function loadWorkspaceDirectories(path) {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const data = await fetchJson(`/api/fs/directories${query}`);
    state.workspacePicker.currentPath = data.current_path || "";
    state.workspacePicker.parentPath = data.parent_path || null;
    state.workspacePicker.directories = data.directories || [];
  }

  function getWorkspaceRootForTarget(target) {
    return target === "workflow" ? state.selectedWorkflowWorkspaceRoot : state.selectedWorkspaceRoot;
  }

  function setWorkspaceRootForTarget(target, path) {
    const nextPath = path || "";
    if (target === "workflow") {
      state.selectedWorkflowWorkspaceRoot = nextPath;
      return;
    }
    state.selectedWorkspaceRoot = nextPath;
    window.localStorage.setItem(WORKSPACE_ROOT_KEY, nextPath);
  }

  async function openWorkspacePicker(target) {
    state.workspacePicker.target = target;
    const preferredPath = getWorkspaceRootForTarget(target);
    const candidates = [];
    [preferredPath, state.defaultWorkspaceRoot, state.selectedWorkspaceRoot, null].forEach(function (path) {
      if (candidates.includes(path)) return;
      candidates.push(path);
    });

    let resolved = false;
    let recoveredFromInvalidPath = false;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        await loadWorkspaceDirectories(candidate || null);
        if (candidate !== preferredPath) {
          setWorkspaceRootForTarget(target, state.workspacePicker.currentPath);
          recoveredFromInvalidPath = Boolean(preferredPath);
        }
        resolved = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!resolved) {
      throw lastError || new Error("workspace directory lookup failed");
    }
    state.workspacePicker.open = true;
    renderWorkspacePicker();
    if (recoveredFromInvalidPath) {
      showToast("저장된 워크스페이스 경로를 찾지 못해 기본 경로로 복구했습니다.", "success");
    }
  }

  function closeWorkspacePicker() {
    state.workspacePicker.open = false;
    renderWorkspacePicker();
  }

  async function refreshAll() {
    try {
      const [overview, org, dashboard, executableAgentsData, runsData, runConfig, workflowUiConfig, workflowRunsData] = await Promise.all([
        fetchJson("/api/overview", "개요 데이터"),
        fetchJson("/api/graph/org", "조직도 데이터"),
        fetchJson("/api/dashboard", "대시보드 데이터"),
        fetchJson("/api/agents/executable", "실행 가능 에이전트"),
        fetchJson("/api/runs?limit=40", "실행 이력"),
        fetchJson("/api/run-config", "실행 설정"),
        fetchJson("/api/workflows/ui-config", "워크플로 UI 설정"),
        fetchJson("/api/workflow-runs?limit=40", "워크플로 실행 이력"),
      ]);
      state.overview = overview;
      state.org = org;
      state.dashboard = dashboard;
      state.executableAgents = executableAgentsData.agents || [];
      state.runs = runsData.runs || [];
      state.workflowUiConfig = workflowUiConfig;
      state.workflowRuns = workflowRunsData.runs || [];
      state.defaultWorkspaceRoot = runConfig.default_workspace_root || "";
      state.defaultWriteApiToken = normalizeWriteToken(runConfig.default_write_api_token || "");
      state.writeApiEnabled = runConfig.write_api_enabled !== false;
      state.availableEngines = runConfig.available_engines || ["codex"];
      
      const storedWorkspace = window.localStorage.getItem(WORKSPACE_ROOT_KEY) || "";
      const storedSandbox = window.localStorage.getItem(SANDBOX_MODE_KEY) || "";
      const storedApproval = window.localStorage.getItem(APPROVAL_POLICY_KEY) || "";
      const storedEngine = window.localStorage.getItem(ENGINE_KEY) || "";
      
      state.selectedWorkspaceRoot = storedWorkspace || state.selectedWorkspaceRoot || state.defaultWorkspaceRoot || "";
      state.selectedSandboxMode = storedSandbox || state.selectedSandboxMode || "workspace-write";
      state.selectedApprovalPolicy = storedApproval || state.selectedApprovalPolicy || "on-request";
      state.selectedEngine = storedEngine || state.selectedEngine || runConfig.default_engine || "codex";
      
      state.selectedWorkflowWorkspaceRoot = state.selectedWorkflowWorkspaceRoot || state.selectedWorkspaceRoot;
      state.selectedWorkflowSandboxMode = state.selectedWorkflowSandboxMode || state.selectedSandboxMode;
      state.selectedWorkflowApprovalPolicy = state.selectedWorkflowApprovalPolicy || state.selectedApprovalPolicy;
      if (!state.selectedAgentName && state.executableAgents[0]) {
        state.selectedAgentName = state.executableAgents.find(function (agent) { return agent.runnable; })?.name || state.executableAgents[0].name;
      }
      if (!state.selectedRunId && state.runs[0]) {
        state.selectedRunId = state.runs[0].run_id;
      }
      if (state.selectedRunId) {
        await loadRunEvents(state.selectedRunId);
      }
      if (!state.selectedWorkflowRunId && state.workflowRuns[0]) {
        state.selectedWorkflowRunId = state.workflowRuns[0].workflow_run_id;
      }
      if (state.selectedWorkflowRunId) {
        await loadWorkflowExecutionLogs(state.selectedWorkflowRunId);
      }
      if (!state.selectedInspectorAgentName && state.executableAgents[0]) {
        state.selectedInspectorAgentName = state.executableAgents[0].name;
        await loadInspector(state.selectedInspectorAgentName);
      }
      if (el.scanBtn) el.scanBtn.disabled = !state.writeApiEnabled;
      if (el.refreshBtn) el.refreshBtn.disabled = !state.writeApiEnabled;
      if (el.backupBtn) el.backupBtn.disabled = !state.writeApiEnabled;
      if (el.restoreBtn) el.restoreBtn.disabled = !state.writeApiEnabled;
      if (el.runSubmitBtn) el.runSubmitBtn.disabled = !state.writeApiEnabled;
      state.hasError = false;
      state.errorMessage = "";
      state.liveText = `마지막 갱신: ${fmtDate(overview.last_scanned_at)}`;
    } catch (err) {
      state.hasError = true;
      state.errorMessage = String(err.message || err);
      state.liveText = `오류: ${state.errorMessage}`;
    }
    renderWithInteractionGuard();
  }

  function scheduleRefresh(delayMs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshAll();
    }, delayMs);
  }

  async function createRun(presetPrompt) {
    if (!state.selectedAgentName) {
      showToast("실행 가능한 에이전트를 선택하세요.", "error");
      return;
    }
    try {
      const created = await postJsonWithAuth("/api/runs", {
        agent_name: state.selectedAgentName,
        prompt: presetPrompt || (el.runPromptInput ? el.runPromptInput.value || "" : ""),
        workspace_root: state.selectedWorkspaceRoot || null,
        sandbox_mode: state.selectedSandboxMode || null,
        approval_policy: state.selectedApprovalPolicy || null,
        engine: state.selectedEngine || null,
      });
      state.selectedRunId = created.run_id;
      state.liveText = `실행 생성: ${created.run_id}`;
      await refreshAll();
    } catch (err) {
      state.hasError = true;
      state.liveText = `실행 실패: ${String(err.message || err)}`;
      renderChrome();
    }
  }

  async function cancelSelectedRun() {
    if (!state.selectedRunId) return;
    await postJsonWithAuth(`/api/runs/${encodeURIComponent(state.selectedRunId)}/cancel`);
    await refreshAll();
  }

  async function retrySelectedRun() {
    if (!state.selectedRunId) return;
    const retried = await postJsonWithAuth(`/api/runs/${encodeURIComponent(state.selectedRunId)}/retry`);
    state.selectedRunId = retried.run_id;
    await refreshAll();
  }

  async function recommendWorkflow() {
    if (state.workflowProgressVisible) {
      return;
    }
    const goalPrompt = (el.workflowGoalInput && el.workflowGoalInput.value) || "";
    if (!goalPrompt.trim()) {
      showToast("워크플로 목표를 입력하세요.", "error");
      return;
    }
    state.workflowDraft.goalPrompt = goalPrompt;
    state.workflowProgressVisible = true;
    state.workflowProgressText = "Analyzing Strategic Objectives...";
    renderWorkflow();
    try {
      const result = await postJsonWithAuth("/api/workflows/recommend", {
        goal_prompt: goalPrompt,
        max_agents: state.workflowUiConfig ? state.workflowUiConfig.recommendation_max_agents : null,
      });
      state.workflowRecommendations = result.recommended_agents || [];
      applyWorkflowRecommendations(state.workflowRecommendations);
      state.workflowProgressVisible = false;
      state.liveText = `워크플로 추천 완료: ${state.workflowRecommendations.length}개`;
      showToast("추천 결과를 네트워크 노드에 바로 반영했습니다.", "success");
      renderWorkflow();
    } catch (err) {
      state.workflowProgressVisible = false;
      state.hasError = true;
      state.liveText = `워크플로 추천 실패: ${String(err.message || err)}`;
      render();
    }
  }

  function addSelectedWorkflowAgent() {
    const agent = (state.executableAgents || []).find(function (item) { return item.name === state.selectedWorkflowAgentName; });
    if (!agent) return;
    state.workflowDraft.steps.push(buildDefaultStepFromAgent(agent, "manual"));
    layoutWorkflowNodes(true);
    renderWorkflow();
  }

  async function createWorkflowRun() {
    if (!state.workflowDraft.goalPrompt.trim()) {
      showToast("워크플로 목표를 입력하세요.", "error");
      return;
    }
    if ((state.workflowDraft.steps || []).length === 0) {
      showToast("워크플로 단계를 추가하세요.", "error");
      return;
    }
    const created = await postJsonWithAuth("/api/workflow-runs", {
      goal_prompt: state.workflowDraft.goalPrompt,
      workspace_root: state.selectedWorkflowWorkspaceRoot || null,
      sandbox_mode: state.selectedWorkflowSandboxMode || null,
      approval_policy: state.selectedWorkflowApprovalPolicy || null,
      engine: state.selectedEngine || null,
      steps: state.workflowDraft.steps.map(function (step) {
        return {
          agent_name: step.agentName,
          prompt: step.prompt,
          icon_key: step.iconKey,
          skill_name: step.skillName || null,
        };
      }),
    });
    state.selectedWorkflowRunId = created.workflow_run_id;
    await refreshAll();
  }

  async function cancelSelectedWorkflowRun() {
    if (!state.selectedWorkflowRunId) return;
    await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/cancel`);
    await refreshAll();
  }

  async function retrySelectedWorkflowRun() {
    if (!state.selectedWorkflowRunId) return;
    const created = await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/retry`);
    state.selectedWorkflowRunId = created.workflow_run_id;
    await refreshAll();
  }

  function applyWorkflowConversationToDraft() {
    const note = String(state.workflowConversationText || "").trim();
    if (!note) {
      showToast("추가로 전달할 답변을 입력하세요.", "error");
      return;
    }
    const step = (state.workflowDraft.steps || [])[state.workflowConversationStepIndex];
    if (!step) {
      showToast("반영할 초안 단계를 찾지 못했습니다.", "error");
      return;
    }
    step.prompt = `${String(step.prompt || "").trim()}\n\n[User Follow-up]\n${note}`.trim();
    step.summary = step.summary || "사용자 답변이 추가됨";
    state.workflowConversationText = "";
    renderWorkflow();
    showToast("선택 단계 프롬프트에 답변을 반영했습니다.", "success");
  }

  async function retryWorkflowFromConversationStep() {
    const note = String(state.workflowConversationText || "").trim();
    if (!state.selectedWorkflowRunId) {
      showToast("먼저 실행 이력을 선택하세요.", "error");
      return;
    }
    if (!note) {
      showToast("Codex에게 전달할 답변을 입력하세요.", "error");
      return;
    }
    const created = await postJsonWithAuth(`/api/workflow-runs/${encodeURIComponent(state.selectedWorkflowRunId)}/retry-from-step`, {
      step_index: state.workflowConversationStepIndex,
      follow_up_note: note,
    });
    state.selectedWorkflowRunId = created.workflow_run_id;
    state.workflowConversationText = "";
    await refreshAll();
  }

  function buildRunDrawer(run, detail, events) {
    const body = `
      <section class="drawer-section">
        <div class="section-kicker">RUN_META</div>
        <ul class="drawer-list">
          <li><strong>Agent</strong><div class="drawer-subtitle">${escapeHtml(run.agent_name)}</div></li>
          <li><strong>Status</strong><div class="drawer-subtitle">${escapeHtml(run.status)}</div></li>
          <li><strong>Engine</strong><div class="drawer-subtitle">${escapeHtml(run.engine || "codex")}</div></li>
          <li><strong>Workspace</strong><div class="drawer-subtitle">${escapeHtml(run.workspace_root || "")}</div></li>
        </ul>
      </section>
      <section class="drawer-section">
        <div class="section-kicker">PROMPT</div>
        <div class="drawer-subtitle">${escapeHtml((detail && detail.prompt) || run.prompt_preview || "")}</div>
      </section>
      <section class="drawer-section">
        <div class="section-kicker">RECENT_EVENTS</div>
        <ul class="drawer-list">${(events || []).slice(-8).map(function (event) { return `<li>${escapeHtml(event.event_type)}<div class="drawer-subtitle">${escapeHtml(event.message)}</div></li>`; }).join("") || "<li>이벤트 없음</li>"}</ul>
      </section>
    `;
    openDrawerHtml({ kicker: "RUN_DETAIL", title: run.agent_name, subtitle: run.run_id, bodyHtml: body });
  }

  async function openRunDrawer(runId) {
    const run = state.runs.find(function (item) { return item.run_id === runId; });
    if (!run) return;
    const detail = await loadRunDetail(runId);
    await loadRunEvents(runId);
    buildRunDrawer(run, detail, state.runEvents.get(runId) || []);
  }

  async function openWorkflowRunDrawer(workflowRunId) {
    const run = state.workflowRuns.find(function (item) { return item.workflow_run_id === workflowRunId; });
    if (!run) return;
    const detail = await loadWorkflowRunDetail(workflowRunId);
    await loadWorkflowEvents(workflowRunId);
    const body = `
      <section class="drawer-section">
        <div class="section-kicker">WORKFLOW_META</div>
        <ul class="drawer-list">
          <li><strong>Status</strong><div class="drawer-subtitle">${escapeHtml(run.status)}</div></li>
          <li><strong>Workspace</strong><div class="drawer-subtitle">${escapeHtml(run.workspace_root || "")}</div></li>
          <li><strong>Goal</strong><div class="drawer-subtitle">${escapeHtml((detail && detail.goal_prompt) || run.goal_prompt_preview || "")}</div></li>
        </ul>
      </section>
      <section class="drawer-section">
        <div class="section-kicker">STEPS</div>
        <ul class="drawer-list">${(detail && detail.steps ? detail.steps : []).map(function (step) { return `<li><strong>${escapeHtml(step.agent_name)}</strong><div class="drawer-subtitle">${escapeHtml(step.status)} · ${escapeHtml(step.summary || step.last_event_message || "")}</div></li>`; }).join("") || "<li>단계 없음</li>"}</ul>
      </section>
    `;
    openDrawerHtml({ kicker: "WORKFLOW_RUN", title: run.status, subtitle: run.workflow_run_id, bodyHtml: body });
  }

  function openWorkflowStepDrawer(index) {
    const step = (state.workflowDraft.steps || [])[index];
    if (!step) return;
    openDrawerHtml({
      kicker: "WORKFLOW_STEP",
      title: step.agentName,
      subtitle: `${step.departmentLabel || ""} / ${step.roleLabel || ""} · STEP ${String(index + 1).padStart(2, "0")}`,
      bodyHtml: `
        <section class="drawer-section">
          <div class="section-kicker">STATUS</div>
          <div class="drawer-subtitle">${escapeHtml(step.status || "ready")}</div>
        </section>
        <section class="drawer-section">
          <div class="section-kicker">PROMPT_EDITOR</div>
          <textarea class="proto-input proto-textarea drawer-prompt-editor" data-workflow-step-prompt="${index}" placeholder="이 단계에서 실행할 프롬프트를 입력하세요.">${escapeHtml(step.prompt || "")}</textarea>
        </section>
        <section class="drawer-section">
          <div class="section-kicker">SUMMARY</div>
          <div class="drawer-subtitle">${escapeHtml(step.summary || "")}</div>
        </section>
      `,
    });
  }

  async function openInspectorDrawer(agentName) {
    const data = await loadInspector(agentName);
    if (!data) return;
    openDrawerHtml({
      kicker: "AGENT_PROFILE",
      title: data.agent_name,
      subtitle: `${data.department_label_ko || ""} / ${data.role_label_ko || ""}`,
      bodyHtml: `
        <section class="drawer-section">
          <div class="section-kicker">DESCRIPTION</div>
          <div class="drawer-subtitle">${escapeHtml(data.description || data.short_description || "")}</div>
        </section>
        <section class="drawer-section">
          <div class="section-kicker">SKILL</div>
          <div class="drawer-subtitle">${escapeHtml(data.skill_name || "-")}</div>
        </section>
        <section class="drawer-section">
          <div class="section-kicker">FILE_STATS</div>
          <ul class="drawer-list">
            <li>scripts: ${(data.scripts || []).length}</li>
            <li>references: ${(data.references || []).length}</li>
          </ul>
        </section>
      `,
    });
  }

  async function postAction(url) {
    await postJsonWithAuth(url);
    await refreshAll();
  }

  function initializeTheme() {
    state.theme = normalizeTheme(window.localStorage.getItem(UI_THEME_KEY));
  }

  function initializePersistence() {
    state.selectedWorkspaceRoot = window.localStorage.getItem(WORKSPACE_ROOT_KEY) || "";
    state.selectedSandboxMode = window.localStorage.getItem(SANDBOX_MODE_KEY) || "workspace-write";
    state.selectedApprovalPolicy = window.localStorage.getItem(APPROVAL_POLICY_KEY) || "on-request";
    state.selectedEngine = window.localStorage.getItem(ENGINE_KEY) || "codex";
    state.selectedWorkflowWorkspaceRoot = state.selectedWorkspaceRoot;
    state.selectedWorkflowSandboxMode = state.selectedSandboxMode;
    state.selectedWorkflowApprovalPolicy = state.selectedApprovalPolicy;
    state.orgHudExpanded = window.localStorage.getItem(ORG_HUD_EXPANDED_KEY) === "true";
    const savedWorkflowLogView = window.localStorage.getItem(WORKFLOW_LOG_VIEW_KEY);
    state.workflowLogView = ["codex", "raw"].includes(savedWorkflowLogView) ? savedWorkflowLogView : "codex";
  }

  function setupEvents() {
    const tabButtons = {
      org: el.tabOrg,
      dashboard: el.tabDashboard,
      console: el.tabConsole,
      workflow: el.tabWorkflow,
      inspector: el.tabInspector,
    };
    Object.entries(tabButtons).forEach(function ([key, button]) {
      if (!button) return;
      button.addEventListener("click", function () {
        state.tab = key;
        renderChrome();
        if (key === "inspector" && state.selectedInspectorAgentName && !state.inspectorCache.has(state.selectedInspectorAgentName)) {
          loadInspector(state.selectedInspectorAgentName).then(renderInspector);
        }
      });
    });

    if (el.themeSwitcher) {
      el.themeSwitcher.addEventListener("change", function () {
        state.theme = normalizeTheme(el.themeSwitcher.value);
        window.localStorage.setItem(UI_THEME_KEY, state.theme);
        render();
      });
    }
    if (el.themeQuickButtons && el.themeQuickButtons.length > 0) {
      el.themeQuickButtons.forEach(function (button) {
        button.addEventListener("click", function () {
          state.theme = normalizeTheme(button.getAttribute("data-theme-value"));
          window.localStorage.setItem(UI_THEME_KEY, state.theme);
          render();
        });
      });
    }

    if (el.orgHudToggleBtn) {
      el.orgHudToggleBtn.addEventListener("click", function () {
        state.orgHudExpanded = !state.orgHudExpanded;
        window.localStorage.setItem(ORG_HUD_EXPANDED_KEY, state.orgHudExpanded ? "true" : "false");
        renderOverviewHud();
      });
    }
    if (el.workflowLogViewCodexBtn) {
      el.workflowLogViewCodexBtn.addEventListener("click", function () {
        state.workflowLogView = "codex";
        window.localStorage.setItem(WORKFLOW_LOG_VIEW_KEY, state.workflowLogView);
        renderWorkflowLogView();
      });
    }
    if (el.workflowLogViewRawBtn) {
      el.workflowLogViewRawBtn.addEventListener("click", function () {
        state.workflowLogView = "raw";
        window.localStorage.setItem(WORKFLOW_LOG_VIEW_KEY, state.workflowLogView);
        renderWorkflowLogView();
      });
    }
    if (el.writeTokenInput) {
      el.writeTokenInput.addEventListener("input", function () {
        state.writeTokenModal.draft = normalizeWriteToken(el.writeTokenInput.value || "");
      });
      el.writeTokenInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          closeWriteTokenModal(normalizeWriteToken(el.writeTokenInput.value || "") || state.defaultWriteApiToken, false);
        }
      });
    }
    if (el.writeTokenDefault) {
      el.writeTokenDefault.addEventListener("click", function () {
        closeWriteTokenModal(state.defaultWriteApiToken, false);
      });
    }
    if (el.writeTokenSave) {
      el.writeTokenSave.addEventListener("click", function () {
        closeWriteTokenModal(normalizeWriteToken(el.writeTokenInput ? el.writeTokenInput.value : "") || state.defaultWriteApiToken, false);
      });
    }
    if (el.writeTokenClose) {
      el.writeTokenClose.addEventListener("click", function () {
        closeWriteTokenModal("", true);
      });
    }
    if (el.writeTokenModal) {
      el.writeTokenModal.addEventListener("click", function (event) {
        if (event.target === el.writeTokenModal) {
          closeWriteTokenModal("", true);
        }
      });
    }

    if (el.scanBtn) el.scanBtn.addEventListener("click", function () { postAction("/api/scan").catch(handleError); });
    if (el.refreshBtn) el.refreshBtn.addEventListener("click", function () { postAction("/api/activity/refresh").catch(handleError); });
    if (el.backupBtn) el.backupBtn.addEventListener("click", function () { postAction("/api/backups/skills-agents").then(function () { showToast("백업 완료", "success"); }).catch(handleError); });
    if (el.restoreBtn) el.restoreBtn.addEventListener("click", function () { postAction("/api/backups/skills-agents/restore").then(function () { showToast("리스토어 완료", "success"); }).catch(handleError); });
    if (el.inspectorSkillSaveBtn) {
      el.inspectorSkillSaveBtn.addEventListener("click", function () {
        const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
        saveInspectorFile(data ? data.skill_markdown : null, el.inspectorSkillContent, "SKILL.md").catch(handleError);
      });
    }
    if (el.inspectorAgentConfigSaveBtn) {
      el.inspectorAgentConfigSaveBtn.addEventListener("click", function () {
        const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
        saveInspectorFile(getInspectorConfigFile(data), el.inspectorAgentTomlContent, "에이전트 설정").catch(handleError);
      });
    }
    if (el.inspectorScriptSaveBtn) {
      el.inspectorScriptSaveBtn.addEventListener("click", function () {
        const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
        const file = data ? (data.scripts || []).find(function (item) { return item.path === state.selectedInspectorScriptPath; }) : null;
        saveInspectorFile(file, el.inspectorScriptContent, "스크립트").catch(handleError);
      });
    }
    if (el.inspectorReferenceSaveBtn) {
      el.inspectorReferenceSaveBtn.addEventListener("click", function () {
        const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
        const file = data ? (data.references || []).find(function (item) { return item.path === state.selectedInspectorReferencePath; }) : null;
        saveInspectorFile(file, el.inspectorReferenceContent, "레퍼런스").catch(handleError);
      });
    }

    if (el.globalEngineSelect) {
      el.globalEngineSelect.addEventListener("change", function () {
        state.selectedEngine = el.globalEngineSelect.value || "codex";
        window.localStorage.setItem(ENGINE_KEY, state.selectedEngine);
      });
    }

    if (el.runAgentSelect) el.runAgentSelect.addEventListener("change", function () { state.selectedAgentName = el.runAgentSelect.value || ""; });
    if (el.runWorkspaceInput) el.runWorkspaceInput.addEventListener("change", function () {
      setWorkspaceRootForTarget("run", el.runWorkspaceInput.value || "");
    });
    if (el.runSandboxSelect) el.runSandboxSelect.addEventListener("change", function () {
      state.selectedSandboxMode = el.runSandboxSelect.value || "workspace-write";
      window.localStorage.setItem(SANDBOX_MODE_KEY, state.selectedSandboxMode);
    });
    if (el.runApprovalSelect) el.runApprovalSelect.addEventListener("change", function () {
      state.selectedApprovalPolicy = el.runApprovalSelect.value || "on-request";
      window.localStorage.setItem(APPROVAL_POLICY_KEY, state.selectedApprovalPolicy);
    });
    if (el.runWorkspacePickerBtn) el.runWorkspacePickerBtn.addEventListener("click", function () { openWorkspacePicker("run").catch(handleError); });
    if (el.runSubmitBtn) el.runSubmitBtn.addEventListener("click", function () { createRun().catch(handleError); });
    if (el.runCancelBtn) el.runCancelBtn.addEventListener("click", function () { cancelSelectedRun().catch(handleError); });
    if (el.runRetryBtn) el.runRetryBtn.addEventListener("click", function () { retrySelectedRun().catch(handleError); });

    if (el.workflowGoalInput) el.workflowGoalInput.addEventListener("input", function () { state.workflowDraft.goalPrompt = el.workflowGoalInput.value || ""; });
    if (el.workflowGoalInput) el.workflowGoalInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      recommendWorkflow().catch(handleError);
    });
    if (el.workflowWorkspaceInput) el.workflowWorkspaceInput.addEventListener("change", function () { setWorkspaceRootForTarget("workflow", el.workflowWorkspaceInput.value || ""); });
    if (el.workflowSandboxSelect) el.workflowSandboxSelect.addEventListener("change", function () { state.selectedWorkflowSandboxMode = el.workflowSandboxSelect.value || "workspace-write"; });
    if (el.workflowApprovalSelect) el.workflowApprovalSelect.addEventListener("change", function () { state.selectedWorkflowApprovalPolicy = el.workflowApprovalSelect.value || "on-request"; });
    if (el.workflowWorkspacePickerBtn) el.workflowWorkspacePickerBtn.addEventListener("click", function () { openWorkspacePicker("workflow").catch(handleError); });
    if (el.workflowRecommendBtn) el.workflowRecommendBtn.addEventListener("click", function () { recommendWorkflow().catch(handleError); });
    if (el.workflowAgentFilterInput) el.workflowAgentFilterInput.addEventListener("input", function () { state.workflowAgentFilter = el.workflowAgentFilterInput.value || ""; renderWorkflowAgentOptions(); });
    if (el.workflowAgentSelect) el.workflowAgentSelect.addEventListener("change", function () { state.selectedWorkflowAgentName = el.workflowAgentSelect.value || ""; });
    if (el.workflowAgentAddBtn) el.workflowAgentAddBtn.addEventListener("click", function () { addSelectedWorkflowAgent(); });
    if (el.workflowRunBtn) el.workflowRunBtn.addEventListener("click", function () { createWorkflowRun().catch(handleError); });
    if (el.workflowCancelBtn) el.workflowCancelBtn.addEventListener("click", function () { cancelSelectedWorkflowRun().catch(handleError); });
    if (el.workflowRetryBtn) el.workflowRetryBtn.addEventListener("click", function () { retrySelectedWorkflowRun().catch(handleError); });
    if (el.workflowConversationStepSelect) el.workflowConversationStepSelect.addEventListener("change", function () {
      state.workflowConversationStepIndex = Number(el.workflowConversationStepSelect.value || "0");
      renderWorkflowConversation();
    });
    if (el.workflowConversationInput) el.workflowConversationInput.addEventListener("input", function () {
      state.workflowConversationText = el.workflowConversationInput.value || "";
    });
    if (el.workflowConversationApplyBtn) el.workflowConversationApplyBtn.addEventListener("click", function () {
      applyWorkflowConversationToDraft();
    });
    if (el.workflowConversationRetryBtn) el.workflowConversationRetryBtn.addEventListener("click", function () {
      retryWorkflowFromConversationStep().catch(handleError);
    });

    if (el.drawerCloseBtn) el.drawerCloseBtn.addEventListener("click", closeDrawer);
    if (el.drawerBackdrop) el.drawerBackdrop.addEventListener("click", closeDrawer);

    if (el.workspacePickerClose) el.workspacePickerClose.addEventListener("click", closeWorkspacePicker);
    if (el.workspacePickerUp) el.workspacePickerUp.addEventListener("click", function () {
      if (!state.workspacePicker.parentPath) return;
      loadWorkspaceDirectories(state.workspacePicker.parentPath).then(renderWorkspacePicker).catch(handleError);
    });
    if (el.workspacePickerChoose) el.workspacePickerChoose.addEventListener("click", function () {
      const path = state.workspacePicker.currentPath || "";
      setWorkspaceRootForTarget(state.workspacePicker.target, path);
      closeWorkspacePicker();
      render();
    });

    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const hudCard = target.closest("[data-hud-title]");
      if (hudCard) {
        openDrawerForHud(hudCard.getAttribute("data-hud-title") || "Metric", hudCard.getAttribute("data-hud-value") || "0");
        return;
      }

      const dashboardMetric = target.closest("[data-dashboard-metric]");
      if (dashboardMetric) {
        const key = dashboardMetric.getAttribute("data-dashboard-metric");
        const metric = ((state.dashboard && state.dashboard.metrics) || []).find(function (item) { return item.key === key; });
        if (metric) openDrawerForHud(metric.label, String(metric.value));
        return;
      }

      const drawerRunAgent = target.closest("[data-drawer-run-agent]");
      if (drawerRunAgent) {
        const agentName = drawerRunAgent.getAttribute("data-drawer-run-agent") || "";
        state.tab = "console";
        state.selectedAgentName = agentName;
        closeDrawer();
        render();
        return;
      }

      const drawerRunOnce = target.closest("[data-drawer-run-once]");
      if (drawerRunOnce) {
        const agentName = drawerRunOnce.getAttribute("data-drawer-run-once") || "";
        const agent = (state.executableAgents || []).find(function (item) { return item.name === agentName; });
        state.selectedAgentName = agentName;
        closeDrawer();
        createRun(agent && agent.one_click_prompt ? agent.one_click_prompt : undefined).catch(handleError);
        return;
      }

      const feedItem = target.closest("[data-feed-kind]");
      if (feedItem) {
        const kind = feedItem.getAttribute("data-feed-kind") || "timeline";
        const index = Number(feedItem.getAttribute("data-feed-index"));
        const list = (((state.dashboard || {})[kind]) || []);
        const item = list[index];
        if (item) {
          openDrawerHtml({ kicker: kind.toUpperCase(), title: item.title || "-", subtitle: item.subtitle || "", bodyHtml: `<section class="drawer-section"><div class="section-kicker">TIMESTAMP</div><div class="drawer-subtitle">${escapeHtml(fmtDate(item.timestamp))}</div></section>` });
        }
        return;
      }

      const orgNode = target.closest("[data-org-node-id]");
      if (orgNode) {
        const nodeId = orgNode.getAttribute("data-org-node-id");
        const node = (state.org && state.org.nodes ? state.org.nodes : []).find(function (item) { return item.id === nodeId; });
        if (node) buildOrgDrawer(node);
        return;
      }

      const runChip = target.closest("[data-run-id]");
      if (runChip) {
        const runId = runChip.getAttribute("data-run-id") || "";
        state.selectedRunId = runId;
        Promise.all([loadRunEvents(runId), openRunDrawer(runId)]).then(renderConsole).catch(handleError);
        return;
      }

      const workflowRunChip = target.closest("[data-workflow-run-id]");
      if (workflowRunChip) {
        const workflowRunId = workflowRunChip.getAttribute("data-workflow-run-id") || "";
        state.selectedWorkflowRunId = workflowRunId;
        Promise.all([loadWorkflowExecutionLogs(workflowRunId), openWorkflowRunDrawer(workflowRunId)]).then(renderWorkflow).catch(handleError);
        return;
      }

      const removeStep = target.closest("[data-remove-workflow-step]");
      if (removeStep) {
        removeWorkflowStep(Number(removeStep.getAttribute("data-remove-workflow-step")));
        return;
      }

      const workflowStep = target.closest("[data-workflow-step-index]");
      if (workflowStep) {
        if (Date.now() - lastWorkflowDragEndedAt < 250) return;
        const index = Number(workflowStep.getAttribute("data-workflow-step-index"));
        openWorkflowStepDrawer(index);
        return;
      }

      const inspectorAgent = target.closest("[data-inspector-agent]");
      if (inspectorAgent) {
        const agentName = inspectorAgent.getAttribute("data-inspector-agent") || "";
        state.selectedInspectorAgentName = agentName;
        state.selectedInspectorScriptPath = "";
        state.selectedInspectorReferencePath = "";
        loadInspector(agentName).then(function () {
          renderInspector();
          openInspectorDrawer(agentName).catch(handleError);
        }).catch(handleError);
        return;
      }

      const inspectorScript = target.closest("[data-inspector-script]");
      if (inspectorScript) {
        state.selectedInspectorScriptPath = inspectorScript.getAttribute("data-inspector-script") || "";
        renderInspector();
        return;
      }

      const inspectorReference = target.closest("[data-inspector-reference]");
      if (inspectorReference) {
        state.selectedInspectorReferencePath = inspectorReference.getAttribute("data-inspector-reference") || "";
        renderInspector();
        return;
      }

      const dirItem = target.closest("[data-directory-path]");
      if (dirItem) {
        const path = dirItem.getAttribute("data-directory-path") || "";
        loadWorkspaceDirectories(path)
          .then(renderWorkspacePicker)
          .catch(function () {
            showToast("선택한 폴더를 열 수 없습니다.", "error");
          });
      }
    });

    document.addEventListener("mousedown", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-remove-workflow-step]")) return;
      if (target.closest("button, textarea, input, select, option")) return;
      const node = target.closest("[data-workflow-step-id]");
      if (!node) return;
      const nodeId = node.getAttribute("data-workflow-step-id");
      if (!nodeId) return;
      const current = state.workflowNodePositions[nodeId];
      if (!current) return;
      const stageRect = el.workflowStepList ? el.workflowStepList.getBoundingClientRect() : null;
      const pointerLeft = stageRect ? event.clientX - stageRect.left + el.workflowStepList.scrollLeft : event.clientX;
      const pointerTop = stageRect ? event.clientY - stageRect.top + el.workflowStepList.scrollTop : event.clientY;
      dragState = {
        nodeId: nodeId,
        nodeElement: node,
        active: false,
        moved: false,
        startPointerLeft: pointerLeft,
        startPointerTop: pointerTop,
        offsetX: pointerLeft - current.left,
        offsetY: pointerTop - current.top,
      };
    });

    document.addEventListener("mousemove", function (event) {
      if (!dragState) return;
      const stageRect = el.workflowStepList ? el.workflowStepList.getBoundingClientRect() : null;
      const pointerLeft = stageRect ? event.clientX - stageRect.left + el.workflowStepList.scrollLeft : event.clientX;
      const pointerTop = stageRect ? event.clientY - stageRect.top + el.workflowStepList.scrollTop : event.clientY;
      if (!dragState.active) {
        const deltaX = pointerLeft - dragState.startPointerLeft;
        const deltaY = pointerTop - dragState.startPointerTop;
        if (Math.hypot(deltaX, deltaY) < WORKFLOW_DRAG_THRESHOLD_PX) {
          return;
        }
        dragState.active = true;
        if (dragState.nodeElement && dragState.nodeElement.isConnected) {
          dragState.nodeElement.classList.add("dragging");
        }
      }
      state.workflowNodePositions[dragState.nodeId] = {
        left: Math.max(40, pointerLeft - dragState.offsetX),
        top: Math.max(40, pointerTop - dragState.offsetY),
      };
      dragState.moved = true;
      scheduleWorkflowSceneRender();
    });

    document.addEventListener("mouseup", function () {
      if (!dragState) return;
      const moved = dragState.active && dragState.moved;
      dragState = null;
      if (moved) {
        reorderWorkflowStepsFromCanvas();
        lastWorkflowDragEndedAt = Date.now();
        renderWorkflow();
        return;
      }
    });

    document.addEventListener("input", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target === el.inspectorSkillContent && target instanceof HTMLTextAreaElement) {
        const data = state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null;
        updateInspectorCachedContent(data && data.skill_markdown ? data.skill_markdown.path : "", target.value || "");
        return;
      }
      if (target === el.inspectorAgentTomlContent && target instanceof HTMLTextAreaElement) {
        const file = getInspectorConfigFile(state.selectedInspectorAgentName ? state.inspectorCache.get(state.selectedInspectorAgentName) : null);
        updateInspectorCachedContent(file ? file.path : "", target.value || "");
        return;
      }
      if (target === el.inspectorScriptContent && target instanceof HTMLTextAreaElement) {
        updateInspectorCachedContent(state.selectedInspectorScriptPath, target.value || "");
        return;
      }
      if (target === el.inspectorReferenceContent && target instanceof HTMLTextAreaElement) {
        updateInspectorCachedContent(state.selectedInspectorReferencePath, target.value || "");
        return;
      }
      const promptEditor = target.closest("[data-workflow-step-prompt]");
      if (!promptEditor || !(promptEditor instanceof HTMLTextAreaElement)) return;
      const index = Number(promptEditor.getAttribute("data-workflow-step-prompt"));
      const step = (state.workflowDraft.steps || [])[index];
      if (!step) return;
      step.prompt = promptEditor.value || "";
    });

    document.addEventListener("change", function (event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const promptEditor = target.closest("[data-workflow-step-prompt]");
      if (!promptEditor || !(promptEditor instanceof HTMLTextAreaElement)) return;
      const index = Number(promptEditor.getAttribute("data-workflow-step-prompt"));
      const step = (state.workflowDraft.steps || [])[index];
      if (!step) return;
      step.prompt = promptEditor.value || "";
      renderWorkflowScene();
    });

    document.addEventListener("focusout", function () {
      window.setTimeout(flushDeferredInteractiveRender, 0);
    });
  }

  function setupEventsStream() {
    const source = new EventSource("/api/events");
    source.onopen = function () {
      state.liveText = "이벤트 연결됨";
      renderChrome();
    };
    source.onmessage = function (event) {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.type || payload.type === "heartbeat") return;
        scheduleRefresh(400);
      } catch (_err) {
        /* ignore malformed events */
      }
    };
    source.onerror = function () {
      state.liveText = "이벤트 재연결 중...";
      renderChrome();
    };
  }

  function handleError(err) {
    state.hasError = true;
    state.errorMessage = err && String(err.message || err) === "write api disabled"
      ? "쓰기 API가 비활성화되어 있습니다. 서버에 CUSTOM_CODEX_AGENT_WRITE_API_TOKEN을 설정하세요."
      : String(err.message || err);
    state.liveText = `오류: ${state.errorMessage}`;
    render();
  }

  initializeTheme();
  initializePersistence();
  setupEvents();
  refreshAll();
  setupEventsStream();
  setInterval(refreshAll, REFRESH_INTERVAL_MS);
})();
