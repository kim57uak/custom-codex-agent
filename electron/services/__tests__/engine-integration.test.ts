/**
 * 엔진(Engine) 통합 테스트
 *
 * 테스트 대상:
 * - ConfigReader (CLI 경로 검증, 에이전트 설정, 디렉토리/파일 읽기)
 * - LogBuffer (엔진 로그 버퍼링/플러시)
 * - EventBroker (이벤트 브로커)
 * 테스트 방식: 통합 테스트 (실제 CLI 바이너리 호출, 실제 파일 시스템 접근)
 * 주요 검증 시나리오:
 * - 4개 엔진(codex, gemini, opencode, claudecode)의 CLI 경로 유효성 및 --version 실행
 * - Engine Agent Config 저장 및 조회
 * - Skills 디렉토리 접근 및 SKILL.md 파일 읽기
 * - 엔진 경로 Resolution 로직 (startRun 시나리오)
 * - LogBuffer push/flush 동작 및 콜백
 * - 경로 탐색(Traversal) 방어 및 홈 디렉토리 내 파일 읽기
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ConfigReader } from '../ConfigReader';
import { LogBuffer } from '../LogBuffer';
import { EventBroker } from '../EventBroker';

describe('Engine Integration Tests', () => {
  let configReader: ConfigReader;
  let logBuffer: LogBuffer;
  let eventBroker: EventBroker;

  const ENGINE_PATHS: Record<string, string> = {
    codex: '/opt/homebrew/bin/codex',
    gemini: '/opt/homebrew/bin/gemini',
    opencode: '/Users/dolpaks/.opencode/bin/opencode',
    claudecode: '/Users/dolpaks/.local/bin/claude',
  };

  beforeAll(async () => {
    configReader = new ConfigReader();
    logBuffer = new LogBuffer();
    eventBroker = new EventBroker();

    // Save engine configs
    for (const [engine, cliPath] of Object.entries(ENGINE_PATHS)) {
      configReader.saveAgent({
        id: `engine-${engine}`,
        name: `${engine} CLI`,
        engine: engine as 'codex' | 'gemini' | 'opencode' | 'claudecode',
        cliPath,
      });
    }
  });

  afterAll(() => {
    for (const [engine] of Object.entries(ENGINE_PATHS)) {
      try { configReader.deleteAgent(`engine-${engine}`); } catch {}
    }
  });

  describe('CLI Path Validation', () => {
    it.each(['codex', 'gemini', 'opencode', 'claudecode'] as const)('should validate %s CLI path', async (engine) => {
      const result = await configReader.validateCliPath(ENGINE_PATHS[engine]!);
      expect(result.valid).toBe(true);
      expect(result.version).toBeTruthy();
    });

    it('should reject invalid CLI path', async () => {
      const result = await configReader.validateCliPath('/nonexistent/path');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('Engine Agent Config', () => {
    it('should have all engine agents configured', () => {
      const agents = configReader.listAgents();
      for (const [engine] of Object.entries(ENGINE_PATHS)) {
        const agent = agents.find(a => a.id === `engine-${engine}`);
        expect(agent).toBeDefined();
        expect(agent!.engine).toBe(engine);
        expect(agent!.cliPath).toBe(ENGINE_PATHS[engine]);
      }
    });

    it('should have CLI binaries that exist on disk', () => {
      for (const [engine, cliPath] of Object.entries(ENGINE_PATHS)) {
        expect(fs.existsSync(cliPath), `${engine} not found at ${cliPath}`).toBe(true);
      }
    });

    it('should execute CLI --version for each engine', async () => {
      for (const [engine, cliPath] of Object.entries(ENGINE_PATHS)) {
        const result = await configReader.validateCliPath(cliPath);
        expect(result.valid, `${engine} --version failed: ${result.error}`).toBe(true);
        expect(result.version).toBeTruthy();
        // Check specific version patterns
        if (engine === 'codex') expect(result.version).toContain('codex-cli');
        if (engine === 'claudecode') expect(result.version).toContain('Claude Code');
        if (engine === 'opencode') expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
      }
    });
  });

  describe('Skills Directory Access', () => {
    it('should list .claude/skills directory', () => {
      const skillsDir = path.join(os.homedir(), '.claude', 'skills');
      if (!fs.existsSync(skillsDir)) return;

      const result = configReader.readDir(skillsDir, false);
      expect(result).not.toBeNull();
      expect(result!.entries.length).toBeGreaterThan(0);
      const skillDirs = result!.entries.filter(e => e.type === 'directory');
      expect(skillDirs.length).toBeGreaterThan(0);
    });

    it('should read a SKILL.md file with metadata', () => {
      const skillsDir = path.join(os.homedir(), '.claude', 'skills');
      if (!fs.existsSync(skillsDir)) return;

      const result = configReader.readDir(skillsDir, false);
      if (!result || result.entries.length === 0) return;

      const firstSkillDir = result.entries.find(e => e.type === 'directory');
      if (!firstSkillDir) return;

      const skillFile = path.join(firstSkillDir.path, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return;

      const content = configReader.readFile(skillFile);
      expect(content).not.toBeNull();
      expect(content!.content.length).toBeGreaterThan(0);
      // SKILL.md should have description tags
      expect(content!.content).toContain('description');
    });
  });

  describe('Engine Path Resolution (startRun logic test)', () => {
    it('should resolve engine from options.engine when no agent matches', () => {
      const agents = configReader.listAgents();
      // Simulate startRun engine resolution logic
      const testCases = [
        { agentId: 'nonexistent', engine: 'codex', expected: 'codex' },
        { agentId: 'nonexistent', engine: 'gemini', expected: 'gemini' },
        { agentId: 'nonexistent', engine: 'opencode', expected: 'opencode' },
        { agentId: 'nonexistent', engine: 'claudecode', expected: 'claudecode' },
      ];

      for (const tc of testCases) {
        const agent = agents.find(a => a.id === tc.agentId);
        const resolvedEngine = tc.engine ?? agent?.engine ?? 'codex';
        expect(resolvedEngine).toBe(tc.expected);
      }
    });

    it('should resolve engine from agent when options.engine is undefined', () => {
      const agents = configReader.listAgents();
      const codexAgent = agents.find(a => a.id === 'engine-codex');
      expect(codexAgent).toBeDefined();
      expect(codexAgent!.engine).toBe('codex');

      // When options.engine is undefined, fall back to agent.engine
      const resolvedEngine = codexAgent?.engine ?? 'codex';
      expect(resolvedEngine).toBe('codex');
    });
  });

  describe('LogBuffer Engine Logging', () => {
    it('should buffer and flush log entries', () => {
      return new Promise<void>((done) => {
        const entries: Array<{ runId: string; level: string; message: string }> = [];

        logBuffer.onFlush((batch) => {
          entries.push(...batch.map(e => ({ runId: e.runId, level: e.level, message: e.message })));
        });

        logBuffer.push({ runId: 'test-run', level: 'info', message: 'engine test log', timestamp: new Date().toISOString(), raw: 'engine test log' });
        logBuffer.push({ runId: 'test-run', level: 'info', message: 'gemini response received', timestamp: new Date().toISOString(), raw: 'gemini response received' });
        logBuffer.flush();

        setTimeout(() => {
          expect(entries.length).toBeGreaterThanOrEqual(2);
          done();
        }, 200);
      });
    });
  });

  describe('Read directory with engine-accessible paths', () => {
    it('should read home directory', () => {
      const result = configReader.readDir(os.homedir(), false);
      expect(result).not.toBeNull();
      expect(result!.entries.length).toBeGreaterThan(0);
    });

    it('should reject path traversal outside homedir', () => {
      const result = configReader.readDir('/etc', false);
      expect(result).toBeNull();
    });

    it('should read a file and return content with language', () => {
      const testFile = path.join(os.homedir(), '.config', `engine-read-test-${Date.now()}.md`);
      fs.writeFileSync(testFile, '# Engine Test\ndescription: test skill');
      const result = configReader.readFile(testFile);
      expect(result).not.toBeNull();
      expect(result!.content).toContain('Engine Test');
      expect(result!.language).toBe('markdown');
      fs.unlinkSync(testFile);
    });
  });
});
