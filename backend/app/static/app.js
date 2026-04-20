(function () {
  const DEFAULT_WRITE_API_TOKEN = "custom-codex-agent-local-token";
  const WRITE_API_TOKEN_KEY = "custom-codex-agent-write-token";
  const WORKSPACE_ROOT_KEY = "custom-codex-agent-workspace-root";
  const SANDBOX_MODE_KEY = "custom-codex-agent-sandbox-mode";
  const APPROVAL_POLICY_KEY = "custom-codex-agent-approval-policy";
  const RUN_EVENT_TYPES = new Set(["run:queued", "run:started", "run:stdout", "run:stderr", "run:completed", "run:failed", "run:canceled"]);

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
  };

  const el = {
    liveState: document.getElementById("live-state"),
    errorBanner: document.getElementById("error-banner"),
    orgView: document.getElementById("org-view"),
    dashboardView: document.getElementById("dashboard-view"),
    consoleView: document.getElementById("console-view"),
    inspectorView: document.getElementById("inspector-view"),
    tabOrg: document.getElementById("tab-org"),
    tabDashboard: document.getElementById("tab-dashboard"),
    tabConsole: document.getElementById("tab-console"),
    tabInspector: document.getElementById("tab-inspector"),
    scanBtn: document.getElementById("scan-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
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
    runPromptInput: document.getElementById("run-prompt-input"),
    runSubmitBtn: document.getElementById("run-submit-btn"),
    runCancelBtn: document.getElementById("run-cancel-btn"),
    runRetryBtn: document.getElementById("run-retry-btn"),
    runList: document.getElementById("run-list"),
    runLog: document.getElementById("run-log"),
    runMeta: document.getElementById("run-meta"),
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
    renderRunList();
    renderRunLog();
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
    renderInspector();
    renderWorkspacePicker();
  }

  function toggleTab(tabName) {
    const showOrg = tabName === "org";
    const showDashboard = tabName === "dashboard";
    const showConsole = tabName === "console";
    const showInspector = tabName === "inspector";

    el.orgView.classList.toggle("hidden", !showOrg);
    el.dashboardView.classList.toggle("hidden", !showDashboard);
    el.consoleView.classList.toggle("hidden", !showConsole);
    if (el.inspectorView) {
      el.inspectorView.classList.toggle("hidden", !showInspector);
    }
    el.tabOrg.classList.toggle("active", showOrg);
    el.tabDashboard.classList.toggle("active", showDashboard);
    el.tabConsole.classList.toggle("active", showConsole);
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
    const basisPath = (state.selectedWorkspaceRoot || "").trim();
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
      const [overview, org, dashboard, executableAgentsData, runsData, runConfig] = await Promise.all([
        fetchJson("/api/overview"),
        fetchJson("/api/graph/org"),
        fetchJson("/api/dashboard"),
        fetchJson("/api/agents/executable"),
        fetchJson("/api/runs?limit=40"),
        fetchJson("/api/run-config"),
      ]);
      state.overview = overview;
      state.org = org;
      state.dashboard = dashboard;
      state.executableAgents = executableAgentsData.agents || [];
      state.runs = runsData.runs || [];
      const storedWorkspace = window.localStorage.getItem(WORKSPACE_ROOT_KEY) || "";
      const storedSandboxMode = window.localStorage.getItem(SANDBOX_MODE_KEY) || "";
      const storedApprovalPolicy = window.localStorage.getItem(APPROVAL_POLICY_KEY) || "";
      const defaultWorkspace = (runConfig && runConfig.default_workspace_root) || "";
      state.selectedWorkspaceRoot = storedWorkspace || state.selectedWorkspaceRoot || defaultWorkspace;
      state.selectedSandboxMode = storedSandboxMode || state.selectedSandboxMode || "workspace-write";
      state.selectedApprovalPolicy = storedApprovalPolicy || state.selectedApprovalPolicy || "on-request";
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

      if (state.tab === "inspector") {
        const fallbackAgent =
          state.selectedInspectorAgentName ||
          (state.executableAgents && state.executableAgents.length > 0 ? state.executableAgents[0].name : "");
        if (fallbackAgent) {
          await loadInspector(fallbackAgent);
        }
      }

      state.hasError = false;
      state.liveText = `마지막 갱신: ${fmtDate(overview.last_scanned_at)}`;
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

  function setupEvents() {
    const eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.type || payload.type === "heartbeat") return;
        state.liveText = `이벤트: ${payload.type}`;

        if (RUN_EVENT_TYPES.has(payload.type)) {
          appendRunEventFromSse(payload.payload || {});
          if ((payload.payload && payload.payload.runId) === state.selectedRunId) {
            renderRunLog();
          }

          if (payload.type === "run:stdout" || payload.type === "run:stderr") {
            render();
            return;
          }
          scheduleRefresh(400);
          render();
          return;
        }

        render();
        scheduleRefresh(200);
      } catch (_err) {
        /* ignore malformed events */
      }
    };
    eventSource.onerror = function () {
      state.liveText = "이벤트 재연결 중...";
      render();
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
    if (el.runAgentSelect) {
      el.runAgentSelect.addEventListener("change", function () {
        state.selectedAgentName = el.runAgentSelect.value;
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
        state.selectedWorkspaceRoot = selectedPath;
        window.localStorage.setItem(WORKSPACE_ROOT_KEY, selectedPath);
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
  }

  bind();
  refreshAll();
  setupEvents();
  setInterval(refreshAll, 30000);
})();
