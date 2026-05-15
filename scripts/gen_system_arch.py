"""
Generate system architecture drawio diagram.

All nodes use parent="1" (flat hierarchy) to avoid cross-parent edge
rendering bugs in draw.io. Groups are visual-only containers.
"""
import xml.etree.ElementTree as ET

# ── Counters ──
_edge_id = 0

def _next_edge_id():
    global _edge_id
    _edge_id += 1
    return f"e{_edge_id}"


def cell(root, id_str, value, x, y, w, h, style, parent="1"):
    """Create a vertex cell."""
    el = ET.SubElement(root, "mxCell",
                       id=id_str, value=value, style=style,
                       parent=parent, vertex="1")
    ET.SubElement(el, "mxGeometry",
                  x=str(x), y=str(y), width=str(w), height=str(h),
                  **{"as": "geometry"})
    return el


def edge(root, src, tgt, style, label=""):
    """Create an edge cell."""
    eid = _next_edge_id()
    el = ET.SubElement(root, "mxCell",
                       id=eid, value=label, style=style,
                       parent="1", source=src, target=tgt, edge="1")
    geo = ET.SubElement(el, "mxGeometry", relative="1")
    geo.set("as", "geometry")
    return el


# ── Styles ──
# Groups: colored swimlane headers with 36px title bar
GRP = (
    "swimlane;whiteSpace=wrap;html=1;fontStyle=1;fontSize=13;"
    "startSize=36;fontColor=#000000;rounded=1;arcSize=6;"
    "swimlaneLine=1;separatorColor=#999999;"
)
GRP_RENDERER  = GRP + "fillColor=#dae8fc;strokeColor=#6c8ebf;strokeWidth=2;"
GRP_MAIN      = GRP + "fillColor=#d5e8d4;strokeColor=#82b366;strokeWidth=2;"
GRP_WORKER    = GRP + "fillColor=#fff2cc;strokeColor=#d6b656;strokeWidth=2;"
GRP_SUB       = GRP + "fillColor=#fafafa;strokeColor=#999999;strokeWidth=1;fontStyle=0;fontSize=11;startSize=28;"

# Nodes: each functional area has a distinct fill
N_UI = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#e1d5e7;strokeColor=#9673a6;strokeWidth=1.5;"
)
N_STATE = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#fff2cc;strokeColor=#d6b656;strokeWidth=1.5;"
)
N_IPC = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#f8cecc;strokeColor=#b85450;strokeWidth=1.5;"
)
N_SVC = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#d5e8d4;strokeColor=#82b366;strokeWidth=1.5;"
)
N_ADAPTER = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#dae8fc;strokeColor=#6c8ebf;strokeWidth=1.5;"
)
N_WORKER = (
    "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;"
    "fillColor=#ffe6cc;strokeColor=#d79b00;strokeWidth=1.5;"
)
N_DB = (
    "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;"
    "backgroundOutline=1;size=15;fontSize=11;fontColor=#000000;"
    "fillColor=#ffe6cc;strokeColor=#d79b00;strokeWidth=1.5;"
)
N_SECURITY = (
    "shape=note;whiteSpace=wrap;html=1;fontSize=10;fontColor=#666666;"
    "fillColor=#f5f5f5;strokeColor=#cccccc;strokeWidth=1;backgroundOutline=1;size=15;"
)

# Edges
E_NORMAL = (
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;"
    "jettySize=auto;html=1;strokeWidth=1.5;strokeColor=#666666;"
    "fontColor=#000000;fontSize=9;labelBackgroundColor=#FFFFFF;"
)
E_IPC = (
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;"
    "jettySize=auto;html=1;strokeWidth=3;strokeColor=#b85450;"
    "fontColor=#000000;fontSize=10;dashed=0;labelBackgroundColor=#FFFFFF;"
)
E_DATA = (
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;"
    "jettySize=auto;html=1;strokeWidth=1.5;strokeColor=#d79b00;"
    "fontColor=#000000;fontSize=9;dashed=1;dashPattern=8 4;labelBackgroundColor=#FFFFFF;"
)


def generate():
    mxfile = ET.Element("mxfile", version="21.6.8")
    diagram = ET.SubElement(mxfile, "diagram", name="System Architecture", id="d1")
    model = ET.SubElement(diagram, "mxGraphModel",
                          dx="1600", dy="1200", grid="1", gridSize="10",
                          guides="1", tooltips="1", connect="1", arrows="1",
                          fold="1", page="1", pageScale="1",
                          pageWidth="1600", pageHeight="1100",
                          background="#FFFFFF")
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")

    # ════════════════════════════════════════════
    # Title
    # ════════════════════════════════════════════
    cell(root, "title", (
        '<b style="font-size:18px;color:#000000;">Agent Orchestrator Desktop — System Architecture</b>'
        '<br/><span style="font-size:11px;color:#333333;">Electron + React + TypeScript · Planning.md §2</span>'
    ), 40, 10, 700, 50,
        "text;html=1;align=left;verticalAlign=middle;resizable=0;points=[];autosize=0;")

    # ════════════════════════════════════════════
    # RENDERER PROCESS  (y=70..330)
    # ════════════════════════════════════════════
    RY = 70   # renderer top
    cell(root, "grp_renderer",
         "Electron Renderer Process  (React · Vite · TypeScript)",
         40, RY, 1500, 260, GRP_RENDERER)

    # UI components — row across the top
    ui_y = RY + 50
    cell(root, "activity_bar", "Activity Bar",                  60,  ui_y, 130, 80, N_UI)
    cell(root, "sidebar",      "Sidebar\n(Org / Console\n/ Workflow / Inspect)", 210, ui_y, 160, 80, N_UI)
    cell(root, "main_area",    "Main Area\n(Dashboard / Canvas)", 390, ui_y, 200, 80, N_UI)
    cell(root, "panel",        "Panel\n(xterm.js Terminal\n/ Output / Events)", 610, ui_y, 200, 80, N_UI)
    cell(root, "chat_panel",   "AI Chat\nSidepanel",            830, ui_y, 140, 80, N_UI)

    # State layer — below UI
    st_y = RY + 160
    cell(root, "zustand",   "Zustand Stores\n(UI State)",       60,  st_y, 160, 60, N_STATE)
    cell(root, "ipc_hooks", "IPC Hooks\n(window.electronAPI)",  260, st_y, 200, 60, N_IPC)

    # Security note
    cell(root, "sec_renderer", (
        "contextIsolation = true\n"
        "nodeIntegration = false\n"
        "sandbox = true"
    ), 1300, RY + 50, 210, 80, N_SECURITY)

    # ════════════════════════════════════════════
    # IPC BOUNDARY  (y=330..370)
    # ════════════════════════════════════════════
    IPC_Y = 345
    cell(root, "ipc_boundary", (
        '<b>contextBridge  (IPC)</b>'
    ), 40, IPC_Y, 1500, 30,
        "rounded=0;whiteSpace=wrap;html=1;fillColor=#f8cecc;"
        "strokeColor=#b85450;strokeWidth=2;fontColor=#b85450;"
        "fontSize=12;fontStyle=1;")

    # ════════════════════════════════════════════
    # MAIN PROCESS  (y=390..900)
    # ════════════════════════════════════════════
    MY = 390
    cell(root, "grp_main",
         "Electron Main Process  (Node.js · TypeScript)",
         40, MY, 1500, 540, GRP_MAIN)

    # ── IPC Handlers (top of main) ──
    ih_y = MY + 50
    cell(root, "ipc_handlers", "IPC Handlers\n(run / workflow\n/ inspector)", 60, ih_y, 180, 70, N_IPC)

    # ── Services column (left) ──
    svc_y = MY + 145
    cell(root, "grp_services", "Services", 60, svc_y, 200, 280, GRP_SUB)
    cell(root, "svc_config",    "ConfigReader",           80,  svc_y + 40,  160, 40, N_SVC)
    cell(root, "svc_event",     "EventBroker\n(IPC Push)", 80, svc_y + 95,  160, 45, N_SVC)
    cell(root, "svc_dashboard", "DashboardService",       80,  svc_y + 155, 160, 40, N_SVC)
    cell(root, "svc_inspector", "InspectorService",       80,  svc_y + 210, 160, 40, N_SVC)
    cell(root, "svc_filewatch", "FileWatcher\n/ BackupService", 80, svc_y + 260, 160, 45, N_SVC) # shifted down

    # ── Worker Threads (center) ──
    wk_y = MY + 50
    cell(root, "grp_workers", "Worker Threads", 290, wk_y, 470, 180, GRP_WORKER)
    cell(root, "run_orch",     "RunOrchestrator\n(PID Registry\n/ CLI Spawn)",  310, wk_y + 40, 200, 60, N_WORKER)
    cell(root, "workflow_eng", "WorkflowEngine\n(State Machine\n/ Fan-out)",    540, wk_y + 40, 200, 60, N_WORKER)
    cell(root, "log_transform","LogTransformer\n(50MB Ring Buffer\n/ Adaptive Flush)", 310, wk_y + 120, 430, 45, N_WORKER)

    # ── CLI Engine Adapters (center-bottom) ──
    cli_y = MY + 260
    cell(root, "grp_cli", "CLI Engine Adapters", 290, cli_y, 470, 160, GRP_SUB)
    cell(root, "cli_iface",  "EngineAdapter\n«interface»", 310, cli_y + 35, 150, 45,
         N_ADAPTER + "fontStyle=2;")  # italic for interface
    cell(root, "cli_codex",  "CodexEngine",            490, cli_y + 35,  130, 40, N_ADAPTER)
    cell(root, "cli_gemini", "GeminiEngine",           630, cli_y + 35,  130, 40, N_ADAPTER)
    cell(root, "cli_opencode",   "OpenCodeEngine\n(Phase 5)", 490, cli_y + 95, 130, 45, N_ADAPTER + "strokeDasharray=8 4;")
    cell(root, "cli_claudecode", "ClaudeCodeEngine\n(Phase 5)", 630, cli_y + 95, 130, 45, N_ADAPTER + "strokeDasharray=8 4;")

    # ── Stores (right) ──
    db_y = MY + 50
    cell(root, "grp_stores", "Stores  (better-sqlite3 · WAL)", 800, db_y, 250, 250, GRP_SUB)
    cell(root, "store_run",      "RunStore",       820, db_y + 40,  210, 70, N_DB)
    cell(root, "store_workflow", "WorkflowStore",  820, db_y + 130, 210, 70, N_DB)

    # ── Security note for Main ──
    cell(root, "sec_main", (
        "ALLOWED_COMMANDS:\n"
        "['codex', 'gemini']\n"
        "shell: false\n"
        "Env sanitization"
    ), 1300, MY + 50, 210, 90, N_SECURITY)

    # ════════════════════════════════════════════
    # EXTERNAL (bottom)
    # ════════════════════════════════════════════
    ext_y = 960
    cell(root, "ext_codex_cli", "codex CLI",  310, ext_y, 130, 40,
         "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#FFFFFF;"
         "fillColor=#333333;strokeColor=#000000;strokeWidth=1.5;")
    cell(root, "ext_gemini_cli", "gemini CLI", 490, ext_y, 130, 40,
         "rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontColor=#FFFFFF;"
         "fillColor=#333333;strokeColor=#000000;strokeWidth=1.5;")
    cell(root, "ext_sqlite", "SQLite DB\n(~/Library/Application Support/)", 820, ext_y, 250, 45,
         "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;"
         "size=15;fontSize=10;fontColor=#000000;fillColor=#f5f5f5;"
         "strokeColor=#999999;strokeWidth=1.5;")

    # ════════════════════════════════════════════
    # LEGEND
    # ════════════════════════════════════════════
    lg_y = 960
    cell(root, "legend", (
        '<b>Legend</b><br/>'
        '<font color="#9673a6">■</font> UI Components  '
        '<font color="#d6b656">■</font> State  '
        '<font color="#b85450">■</font> IPC  '
        '<font color="#82b366">■</font> Services  '
        '<font color="#6c8ebf">■</font> Adapters  '
        '<font color="#d79b00">■</font> Workers / DB  '
        '<font color="#333333">■</font> External CLI'
    ), 1100, lg_y, 440, 40,
        "text;html=1;align=left;verticalAlign=middle;fontSize=10;"
        "fontColor=#666666;fillColor=#fafafa;strokeColor=#cccccc;"
        "rounded=1;strokeWidth=1;")

    # ════════════════════════════════════════════
    # EDGES
    # ════════════════════════════════════════════

    # Renderer: UI → State
    edge(root, "activity_bar", "sidebar", E_NORMAL)
    edge(root, "sidebar",      "main_area", E_NORMAL)
    edge(root, "sidebar",      "panel", E_NORMAL)
    edge(root, "main_area",    "zustand", E_NORMAL)
    edge(root, "panel",        "zustand", E_NORMAL)
    edge(root, "chat_panel",   "zustand", E_NORMAL)
    edge(root, "zustand",      "ipc_hooks", E_NORMAL)

    # IPC boundary crossing (thick red)
    edge(root, "ipc_hooks",    "ipc_boundary", E_IPC, "invoke")
    edge(root, "ipc_boundary", "ipc_handlers", E_IPC, "handle")

    # Main: IPC Handlers → orchestrators & services
    edge(root, "ipc_handlers", "run_orch",     E_NORMAL)
    edge(root, "ipc_handlers", "workflow_eng", E_NORMAL)
    edge(root, "ipc_handlers", "svc_config",   E_NORMAL)
    edge(root, "ipc_handlers", "svc_inspector",E_NORMAL)
    edge(root, "ipc_handlers", "svc_dashboard",E_NORMAL)

    # WorkflowEngine delegates to RunOrchestrator
    edge(root, "workflow_eng", "run_orch", E_NORMAL, "delegate")

    # RunOrchestrator → CLI adapters
    edge(root, "run_orch",  "cli_iface", E_NORMAL, "spawn")
    edge(root, "cli_iface", "cli_codex",  E_NORMAL)
    edge(root, "cli_iface", "cli_gemini", E_NORMAL)

    # CLI → LogTransformer → EventBroker → IPC
    edge(root, "cli_iface",    "log_transform", E_NORMAL, "stdout/stderr")
    edge(root, "log_transform","svc_event",     E_NORMAL, "parsed logs")
    edge(root, "svc_event",    "ipc_handlers",  E_NORMAL, "push")

    # Data flows to stores (dashed)
    edge(root, "run_orch",     "store_run",      E_DATA, "write")
    edge(root, "workflow_eng", "store_workflow",  E_DATA, "write")

    # Services internal
    edge(root, "svc_inspector", "svc_filewatch", E_NORMAL)

    # External
    edge(root, "cli_codex",     "ext_codex_cli",  E_NORMAL, "child_process.spawn")
    edge(root, "cli_gemini",    "ext_gemini_cli", E_NORMAL, "child_process.spawn")
    edge(root, "store_run",     "ext_sqlite",     E_DATA)
    edge(root, "store_workflow","ext_sqlite",     E_DATA)

    # ── Write file ──
    tree = ET.ElementTree(mxfile)
    ET.indent(tree, space="  ", level=0)
    out = "document/diagram-system-architecture.drawio"
    tree.write(out, encoding="utf-8", xml_declaration=True)
    print(f"✅ Saved: {out}")


if __name__ == "__main__":
    generate()
