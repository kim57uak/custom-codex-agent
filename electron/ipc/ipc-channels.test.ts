/**
 * IPC 채널 계약(Contract) 테스트
 *
 * 테스트 대상: types/ipc-channels 모듈의 IPC_CHANNELS, IPC_VERSION
 * 테스트 방식: 유닛 테스트
 * 주요 검증 시나리오:
 * - IPC_VERSION이 '1.0.0'으로 선언되어 있는지 검증
 * - invoke 채널 67개 모두가 domain:action 네이밍 규칙을 따르는지 검증
 * - send 채널 7개가 모두 선언되어 있는지 검증
 * - on 채널 14개가 모두 선언되어 있는지 검증
 * - 각 채널별 필수 채널 목록 포함 여부 검증
 */
import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS, IPC_VERSION } from '../../types/ipc-channels';

describe('IPC Channel Contract', () => {
  it('should export IPC_VERSION', () => {
    expect(IPC_VERSION).toBe('1.0.0');
  });

  describe('invoke channels', () => {
    const channels = Object.values(IPC_CHANNELS.invoke);
    const expectedChannels = [
      'run:agent', 'run:cancel', 'run:list', 'run:get', 'run:start',
      'workflow:create', 'workflow:update', 'workflow:delete', 'workflow:list', 'workflow:run', 'workflow:stop', 'workflow:retry-step',
      'agents:list', 'agents:save', 'agents:delete',
      'config:get', 'config:set', 'config:get-agents',
      'file:read', 'file:write', 'dir:read',
      'inspector:list', 'inspector:select-file',
      'dashboard:stats', 'dashboard:recent-activity',
      'chat:send',
      'cli:validate',
      'mcp:add-server', 'mcp:list-tools', 'mcp:call-tool',
      'backup:create', 'backup:list', 'backup:restore', 'backup:delete', 'backup:size',
      'watcher:start', 'watcher:stop', 'watcher:add-path', 'watcher:remove-path', 'watcher:status',
      'notification:show',
      'dialog:open-directory',
      'dialog:open-file',
      'workflow:permission-respond',
    ];

    it('should declare all required invoke channels', () => {
      for (const ch of expectedChannels) {
        expect(channels).toContain(ch);
      }
    });

    it('should have 67 invoke channels', () => {
      expect(channels.length).toBe(67);
    });

    it('should use domain:action naming', () => {
      for (const ch of channels) {
        expect(ch).toMatch(/^[a-z]+:[a-z_-]+$/);
      }
    });
  });

  describe('send channels', () => {
    const channels = Object.values(IPC_CHANNELS.send);
    const expectedChannels = [
      'ipc:version-check',
      'org:agent-selected',
      'org:add-agent',
      'inspector:file-selected',
      'console:clear',
      'log:ack',
      'workflow:selected',
    ];

    it('should declare all required send channels', () => {
      for (const ch of expectedChannels) {
        expect(channels).toContain(ch);
      }
    });

    it('should have 7 send channels', () => {
      expect(channels.length).toBe(7);
    });
  });

  describe('on channels', () => {
    const channels = Object.values(IPC_CHANNELS.on);
    const expectedChannels = [
      'run:event',
      'log:entry',
      'ipc:version-match', 'ipc:version-mismatch',
      'file:change',
      'org:agent-selected',
      'inspector:file-selected',
      'run:started', 'run:ended',
      'console:clear',
      'workflow:selected',
      'workflow:event', 'workflow:run-status', 'workflow:permission-request',
    ];

    it('should declare all required on channels', () => {
      for (const ch of expectedChannels) {
        expect(channels).toContain(ch);
      }
    });

    it('should have 14 on channels', () => {
      expect(channels.length).toBe(14);
    });
  });
});
