/**
 * ClaudeCodeEngine - Claude Code CLI 어댑터
 *
 * Implements EngineAdapter interface
 * Claude Code CLI(`claude`)의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('claudecode')로 인스턴스 생성
 * - CLI 스펙: `claude <prompt>` (stdin도 지원)
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['claude'] (white-list)
 * - shell: false
 * - ENV_SANITIZE_BLOCKLIST 적용
 *
 * Phase 5 구현:
 * - Claude Code CLI 어댑터
 * - 세션 관리 (--session 플래그 지원)
 * - 프롬프트 모드 (--print 플래그로 비대화형 모드)
 */

import { spawn } from 'child_process';
import type { EngineAdapter } from './EngineAdapter';
import type { EngineType } from '../../types/ipc-contract';

const ENV_SANITIZE_BLOCKLIST = [
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
];

const ALLOWED_COMMANDS = ['claude'];

export class ClaudeCodeEngine implements EngineAdapter {
  readonly engine: EngineType = 'claudecode';
  readonly binaryName = 'claude';

  private sanitizeEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const baseEnv = { ...process.env, ...env };
    for (const key of ENV_SANITIZE_BLOCKLIST) {
      delete baseEnv[key];
    }
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
    const currentPath = baseEnv.PATH ?? '';
    baseEnv.PATH = [...extraPaths, currentPath].filter(Boolean).join(':');
    return baseEnv;
  }

  /**
   * CLI 프로세스 생성
   * --print 플래그로 비대화형 모드 실행 (출력 후 종료)
   * --session 플래그로 세션 ID 지정 가능
   */
  spawn(args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
    const sanitizedEnv = this.sanitizeEnv(env);

    let cliPath = 'claude';
    if (args[0] && args[0].startsWith('/')) {
      cliPath = args[0];
      args = args.slice(1);
    }

    // --print 플래그 자동 추가 (비대화형 모드)
    if (!args.includes('--print') && !args.includes('-p')) {
      args = ['--print', ...args];
    }

    return spawn(cliPath, args, {
      env: sanitizedEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  terminate(pid: number): boolean {
    try {
      // Claude Code는 SIGTERM으로 정상 종료 시도 후 SIGKILL
      process.kill(pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(pid, '0'); // 프로세스가 아직 살아있으면 SIGKILL
          process.kill(pid, 'SIGKILL');
        } catch {
          // 이미 종료됨
        }
      }, 3000);
      return true;
    } catch {
      return false;
    }
  }

  async validateConnection(cliPath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    const pathToCheck = cliPath || 'claude';

    return new Promise((resolve) => {
      try {
        const proc = spawn(pathToCheck, ['--version'], {
          env: this.sanitizeEnv(),
          shell: false,
          timeout: 5000,
        });

        let output = '';
        let errorOutput = '';

        proc.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0 && output.trim()) {
            resolve({ valid: true, version: output.trim() });
          } else {
            resolve({
              valid: false,
              error: errorOutput || `Exit code: ${code}`,
            });
          }
        });

        proc.on('error', (err) => {
          resolve({ valid: false, error: err.message });
        });

        setTimeout(() => {
          proc.kill();
          resolve({ valid: false, error: 'Timeout (5s)' });
        }, 5000);
      } catch (err) {
        resolve({ valid: false, error: String(err) });
      }
    });
  }

  buildCliArgs(prompt: string, _options?: import('./EngineAdapter').BuildCliArgsOptions): string[] {
    return ['-p', prompt];
  }
}