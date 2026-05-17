export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', py: 'python', go: 'go', rs: 'rust',
    java: 'java', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', toml: 'ini', sh: 'shell', bash: 'shell', sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}

export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const ENGINE_META: Record<string, { label: string; color: string; badge: string }> = {
  codex: { label: 'Codex CLI', color: 'var(--accent-primary)', badge: 'C' },
  gemini: { label: 'Gemini CLI', color: 'var(--status-success)', badge: 'G' },
  opencode: { label: 'OpenCode CLI', color: 'var(--status-info)', badge: 'O' },
  claudecode: { label: 'ClaudeCode CLI', color: 'var(--status-warning)', badge: 'CC' },
  all: { label: 'All Engines', color: 'var(--text-tertiary)', badge: '*' },
};

export function getEngineMeta(engine: string | undefined): { label: string; color: string; badge: string } {
  return ENGINE_META[engine ?? ''] ?? { label: engine ?? 'Unknown', color: 'var(--text-tertiary)', badge: '?' };
}

export const DEPT_COLORS: Record<string, string> = {
  'dev': 'var(--accent-primary)',
  'engineering': 'var(--accent-primary)',
  'strategy': 'var(--status-success)',
  'platform': 'var(--status-info)',
  'quality': 'var(--status-warning)',
  'content': 'var(--accent-tertiary)',
  'ops': 'var(--status-error)',
  'executive': 'var(--accent-secondary)',
  'marketing': '#ec4899',
};

export function getDeptColor(dept: string | undefined): string {
  if (!dept) return 'var(--text-tertiary)';
  const key = dept.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(DEPT_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'var(--text-tertiary)';
}

export function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const iconMap: Record<string, string> = {
    ts: '\u{1F5D8}', tsx: '\u{1F5D8}', js: '\u{1F4D2}', jsx: '\u{1F4D2}',
    json: '\u{1F4CB}', md: '\u{1F4DD}', py: '\u{1F40D}', go: '\u{1F537}', rs: '\u{1F980}',
    java: '\u2615', css: '\u{1F3A8}', scss: '\u{1F3A8}', html: '\u{1F310}', xml: '\u{1F4C4}',
    yaml: '\u{1F4CB}', yml: '\u{1F4CB}', toml: '\u2699', sh: '\u26A1', bash: '\u26A1', sql: '\u{1F5C4}',
  };
  return iconMap[ext] ?? '\u{1F4C4}';
}

export const FILE_KIND_LABELS: Record<string, string> = {
  'agent-toml': 'Agent Config (TOML)',
  'agent-json': 'Agent Config (JSON)',
  'skill-md': 'Skill Definition',
  'reference': 'Reference Doc',
  'script': 'Script',
  'asset': 'Asset',
};

export function getKindIcon(kind: string): string {
  const map: Record<string, string> = {
    'agent-toml': '\u2699',
    'agent-json': '\u2699',
    'skill-md': '\u{1F4DD}',
    'reference': '\u{1F4DA}',
    'script': '\u26A1',
    'asset': '\u{1F4E6}',
  };
  return map[kind] ?? '\u{1F4C4}';
}
