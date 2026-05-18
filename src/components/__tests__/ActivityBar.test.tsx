/**
 * ActivityBar 테마 선택기 테스트
 *
 * 테스트 대상: src/components/layout/ActivityBar.tsx
 * 테스트 방식: 유닛 테스트 (소스 코드 정적 분석)
 * 주요 검증 시나리오:
 * - useUIStore를 통한 테마 상태 임포트 여부
 * - 10개 테마 옵션(Aurora, Cyber Fusion 등)이 모두 렌더링되는지 여부
 * - 테마 버튼이 푸터에 존재하는지 여부
 * - setTheme 호출 후 드롭다운이 닫히는지 여부
 * - 현재 활성화된 테마의 하이라이트 처리
 * - 외부 클릭 시 드롭다운 닫힘 처리
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const LAYOUT_DIR = path.resolve(__dirname, '../layout');
const ACTIVITYBAR_FILE = path.join(LAYOUT_DIR, 'ActivityBar.tsx');

describe('ActivityBar theme picker fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should import useUIStore for theme state', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');
    expect(source).toContain('useUIStore');
  });

  it('should render theme dropdown with all 10 theme options', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');

    const expectedThemes = [
      'Aurora', 'Cyber Fusion', 'Night Ops', 'Matrix Green',
      'Dracula Pro', 'Glass Enterprise', 'Minimal Pro', 'Paper',
      'Solarized Light', 'Nord',
    ];

    for (const theme of expectedThemes) {
      expect(source).toContain(theme);
    }
  });

  it('should have a theme button in the footer', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');
    expect(source).toContain('Theme');
    expect(source).toContain('Select Theme');
    expect(source).toContain('ICONS.theme');
  });

  it('should call setTheme on selection and close dropdown', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');
    const themeOptionMatch = source.match(/onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*setTheme\([^}]+setThemeOpen\(false\)[^}]*\}\s*\}/);
    expect(themeOptionMatch).not.toBeNull();

    const optionHandler = themeOptionMatch![0];
    expect(optionHandler).toContain('setTheme(');
    expect(optionHandler).toContain('setThemeOpen(false)');
  });

  it('should highlight the currently active theme', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');
    expect(source).toContain("theme === t.id");
    expect(source).toContain("activity-bar__theme-option");
    expect(source).toContain("active");
  });

  it('should close dropdown on outside click', () => {
    const source = fs.readFileSync(ACTIVITYBAR_FILE, 'utf-8');
    expect(source).toContain("mousedown");
    expect(source).toContain("contains(e.target");
    expect(source).toContain("setThemeOpen(false)");
  });
});
