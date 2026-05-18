/**
 * Inspector panel utility functions: language detection from file extension,
 * locale-aware time formatting, byte-size display, engine metadata/labels,
 * department color mappings, file-type icons, and file-kind labels.
 */

/**
 * 파일 확장자로 프로그래밍 언어 감지
 * @param filePath 파일 경로
 * @returns 감지된 언어 식별자 (기본값: 'plaintext')
 */
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

/**
 * ISO 날짜 문자열을 한국어 로캘 형식으로 변환
 * @param iso ISO 8601 날짜 문자열 또는 null
 * @returns 포맷된 시간 문자열
 */
export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 바이트 수를 사람이 읽기 쉬운 형식으로 변환 (B/KB/MB)
 * @param bytes 바이트 숫자
 * @returns 포맷된 크기 문자열
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 엔진별 메타 정보 (라벨, 색상, 배지 문자)
 * - codex / gemini / opencode / claudecode / all
 */
export const ENGINE_META: Record<string, { label: string; color: string; badge: string }> = {
  gemini: { label: 'Gemini CLI', color: 'var(--status-success)', badge: 'G' },
  opencode: { label: 'OpenCode CLI', color: 'var(--status-info)', badge: 'O' },
  claudecode: { label: 'ClaudeCode CLI', color: 'var(--status-warning)', badge: 'CC' },
  all: { label: 'All Engines', color: 'var(--text-tertiary)', badge: '*' },
};

/**
 * 엔진 식별자로 메타 정보 조회
 * @param engine 엔진 식별자
 * @returns 엔진 메타 정보 (label, color, badge) 또는 기본값
 */
export function getEngineMeta(engine: string | undefined): { label: string; color: string; badge: string } {
  return ENGINE_META[engine ?? ''] ?? { label: engine ?? 'Unknown', color: 'var(--text-tertiary)', badge: '?' };
}

/**
 * 부서별 색상 매핑
 * - dev/engineering / strategy / platform / quality / content / ops / executive / marketing
 */
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

/**
 * 부서명으로 색상 조회 (부분 문자열 매칭)
 * @param dept 부서명
 * @returns CSS 색상 변수값
 */
export function getDeptColor(dept: string | undefined): string {
  if (!dept) return 'var(--text-tertiary)';
  const key = dept.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(DEPT_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'var(--text-tertiary)';
}

/**
 * 파일 확장자에 해당하는 아이콘 반환
 * @param filePath 파일 경로
 * @returns 유니코드 아이콘 문자
 */
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

/**
 * 파일 종류별 라벨 매핑
 * - agent-toml / agent-json / skill-md / reference / script / asset
 */
export const FILE_KIND_LABELS: Record<string, string> = {
  'agent-toml': 'Agent Config (TOML)',
  'agent-json': 'Agent Config (JSON)',
  'skill-md': 'Skill Definition',
  'reference': 'Reference Doc',
  'script': 'Script',
  'asset': 'Asset',
};

/**
 * 파일 종류에 해당하는 아이콘 반환
 * @param kind 파일 종류 식별자
 * @returns 유니코드 아이콘 문자
 */
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
