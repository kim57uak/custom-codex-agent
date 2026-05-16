/**
 * OpenCodeEngine - OpenCode CLI 어댑터
 *
 * Implements EngineAdapter interface
 * OpenCode CLI의 spawn, terminate, validateConnection 메서드 구현
 *
 * 사용 방법:
 * - RunOrchestrator.createEngineAdapter('opencode')로 인스턴스 생성
 * - CLI 스펙: `opencode <prompt>` (stdin도 지원)
 *
 * 보안:
 * - ALLOWED_COMMANDS = ['opencode'] (white-list)
 * - shell: false
 * - ENV_SANITIZE_BLOCKLIST 적용
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

const ALLOWED_COMMANDS = ['opencode'];

export class OpenCodeEngine implements EngineAdapter {
  readonly engine: EngineType = 'opencode';

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

  spawn(args: string[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
    const sanitizedEnv = this.sanitizeEnv(env);

    let cliPath = 'opencode';
    if (args[0] && args[0].startsWith('/')) {
      cliPath = args[0];
      args = args.slice(1);
    }

    return spawn(cliPath, args, {
      env: sanitizedEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  terminate(pid: number): boolean {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }

  async validateConnection(cliPath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
    const pathToCheck = cliPath ?? 'opencode';

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
}