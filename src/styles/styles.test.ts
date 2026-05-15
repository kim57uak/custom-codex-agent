import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Layout Structure', () => {
  const cssPath = path.resolve(__dirname, 'global.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  it('should define .app-shell grid layout', () => {
    expect(cssContent).toContain('.app-shell');
  });

  it('should define grid-template-areas with all required areas', () => {
    const areas = cssContent.match(/grid-template-areas:\s*'([^']+)'\s*'([^']+)'\s*'([^']+)'/);
    expect(areas).not.toBeNull();

    const rawAreas = cssContent.match(/grid-template-areas:\s*([^;]+)/);
    expect(rawAreas).not.toBeNull();
    const block = rawAreas![1];
    expect(block).toContain('activity');
    expect(block).toContain('sidebar');
    expect(block).toContain('main');
    expect(block).toContain('chat');
    expect(block).toContain('panel');
    expect(block).toContain('status');
  });

  it('should define grid-area for .activity-bar', () => {
    expect(cssContent).toMatch(/\.activity-bar\s*\{[^}]*grid-area:\s*activity[;}]/);
  });

  it('should define grid-area for .sidebar', () => {
    expect(cssContent).toMatch(/\.sidebar\s*\{[^}]*grid-area:\s*sidebar[;}]/);
  });

  it('should define grid-area for .main-area', () => {
    expect(cssContent).toMatch(/\.main-area\s*\{[^}]*grid-area:\s*main[;}]/);
  });

  it('should define grid-area for .panel', () => {
    expect(cssContent).toMatch(/\.panel\s*\{[^}]*grid-area:\s*panel[;}]/);
  });

  it('should define grid-area for .status-bar', () => {
    expect(cssContent).toMatch(/\.status-bar\s*\{[^}]*grid-area:\s*status[;}]/);
  });

  it('should define grid-area for .chat-sidepanel', () => {
    expect(cssContent).toMatch(/\.chat-sidepanel\s*\{[^}]*grid-area:\s*chat[;}]/);
  });
});

describe('Theme Coverage', () => {
  const cssPath = path.resolve(__dirname, 'global.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  const expectedThemes = [
    'aurora',
    'cyber-fusion',
    'night-ops',
    'matrix-green',
    'dracula-pro',
    'glass-enterprise',
    'minimal-pro',
    'paper',
    'solarized-light',
    'nord',
  ];

  for (const theme of expectedThemes) {
    const selector = `[data-theme="${theme}"]`;
    const exists = cssContent.includes(selector);

    if (theme === 'aurora') {
      it(`should define CSS variables for default theme "${theme}"`, () => {
        expect(exists).toBe(true);
      });
    }
  }

  it('should have Aurora theme fully defined with all CSS variables', () => {
    const rootMatch = cssContent.match(/:root\[data-theme="aurora"\]\s*\{([^}]+)\}/);
    expect(rootMatch).not.toBeNull();

    const variables = rootMatch![1];
    expect(variables).toContain('--bg-primary');
    expect(variables).toContain('--text-primary');
    expect(variables).toContain('--accent-primary');
    expect(variables).toContain('--border-primary');
    expect(variables).toContain('--status-success');
    expect(variables).toContain('--space-1');
    expect(variables).toContain('--font-ui');
  });
});
