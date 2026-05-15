import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const VIEWS_DIR = path.resolve(__dirname, '../views');
const INSPECTOR_FILE = path.join(VIEWS_DIR, 'InspectorView.tsx');

describe('InspectorView engine passthrough', () => {
  it('should pass engine in inspector:load-agent IPC call', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    const ipcCallLines = source
      .split('\n')
      .filter(line => line.includes("inspector:load-agent"));
    const hasEngineInIpc = ipcCallLines.some(line => line.includes('engine'));
    expect(hasEngineInIpc).toBe(true);
  });

  it('should extract agent name from AgentConfig for IPC call', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    const ipcCallLines = source
      .split('\n')
      .filter(line => line.includes("inspector:load-agent"));
    const hasAgentName = ipcCallLines.some(line => line.includes('agent.name'));
    expect(hasAgentName).toBe(true);
  });

  it('should have agent selection handler', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    expect(source).toContain('handleSelectAgent');
    expect(source).toContain('inspector:load-agent');
  });

  it('should support agents and skills tabs', () => {
    const source = fs.readFileSync(INSPECTOR_FILE, 'utf-8');
    expect(source).toContain("activeTab === 'agents'");
    expect(source).toContain("activeTab === 'skills'");
  });
});
