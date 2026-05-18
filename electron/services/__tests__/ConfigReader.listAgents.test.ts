/**
 * ConfigReader.listAgents() 경로 처리 수정 검증 테스트
 *
 * 테스트 대상: electron/services/ConfigReader.ts의 listAgents() 메서드
 * 테스트 방식: 유닛 테스트 (소스 코드 정적 분석)
 * 주요 검증 시나리오:
 * - 하드코딩된 경로 대신 SETTINGS.getAgentsRoot(engine) 사용 여부
 * - 4개 엔진(gemini, opencode, claudecode, kiro-cli)의 agent root 스캔 여부
 * - 단일 discovered.push() 호출로 모든 엔진 처리 여부
 */
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

  it('should scan all four engine agent roots (gemini, opencode, claudecode, kiro-cli)', () => {
    const source = fs.readFileSync(CONFIG_READER_FILE, 'utf-8');
    expect(source).toContain("'gemini'");
    expect(source).toContain("'opencode'");
    expect(source).toContain("'claudecode'");
    expect(source).toContain("'kiro-cli'");

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
