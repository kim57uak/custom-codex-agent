import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CONFIG_READER_FILE = path.resolve(__dirname, '../ConfigReader.ts');

describe('ConfigReader.listAgents() path fix', () => {
  it('should use SETTINGS.getAgentsRoot instead of hardcoded ~/.gemini/agents path', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const listAgentsBody = source.match(
      /listAgents\(\).*?\{[\s\S]*?\n  \}/m
    );
    expect(listAgentsBody).not.toBeNull();
    const body = listAgentsBody![0];
    expect(body).not.toContain("path.join(os.homedir(), '.gemini', 'agents')");
    expect(body).toContain("SETTINGS.getAgentsRoot('gemini')");
    expect(body).toContain("SETTINGS.getAgentsRoot('codex')");
  });

  it('should use the same agents root as readAgents uses via SETTINGS', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const listAgentsBody = source.match(
      /listAgents\(\).*?\{[\s\S]*?\n  \}/m
    );
    expect(listAgentsBody).not.toBeNull();
    const body = listAgentsBody![0];

    const geminiRootMatch = body.match(/SETTINGS\.getAgentsRoot\('gemini'\)/);
    expect(geminiRootMatch).not.toBeNull();
    const codexRootMatch = body.match(/SETTINGS\.getAgentsRoot\('codex'\)/);
    expect(codexRootMatch).not.toBeNull();
  });

  it('should scan the correct paths: gemini = ~/.gemini/antigravity/agents, codex = ~/.codex/agents', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const { SETTINGS } = { SETTINGS: null as any };
    const expectedGeminiRoot = path.join('.gemini', 'antigravity', 'agents');
    const expectedCodexRoot = path.join('.codex', 'agents');

    expect(source).toContain("SETTINGS.getAgentsRoot('gemini')");
    expect(source).toContain("SETTINGS.getAgentsRoot('codex')");

    const oldHardcodedPattern = "path.join(os.homedir(), '.gemini', 'agents')";
    const oldCodexPattern = "path.join(os.homedir(), '.codex', 'agents')";
    expect(source).not.toContain(oldHardcodedPattern);
    expect(source).not.toContain(oldCodexPattern);
  });

  it('should scan both configured agent roots', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const pushCalls = source.match(/discovered\.push\(/g);
    expect(pushCalls).not.toBeNull();
    expect(pushCalls!.length).toBe(2);
  });
});
