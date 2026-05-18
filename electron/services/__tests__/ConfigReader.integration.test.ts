/**
 * ConfigReader 통합 테스트
 *
 * 테스트 대상: electron/services/ConfigReader.ts
 * 테스트 방식: 통합 테스트 (실제 JSON 파일 I/O, 실제 파일 시스템 접근)
 * 주요 검증 시나리오:
 * - 에이전트 저장(saveAgent) 및 조회(listAgents)
 * - 기존 에이전트 업데이트
 * - 에이전트 삭제(deleteAgent) 및 존재하지 않는 에이전트 삭제 시 false 반환
 * - 설정 저장(set) 및 조회(get)
 * - 에이전트 JSON 파일 디스크 Persistence
 * - 홈 디렉토리 내 파일 읽기
 * - 경로 탐색(Traversal) 방어 (/etc/passwd 차단)
 * - Stats 반환(totalRuns, totalAgents 등)
 * - 디렉토리 목록 조회(listDir)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('ConfigReader Integration', () => {
  const tmpDir = path.join(os.homedir(), '.config', `config-reader-test-${Date.now()}`);
  const configDir = tmpDir;
  const configFile = path.join(configDir, 'config.json');

  let ConfigReader: typeof import('../ConfigReader').ConfigReader;
  let reader: import('../ConfigReader').ConfigReader;

  beforeAll(async () => {
    fs.mkdirSync(configDir, { recursive: true });
    const mod = await import('../ConfigReader');
    ConfigReader = mod.ConfigReader;

    reader = new ConfigReader();
    (reader as unknown as { configPath: string }).configPath = configFile;
    (reader as unknown as { data: { agents?: unknown[]; settings?: Record<string, unknown> } }).data = { agents: [], settings: {} };
    (reader as unknown as { save: () => void }).save();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and list agents', () => {
    const agent = {
      id: 'test-agent-1',
      name: 'Test Agent',
      engine: 'gemini' as const,
      cliPath: '/usr/local/bin/gemini',
      model: 'gpt-4o',
    };

    reader.saveAgent(agent);
    const agents = reader.listAgents();
    const saved = agents.find(a => a.id === 'test-agent-1');
    expect(saved).toBeDefined();
    expect(saved!.id).toBe('test-agent-1');
  });

  it('should update existing agent', () => {
    reader.saveAgent({
      id: 'test-agent-1',
      name: 'Updated Agent',
      engine: 'gemini' as const,
    });
    const agents = reader.listAgents();
    const updated = agents.find(a => a.id === 'test-agent-1');
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated Agent');
  });

  it('should delete agent', () => {
    expect(reader.deleteAgent('test-agent-1')).toBe(true);
    const agents = reader.listAgents();
    expect(agents.find(a => a.id === 'test-agent-1')).toBeUndefined();
  });

  it('should return false when deleting non-existent agent', () => {
    expect(reader.deleteAgent('non-existent')).toBe(false);
  });

  it('should save and get settings', () => {
    reader.set('theme', 'dark');
    reader.set('timeout', 30000);
    expect(reader.get('theme')).toBe('dark');
    expect(reader.get('timeout')).toBe(30000);
  });

  it('should persist agents to disk (JSON file)', () => {
    reader.saveAgent({ id: 'disk-test', name: 'Disk Agent', engine: 'gemini' as const });

    const raw = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(raw.agents).toHaveLength(1);
    expect(raw.agents[0].id).toBe('disk-test');
  });

  it('should read file under home directory', () => {
    const tmpFile = path.join(os.homedir(), '.config', `read-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello world');
    const result = reader.readFile(tmpFile);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('hello world');
    fs.unlinkSync(tmpFile);
  });

  it('should reject path traversal', () => {
    const result = reader.readFile('/etc/passwd');
    expect(result).toBeNull();
  });

  it('should return stats', () => {
    reader.saveAgent({ id: 'stats-test', name: 'Stats', engine: 'gemini' as const });
    const stats = reader.getStats();
    expect(stats.totalAgents).toBeGreaterThanOrEqual(1);
  });

  it('should list directory contents', () => {
    const entries = reader.listDir(os.homedir());
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThan(0);
  });
});
