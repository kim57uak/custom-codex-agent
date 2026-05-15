# Design System — Agent Orchestrator Desktop

**Target:** Electron Desktop App (Cursor/Codex Desktop style)
**Platforms:** macOS (primary), Windows
**Visual reference:** `document/layout-design-mockup.html` — interactive Aurora Dark theme demo

---

## 1. Layout System

```
┌─────────┬─────────────────────────────────────┬────────────┐
│Activity │  Sidebar          │  Main Area      │ Chat       │
│ Bar     │  ┌──────────────┐ │  ┌───────────┐  │ Sidepanel  │
│         │  │ 탭 헤더      │ │  │ View 상세 │  │ ┌───────┐  │
│ [Org]   │  ├──────────────┤ │  │           │  │ │Chat   │  │
│ [Dash]  │  │ 뷰에 따른    │ │  │ - Console │  │ │히스토리│  │
│ [Con]   │  │ 콘텐츠       │ │  │ - Dashboard│  │ ├───────┤  │
│ [Wkfl]  │  │ - 트리/리스트│ │  │ - Workflow│  │ │입력   │  │
│ [Insp]  │  │ - 설정 폼    │ │  │ - Inspector│  │ │       │  │
│         │  │ - 파일 브라우저│ │  │ - Empty   │  │ └───────┘  │
│         │  └──────────────┘ │  └───────────┘  │            │
├─────────┴─────────────────────────────────────┴────────────┤
│  Panel                                                     │
│  ┌──────────┬──────────┬──────────┬────────────────────┐   │
│  │ Terminal │  Output  │  Events  │  Problems          │   │
│  └──────────┴──────────┴──────────┴────────────────────┘   │
├────────────────────────────────────────────────────────────┤
│  Status Bar (28px)                                          │
│  ● Codex │ ● Gemini │ ★ 2 active │           v0.1.0      │
└────────────────────────────────────────────────────────────┘
```

### Grid Definition

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--activity-bar-w) var(--sidebar-w) 1fr var(--chat-w);
  grid-template-rows: 1fr var(--panel-min-h) var(--status-bar-h);
  grid-template-areas:
    "activity sidebar main chat"
    "activity panel   panel panel"
    "status   status  status status";
}
```

### Dimensions

| Element | Width | Min | Resizable |
|---------|-------|-----|-----------|
| Activity Bar | 48px | 48px | No |
| Sidebar | 250px | 170px | Yes (drag handle) |
| Main Area | 1fr | 320px | — |
| Chat Sidepanel | 320px | 0 (collapsible) | Yes |
| Panel | 1fr × 200px | 100px | Yes (drag handle) |
| Status Bar | 1fr × 28px | 28px | No |

### Collapse States

- Sidebar collapse: width → 0, border-right hidden
- Chat collapse: width → 0, border-left hidden
- Both collapse: 48px Activity Bar + full Main Area
- Panel collapse: height → 0, hidden
- Toggle icons: Activity Bar bottom two buttons

### Breakpoints

| Viewport | Behavior |
|----------|----------|
| > 1024px | Full 4-column layout |
| ≤ 1024px | Chat hidden (toggle via Activity Bar) |
| ≤ 768px | Sidebar auto-collapsed, panel stacked vertically |

---

## 2. Design Tokens — 24 CSS Variables

```css
:root {
  /* Background */
  --bg-primary:        #...;   /* main background */
  --bg-secondary:      #...;   /* sidebar, panel tabs */
  --bg-tertiary:       #...;   /* status bar, panel header */
  --bg-surface:        #...;   /* cards, inputs, hover states */
  --bg-overlay:        rgba(0,0,0,0.5);  /* modal backdrops */

  /* Text */
  --text-primary:      #...;   /* headings, body */
  --text-secondary:    #...;   /* labels, meta */
  --text-tertiary:     #...;   /* placeholders, disabled */
  --text-inverse:      #...;   /* text on accent bg */

  /* Accent */
  --accent-primary:    #...;   /* primary action, active tab */
  --accent-secondary:  #...;   /* hover state */
  --accent-tertiary:   #...;   /* selection highlight */
  --accent-border:     #...;   /* focused input border */

  /* Borders */
  --border-primary:    #...;   /* panel borders */
  --border-secondary:  #...;   /* inner dividers */

  /* Status */
  --status-success:    #22c55e;
  --status-warning:    #f59e0b;
  --status-error:      #ef4444;
  --status-info:       #3b82f6;
  --status-running:    #a855f7;  /* pulse animation */

  /* Misc */
  --focus-ring:        rgba(...);   /* input focus glow */
  --selection-bg:      rgba(...);   /* list item selection */
  --shadow-sm:         0 1px 2px rgba(...);
  --shadow-md:         0 4px 6px rgba(...);
}
```

---

## 3. All 10 Themes

### 3.1 Cyber Fusion (Dark)
```
--bg-primary:        #0a0a0a
--bg-secondary:      #1a1a1a
--bg-tertiary:       #0d0d0d
--bg-surface:        #222222
--bg-overlay:        rgba(0,0,0,0.6)
--text-primary:      #00ff41
--text-secondary:    #00cc33
--text-tertiary:     #009900
--text-inverse:      #0a0a0a
--accent-primary:    #00ff41
--accent-secondary:  #33ff66
--accent-tertiary:   #66ff99
--accent-border:     #00cc33
--border-primary:    #1a3a1a
--border-secondary:  #0d1f0d
--focus-ring:        rgba(0,255,65,0.3)
--selection-bg:      rgba(0,255,65,0.12)
--shadow-sm:         0 1px 2px rgba(0,0,0,0.5)
--shadow-md:         0 4px 6px rgba(0,0,0,0.6)
Font: DM Mono (mono-first aesthetic)
Animation: CRT scan-line overlay (optional)
```

### 3.2 Night Ops (Dark)
```
--bg-primary:        #0a0e1a
--bg-secondary:      #111827
--bg-tertiary:       #0d1422
--bg-surface:        #1a2332
--bg-overlay:        rgba(0,0,0,0.5)
--text-primary:      #e2e8f0
--text-secondary:    #94a3b8
--text-tertiary:     #64748b
--text-inverse:      #0a0e1a
--accent-primary:    #fbbf24  /* gold */
--accent-secondary:  #fcd34d
--accent-tertiary:   #fde68a
--accent-border:     #d97706
--border-primary:    #1e293b
--border-secondary:  #172033
--focus-ring:        rgba(251,191,36,0.3)
--selection-bg:      rgba(251,191,36,0.12)
--shadow-sm:         0 1px 2px rgba(0,0,0,0.4)
--shadow-md:         0 4px 6px rgba(0,0,0,0.5)
```

### 3.3 Matrix Green (Dark)
```
--bg-primary:        #000000
--bg-secondary:      #0a0a0a
--bg-tertiary:       #050505
--bg-surface:        #111111
--bg-overlay:        rgba(0,10,0,0.6)
--text-primary:      #00ff00
--text-secondary:    #00cc00
--text-tertiary:     #008800
--text-inverse:      #000000
--accent-primary:    #00ff00
--accent-secondary:  #33ff33
--accent-tertiary:   #66ff66
--accent-border:     #00cc00
--border-primary:    #002200
--border-secondary:  #001100
--focus-ring:        rgba(0,255,0,0.3)
--selection-bg:      rgba(0,255,0,0.10)
--shadow-sm:         0 1px 2px rgba(0,0,0,0.6)
--shadow-md:         0 4px 6px rgba(0,0,0,0.7)
```

### 3.4 Aurora (Dark)
```css
:root[data-theme="aurora"] {
  --bg-primary: #0d0d1a;
  --bg-secondary: #1a1a2e;
  --bg-tertiary: #16213e;
  --bg-surface: #1e1e36;
  --bg-overlay: rgba(0,0,0,0.5);
  --text-primary: #e0e0ff;
  --text-secondary: #a0a0cc;
  --text-tertiary: #7070aa;
  --text-inverse: #0d0d1a;
  --accent-primary: #a855f7;
  --accent-secondary: #c084fc;
  --accent-tertiary: #e9d5ff;
  --accent-border: #7c3aed;
  --border-primary: #2a2a4a;
  --border-secondary: #1f1f3a;
  --status-success: #22c55e;
  --status-warning: #f59e0b;
  --status-error: #ef4444;
  --status-info: #3b82f6;
  --status-running: #a855f7;
  --focus-ring: rgba(168,85,247,0.4);
  --selection-bg: rgba(168,85,247,0.15);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
}
```

### 3.5 Dracula Pro (Dark)
```
--bg-primary:        #282a36
--bg-secondary:      #21222c
--bg-tertiary:       #1c1d26
--bg-surface:        #343746
--bg-overlay:        rgba(0,0,0,0.4)
--text-primary:      #f8f8f2
--text-secondary:    #babaca
--text-tertiary:     #8889a0
--text-inverse:      #282a36
--accent-primary:    #bd93f9
--accent-secondary:  #d6b4fc
--accent-tertiary:   #e9d5ff
--accent-border:     #9580ff
--border-primary:    #3d4055
--border-secondary:  #313244
--status-success:    #50fa7b
--status-warning:    #f1fa8c
--status-error:      #ff5555
--status-info:       #8be9fd
--focus-ring:        rgba(189,147,249,0.35)
--selection-bg:      rgba(189,147,249,0.15)
```

### 3.6 Glass Enterprise (Light)
```
--bg-primary:        #f0f2f5
--bg-secondary:      #ffffff
--bg-tertiary:       #f8f9fa
--bg-surface:        rgba(255,255,255,0.7)
--bg-overlay:        rgba(0,0,0,0.1)
--text-primary:      #1a1a2e
--text-secondary:    #6b7280
--text-tertiary:     #9ca3af
--text-inverse:      #ffffff
--accent-primary:    #6366f1  /* indigo */
--accent-secondary:  #818cf8
--accent-tertiary:   #c7d2fe
--accent-border:     #4f46e5
--border-primary:    #e5e7eb
--border-secondary:  #f3f4f6
--status-success:    #10b981
--status-warning:    #f59e0b
--status-error:      #ef4444
--status-info:       #3b82f6
--focus-ring:        rgba(99,102,241,0.3)
--selection-bg:      rgba(99,102,241,0.10)
```

### 3.7 Minimal Pro (Light)
```
--bg-primary:        #ffffff
--bg-secondary:      #fafafa
--bg-tertiary:       #f5f5f5
--bg-surface:        #f5f5f5
--bg-overlay:        rgba(0,0,0,0.05)
--text-primary:      #171717
--text-secondary:    #737373
--text-tertiary:     #a3a3a3
--text-inverse:      #ffffff
--accent-primary:    #2563eb
--accent-secondary:  #3b82f6
--accent-tertiary:   #bfdbfe
--accent-border:     #1d4ed8
--border-primary:    #e5e5e5
--border-secondary:  #f0f0f0
--status-success:    #059669
--status-warning:    #d97706
--status-error:      #dc2626
--status-info:       #2563eb
--focus-ring:        rgba(37,99,235,0.25)
--selection-bg:      rgba(37,99,235,0.08)
Font: Inter / SF Pro
```

### 3.8 Paper (Light)
```
--bg-primary:        #f5f0e8
--bg-secondary:      #faf6ee
--bg-tertiary:       #efe9dc
--bg-surface:        #f0ebe0
--bg-overlay:        rgba(0,0,0,0.06)
--text-primary:      #3d3229
--text-secondary:    #7a6b5d
--text-tertiary:     #a69482
--text-inverse:      #faf6ee
--accent-primary:    #b8860b  /* dark goldenrod */
--accent-secondary:  #d4a843
--accent-tertiary:   #f0d78c
--accent-border:     #9a7209
--border-primary:    #ddd6c8
--border-secondary:  #e8e0d4
--status-success:    #4a7c3f
--status-warning:    #b8860b
--status-error:      #a83232
--status-info:       #5b7fa5
--focus-ring:        rgba(184,134,11,0.25)
--selection-bg:      rgba(184,134,11,0.10)
```

### 3.9 Solarized Light
```
--bg-primary:        #fdf6e3
--bg-secondary:      #eee8d5
--bg-tertiary:       #e4ddc8
--bg-surface:        #f5efdc
--bg-overlay:        rgba(0,0,0,0.05)
--text-primary:      #073642
--text-secondary:    #586e75
--text-tertiary:     #839496
--text-inverse:      #fdf6e3
--accent-primary:    #268bd2
--accent-secondary:  #58a6df
--accent-tertiary:   #b4d6f0
--accent-border:     #2075b5
--border-primary:    #d5cfb8
--border-secondary:  #e8e2cc
--status-success:    #859900
--status-warning:    #b58900
--status-error:      #dc322f
--status-info:       #268bd2
--focus-ring:        rgba(38,139,210,0.25)
--selection-bg:      rgba(38,139,210,0.10)
```

### 3.10 Nord (Dark/Light)

Dark variant:
```
--bg-primary:        #2e3440
--bg-secondary:      #3b4252
--bg-tertiary:       #434c5e
--bg-surface:        #3b4252
--bg-overlay:        rgba(0,0,0,0.3)
--text-primary:      #eceff4
--text-secondary:    #d8dee9
--text-tertiary:     #81a1c1
--text-inverse:      #2e3440
--accent-primary:    #88c0d0  /* ice blue */
--accent-secondary:  #8fbcbb
--accent-tertiary:   #a3be8c
--accent-border:     #5e81ac
--border-primary:    #4c566a
--border-secondary:  #424b5e
--status-success:    #a3be8c
--status-warning:    #ebcb8b
--status-error:      #bf616a
--status-info:       #81a1c1
--focus-ring:        rgba(136,192,208,0.3)
--selection-bg:      rgba(136,192,208,0.15)
```

---

## 4. Typography

### Font Stack

```css
--font-ui: 'Inter', 'SF Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'DM Mono', 'SF Mono', 'Cascadia Code', monospace;
```

### Type Scale

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Activity Bar icon | — | 20px | — | --text-secondary |
| Sidebar tab header | UI | 11px | 600 | --text-secondary |
| Sidebar content | UI | 13px | 400 | --text-primary |
| Section header | UI | 11px | 600 | --text-tertiary |
| Main Area title | UI | 24px | 600 | --text-primary |
| Main Area body | UI | 14px | 400 | --text-primary |
| Panel tab header | UI | 11px | 600 | --text-secondary |
| Panel content | Mono | 12px | 400 | --text-primary |
| Chat message | UI | 13px | 400 | --text-primary |
| Status Bar | UI | 12px | 400 | --text-secondary |
| Tree item | UI | 13px | 400 | --text-primary |
| Metric value | UI | 28px | 700 | --text-primary |
| Metric label | UI | 11px | 600 | --text-tertiary |
| Button | UI | 13px | 600 | white |
| Badge | UI | 10px | 500 | --text-secondary |

---

## 5. Spacing System (4px Grid)

```css
--space-1:  4px;   /* icon inner padding */
--space-2:  8px;   /* component padding */
--space-3:  12px;  /* list item gap */
--space-4:  16px;  /* section gap */
--space-5:  24px;  /* card padding */
--space-6:  32px;  /* view margin */
```

---

## 6. Animation & Transition

| Action | Property | Duration | Easing |
|--------|----------|----------|--------|
| Tab switch | opacity + transform | 150ms | ease-out |
| Panel resize | width/height | 0ms | instant |
| Sidebar toggle | width | 200ms | ease-in-out |
| Chat toggle | width | 200ms | ease-in-out |
| State change (loading→done) | opacity | 300ms | ease |
| Dropdown/menu | opacity + transform | 100ms | ease-out |
| Tooltip | opacity | 80ms | ease-in |
| Hover (icon/tree) | background | 80ms | ease |
| Pulse (running) | opacity | 1.5s | infinite step-end |
| Spinner | rotate | 0.8s | linear infinite |

> Terminal output, log streaming, event updates: no animation (performance first).

---

## 7. Component Library

### 7.1 Activity Bar

```
┌──────────────┐
│  [icon]      │  ← 40×40px, rounded 3px, cursor pointer
│  [icon]      │  ← active: accent color + left indicator (3px bar)
│  [icon] .badge│  ← top-right 14px dot (status-error for alerts)
│   .         │
│  [spacer]    │  ← flex: 1
│  [collapse]  │  ← toggle sidebar / chat
│  [settings]  │
└──────────────┘
Width: 48px
Padding: 8px top/bottom, 4px gap between icons
Icons: 20px SVG (feather-style, 2px stroke)
```

### 7.2 Sidebar

```
┌──────────────────┐
│ Tab1  Tab2  Tab3  │  ← 11px uppercase, 600 weight
├──────────────────┤
│ Section Header   │  ← 11px uppercase, 600, --text-tertiary
│ ┌─ Tree Item ──┐ │  ← 13px, hover bg, active accent
│ │ ▸ [icon] label │  │  status dot (6px): green/yellow/purple/gray
│ │   ▸ sub item   │  │  ← nested indent 16px
│ │   ▸ sub item   │  │
│ └──────────────┘ │
│ Section Header   │
│ ┌─ Item ───────┐ │
│ │ ● Codex CLI  │ │  ← engine list: dot + name + version
│ │ ● Gemini CLI │ │
│ └──────────────┘ │
└──────────────────┘
Width: 250px (resizable, min 170px)
Tab header height: 28px
```

### 7.3 Tree Item

States:
- **Default:** `color: --text-primary`, `background: transparent`
- **Hover:** `background: --bg-surface`
- **Active/Selected:** `background: --selection-bg`, `color: --accent-tertiary`
- **Disabled:** `color: --text-tertiary`, no hover effect

Status dot colors:
| Dot | Meaning |
|-----|---------|
| Green (--status-success) | Online / healthy |
| Yellow (--status-warning) | Warning / degraded |
| Purple (--status-running) | Running (pulse animation) |
| Gray (--text-tertiary) | Offline / unavailable |

### 7.4 Main Area

```
┌──────────────────────────────────────────┐
│ Title              Subtitle              │  ← toolbar (36px)
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  View content                    │    │  ← flex: 1, overflow-y
│  │  - Console (run config + xterm)  │    │
│  │  - Dashboard (metric cards)      │    │
│  │  - Workflow (SVG canvas)         │    │
│  │  - Inspector (file browser +     │    │
│  │    Monaco Editor)                │    │
│  │  - Organization (org chart)      │    │
│  └──────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

### 7.5 Panel

```
┌──────────────────────────────────────────┐
│ TERMINAL  OUTPUT(3)  EVENTS  PROBLEMS(1) │  ← 28px tab bar
├──────────────────────────────────────────┤
│ [Resize handle: 4px, ns-resize]          │  ← top of panel
│ Terminal / Output / Events / Problems    │
│ content (mono font, 12px)                │
│                                          │
│ 14:32:28 Tests passed: 12/12             │
│ 14:32:28 Run completed (1m 12s)          │
└──────────────────────────────────────────┘
```

### 7.6 Chat Sidepanel

```
┌──────────────────┐
│ AI Chat          │  ← header 12px uppercase
├──────────────────┤
│                  │
│ ┌── Agent ────┐ │  ← bubble: bg-secondary, border
│ │ Hello!...   │ │
│ └─────────────┘ │
│ ┌── User ─────┐ │  ← bubble: accent-primary, white text
│ │ Show runs   │ │
│ └─────────────┘ │
│ ┌── Agent ────┐ │
│ │ 2 active... │ │
│ └─────────────┘ │
│                  │
├──────────────────┤
│ [input]     [▶]  │  ← 44px input row
└──────────────────┘
Width: 320px
Max bubble width: 90%
```

### 7.7 Status Bar

```
┌────────────────────────────────────────────────┐
│ ● Codex CLI │ ● Gemini CLI │ ★ 2 active  │ v0.1.0 │
└────────────────────────────────────────────────┘
Height: 28px
Background: --bg-tertiary
Left: engine status dots + names
Center: job count with star icon
Right: version number
```

---

## 8. Interaction States

Every view must implement 4 states:

```
FEATURE │ LOADING   │ EMPTY      │ ERROR      │ SUCCESS
────────┼───────────┼────────────┼────────────┼──────────
Console │ Spinner   │ "Select an│ "CLI not  │ Terminal
        │           │ engine to │ found"     │ output
        │           │ begin"    │ + retry    │
────────┼───────────┼────────────┼────────────┼──────────
Dashboard│ Skeleton  │ "No runs  │ "Data load│ Metric
        │ cards     │ yet"      │ failed"    │ cards
        │           │ + CTA     │ + retry    │
────────┼───────────┼────────────┼────────────┼──────────
Workflow│ Spinner   │ "No       │ "Canvas   │ SVG
        │           │ workflows"│ error"     │ graph
        │           │ + CTA     │ + reload   │
────────┼───────────┼────────────┼────────────┼──────────
Org     │ Skeleton  │ "No agents│ "Network   │ Tree
        │ tree      │ config'd" │ error"     │ view
        │           │ + CTA     │ + retry    │
────────┼───────────┼────────────┼────────────┼──────────
Inspector│ Spinner   │ "No file  │ "Access    │ Editor
        │           │ selected" │ denied"    │ + browser
        │           │           │ + path fix │
────────┼───────────┼────────────┼────────────┼──────────
Chat    │ "Typing..."│ Empty     │ "Failed to│ Messages
        │           │ state     │ respond"   │
        │           │ prompt     │ + retry    │
```

### Empty State Format

```
┌──────────────────────┐
│                      │
│    [120×120 icon]    │  ← rounded circle, bg-surface, 48px icon
│                      │
│   No runs yet        │  ← h3, 16px, 600 weight
│                      │
│   Description text   │  ← p, 13px, max 280px width
│   of what to do...   │
│                      │
│   [ Configure CLI ]  │  ← CTA button
│                      │
└──────────────────────┘
```

---

## 9. Console View (Core Feature)

```
┌─────────────────────────────────────┐
│ Console         codex-agent         │  ← toolbar
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ Engine: [Gemini CLI ▼]         │ │  ← select
│ │ Workspace: [/Users/...    ]    │ │  ← input
│ │ Prompt: [Refactor auth...] [▶] │ │  ← input + run button
│ └─────────────────────────────────┘ │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ $ gemini -p "Refactor..."     │ │  ← terminal (mono, green)
│ │ [2026-05-14] Initializing...   │ │
│ │ [2026-05-14] Loading context   │ │
│ │ ✓ Created src/auth/jwt.ts      │ │
│ │ ✓ 12 passed, 0 failed          │ │
│ │ $ _                            │ │  ← cursor blink
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**xterm.js integration:**
- Terminal background: `#0a0a14` (fixed, not themed)
- Font: `13px`, mono
- Text: green (#22c55e) for prompt, muted for output
- Error: red (#ef4444)
- Cursor blink animation: 1s step-end

---

## 10. Org View (Detailed)

```
┌─────────────────────────────────────┐
│ Organization         77 Agents · 12 Dept  │
├─────────────────────────────────────┤
│ [stats bar: PC Owner | Router | 12 dept | 77 agents | 110 skills] │
│                                      │
│          ┌──── dolpaks ──────┐      │  ← PC Owner (owner)
│          │ System Owner      │      │  ← gradient bg + accent border
│          └───────────────────┘      │
│                 │                  │
│          ┌──── CEO ────────┐      │
│          │ President       │      │
│          └─────────────────┘      │
│                 │                  │
│         ┌─ router-agent ──┐       │  ← highlighted, accent border
│         │ 111 routes     │       │
│         └─────────────────┘       │
│        /    |    |    \          │
│   ┌─────┐ ┌─────┐ ┌─────┐       │  ← department cards
│   │Exec │ │Strat │ │Eng  │  +3  │     34 agents
│   │     │ │     │ │     │       │
│   └─────┘ └─────┘ └─────┘       │
└─────────────────────────────────────┘
```

---

## 11. Architectural States — IPC Event-Driven UI

```
Renderer Process                 Main Process
─────────────────────            ─────────────────────
┌─ IPC Event Listener ─┐        ┌─ EventBroker ────────┐
│ onProgress(data) ──────→     │ type="progress"      │
│ onComplete(data) ──────→     │ type="complete"      │
│ onError(data) ─────────→     │ type="error"         │
│ onStatusChange(data) ──→     │ type="status"        │
└──────────────────────┘        │ type="log"           │
                                └──────────────────────┘
```

Each IPC event maps to a UI state transition:
- `progress` → update progress bar / terminal output
- `complete` → remove loading, show success state
- `error` → show error state with retry option
- `status` → update engine status dots
- `log` → append to terminal/output panel

---

## 12. Accessibility

| Requirement | Implementation |
|-------------|---------------|
| Keyboard nav | Tab-index all interactive elements, Enter/Space to activate |
| Focus visible | 2px focus-ring on all interactive elements |
| Screen reader | aria-label on icons, role on tree items |
| Color contrast | All text meets WCAG AA (4.5:1 normal, 3:1 large) |
| Touch targets | ≥ 28px minimum tap target |
| Reduced motion | Respect prefers-reduced-motion: disable all animations |
| Font scaling | Use rem/em, not px, for font sizes |
| High contrast | Windows HC mode: remove backgrounds, use underlines for links |

---

## 13. File Structure

```
src/
  styles/
    tokens.css              # CSS variables (all 10 themes)
    layout.css              # Grid shell
    components.css           # Activity Bar, Sidebar, Panel, Chat
    views.css               # Console, Dashboard, Workflow, Inspector, Org
    animations.css          # Keyframes (spin, pulse, shimmer, blink)
  components/
    layout/
      ActivityBar.tsx
      Sidebar.tsx
      MainArea.tsx
      Panel.tsx
      StatusBar.tsx
      ChatSidepanel.tsx
    common/
      ErrorBoundary.tsx
      EmptyState.tsx
      LoadingSpinner.tsx
      TreeItem.tsx
      StatusDot.tsx
  hooks/
    useTheme.ts             # ThemeProvider + localStorage persist
    useIpcEvent.ts          # IPC event → Zustand state
  stores/
    uiStore.ts              # Zustand: theme, sidebar/chat width, active view
```
