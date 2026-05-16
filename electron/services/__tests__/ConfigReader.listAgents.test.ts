import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CONFIG_READER_FILE = path.resolve(__dirname, '../ConfigReader.ts');

describe('ConfigReader.listAgents() path fix', () => {
  it('should use SETTINGS.getAgentsRoot instead of hardcoded paths', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const listAgentsBody = source.match(
      /listAgents\(\).*?\{[\s\S]*?\n  \}/m
    );
    expect(listAgentsBody).not.toBeNull();
    const body = listAgentsBody![0];
    expect(body).not.toContain("path.join(os.homedir(), '.gemini', 'agents')");
    expect(body).toContain('SETTINGS.getAgentsRoot(engine)');
  });

  it('should use SETTINGS.getAgentsRoot for all engine lookups', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const listAgentsBody = source.match(
      /listAgents\(\).*?\{[\s\S]*?\n  \}/m
    );
    expect(listAgentsBody).not.toBeNull();
    const body = listAgentsBody![0];
    expect(body).toContain('SETTINGS.getAgentsRoot(engine)');
  });

  it('should scan all four engine agent roots (gemini, codex, opencode, claudecode)', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    expect(source).toContain("'gemini'");
    expect(source).toContain("'codex'");
    expect(source).toContain("'opencode'");
    expect(source).toContain("'claudecode'");

    const oldHardcodedPattern = "path.join(os.homedir(), '.gemini', 'agents')";
    const oldCodexPattern = "path.join(os.homedir(), '.codex', 'agents')";
    expect(source).not.toContain(oldHardcodedPattern);
    expect(source).not.toContain(oldCodexPattern);
  });

  it('should scan all configured agent roots via loop', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    const pushCalls = source.match(/discovered\.push\(/g);
    expect(pushCalls).not.toBeNull();
    expect(pushCalls!.length).toBe(1);
  });
});
