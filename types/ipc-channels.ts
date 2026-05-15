/**
 * ipc-channels.ts - IPC 채널 정의 (Zod 의존성 없음)
 *
 * preload.ts에서 사용하기 위한 경량 채널 정의 파일.
 * ipc-contract.ts의 Zod 스키마를 가져오지 않아 preload 번들 크기를 줄입니다.
 */

export const IPC_VERSION = '1.0.0';

export const IPC_CHANNELS = {
  invoke: {
    'run:agent': 'run:agent',
    'run:cancel': 'run:cancel',
    'run:list': 'run:list',
    'run:get': 'run:get',
    'run:start': 'run:start',
    'run:reply': 'run:reply',
    'run:retry': 'run:retry',
    'run:events': 'run:events',
    'workflow:create': 'workflow:create',
    'workflow:update': 'workflow:update',
    'workflow:delete': 'workflow:delete',
    'workflow:list': 'workflow:list',
    'workflow:run': 'workflow:run',
    'workflow:stop': 'workflow:stop',
    'workflow:recommend': 'workflow:recommend',
    'workflow:retry': 'workflow:retry',
    'workflow:skip-step': 'workflow:skip-step',
    'workflow:events': 'workflow:events',
    'agents:list': 'agents:list',
    'agents:save': 'agents:save',
    'agents:delete': 'agents:delete',
    'config:get': 'config:get',
    'config:set': 'config:set',
    'config:get-agents': 'config:get-agents',
    'file:read': 'file:read',
    'file:write': 'file:write',
    'dir:read': 'dir:read',
    'inspector:select-file': 'inspector:select-file',
    'inspector:load-agent': 'inspector:load-agent',
    'inspector:save-file': 'inspector:save-file',
    'dashboard:stats': 'dashboard:stats',
    'dashboard:recent-activity': 'dashboard:recent-activity',
    'dashboard:inventory': 'dashboard:inventory',
    'dashboard:overview': 'dashboard:overview',
    'dashboard:router-graph': 'dashboard:router-graph',
    'dashboard:org-chart': 'dashboard:org-chart',
    'chat:send': 'chat:send',
    'cli:validate': 'cli:validate',
    'mcp:add-server': 'mcp:add-server',
    'mcp:list-tools': 'mcp:list-tools',
    'mcp:call-tool': 'mcp:call-tool',
    'backup:create': 'backup:create',
    'backup:list': 'backup:list',
    'backup:restore': 'backup:restore',
    'backup:delete': 'backup:delete',
    'backup:size': 'backup:size',
    'watcher:start': 'watcher:start',
    'watcher:stop': 'watcher:stop',
    'watcher:add-path': 'watcher:add-path',
    'watcher:remove-path': 'watcher:remove-path',
    'watcher:status': 'watcher:status',
    'notification:show': 'notification:show',
    'dialog:open-directory': 'dialog:open-directory',
  },
  send: {
    'ipc:version-check': 'ipc:version-check',
    'org:agent-selected': 'org:agent-selected',
    'org:add-agent': 'org:add-agent',
    'inspector:file-selected': 'inspector:file-selected',
    'console:clear': 'console:clear',
    'log:ack': 'log:ack',
    'workflow:selected': 'workflow:selected',
  },
  on: {
    'run:event': 'run:event',
    'log:entry': 'log:entry',
    'ipc:version-match': 'ipc:version-match',
    'ipc:version-mismatch': 'ipc:version-mismatch',
    'file:change': 'file:change',
    'org:agent-selected': 'org:agent-selected',
    'inspector:file-selected': 'inspector:file-selected',
    'run:started': 'run:started',
    'run:ended': 'run:ended',
    'console:clear': 'console:clear',
    'workflow:selected': 'workflow:selected',
  },
} as const;

export type IpcVersionCheck = {
  version: string;
  minVersion: string;
};
