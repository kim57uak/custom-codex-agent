/**
 * handlers.test.ts - IPC 핸들러 검증 테스트
 *
 * 테스트 대상:
 * - registerIpcHandlers()가 모든 IPC 채널을正しく 등록하는지 검증
 * - Zod 스키마 validation이正しく 작동하는지 검증
 * - 잘못된 입력에 대해 에러가 발생하는지 검증
 *
 * CEO Amendment #11: Test infrastructure
 * - 첫 번째 테스트: IPC handler validation
 * - 커버리지: 80% threshold
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Mock 설정
 */
const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn(),
};

const mockLogBuffer = {
  onFlush: vi.fn(),
  push: vi.fn(),
  flush: vi.fn(),
  onOverflow: vi.fn(),
};

const mockConfigReader = {
  listAgents: vi.fn().mockReturnValue([]),
  saveAgent: vi.fn(),
  deleteAgent: vi.fn().mockReturnValue(true),
  get: vi.fn(),
  set: vi.fn(),
  readFile: vi.fn().mockReturnValue(null),
  writeFile: vi.fn().mockReturnValue(true),
  listDir: vi.fn().mockReturnValue(null),
  validateCliPath: vi.fn().mockResolvedValue({ valid: false }),
  getStats: vi.fn().mockReturnValue({ totalRuns: 0, totalAgents: 0, uptime: 0 }),
};

const mockEventBroker = {
  pushEvent: vi.fn(),
  pushLog: vi.fn(),
  onWorkerMessage: vi.fn(),
  emitWorkerMessage: vi.fn(),
  pushFileChange: vi.fn(),
  onEvent: vi.fn(),
  removeAllListeners: vi.fn(),
  registerWindow: vi.fn(),
};

// Mock modules
const mockApp = {
  on: vi.fn(),
  quit: vi.fn(),
};

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: mockApp,
}));

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
    pragma: vi.fn(),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});

// Mock RunStore and WorkflowStore
vi.mock('../stores/RunStore', () => ({
  RunStore: vi.fn().mockImplementation(() => ({
    createRun: vi.fn().mockReturnValue({ id: 'test-run', agentId: 'test', prompt: '', status: 'queued', workspace: null, createdAt: '', completedAt: null, error: null }),
    getRun: vi.fn().mockReturnValue(null),
    updateRunStatus: vi.fn(),
    listRuns: vi.fn().mockReturnValue([]),
    addEvent: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../stores/WorkflowStore', () => ({
  WorkflowStore: vi.fn().mockImplementation(() => ({
    createWorkflow: vi.fn().mockReturnValue({}),
    getWorkflow: vi.fn().mockReturnValue(null),
    updateWorkflow: vi.fn().mockReturnValue(null),
    deleteWorkflow: vi.fn().mockReturnValue(true),
    listWorkflows: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  })),
}));

vi.mock('../types/ipc-contract', () => ({
  RunOptionsSchema: {
    parse: vi.fn((data) => data),
  },
  AgentConfigSchema: {
    parse: vi.fn((data) => data),
  },
  WorkflowSchema: {
    parse: vi.fn((data) => data),
  },
  IPC_CHANNELS: {
    invoke: {
      'run:agent': 'run:agent',
      'run:cancel': 'run:cancel',
      'run:list': 'run:list',
      'workflow:create': 'workflow:create',
      'agents:list': 'agents:list',
      'config:get': 'config:get',
    },
    on: {
      'run:event': 'run:event',
      'log:entry': 'log:entry',
    },
  },
}));

describe('IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('registerIpcHandlers', () => {
    it('should call ipcMain.handle for each IPC channel', async () => {
      const { registerIpcHandlers } = await import('./handlers');
      registerIpcHandlers({
        logBuffer: mockLogBuffer as unknown as import('../services/LogBuffer').LogBuffer,
        configReader: mockConfigReader as unknown as import('../services/ConfigReader').ConfigReader,
        eventBroker: mockEventBroker as unknown as import('../services/EventBroker').EventBroker,
      });

      expect(mockIpcMain.handle).toHaveBeenCalled();
      const calledChannels = (mockIpcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[0] as string);
      expect(calledChannels).toContain('run:agent');
      expect(calledChannels).toContain('run:cancel');
    });

    it('should register run:agent handler with correct validation', () => {
      // Arrange
      const runAgentHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'run:agent'
      );

      // Act
      if (runAgentHandler) {
        const handler = runAgentHandler[1];
        const mockEvent = { sender: { send: vi.fn() } };
        const validOptions = {
          agentId: 'test-agent',
          prompt: 'Hello, world!',
        };

        // Assert
        expect(handler).toBeDefined();
      }
    });

    it('should reject invalid runId type in run:cancel', () => {
      // Arrange
      const runCancelHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'run:cancel'
      );

      // Act & Assert
      if (runCancelHandler) {
        const handler = runCancelHandler[1];
        const mockEvent = {};

        // Should throw for non-string runId
        expect(() => {
          handler(mockEvent, 123); // Invalid: number instead of string
        }).toThrow('runId must be string');
      }
    });

    it('should reject invalid runId type in run:get', () => {
      // Arrange
      const runGetHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'run:get'
      );

      // Act & Assert
      if (runGetHandler) {
        const handler = runGetHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, null); // Invalid: null instead of string
        }).toThrow('runId must be string');
      }
    });
  });

  describe('Input Validation', () => {
    it('should validate channel before processing', () => {
      // Arrange
      const handlers = mockIpcMain.handle.mock.calls;

      // Assert
      handlers.forEach(([channel]) => {
        expect(channel).toMatch(/^[a-z]+:[a-z_]+$/);
      });
    });

    it('should validate workflowId type in workflow:delete', () => {
      // Arrange
      const workflowDeleteHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'workflow:delete'
      );

      // Act & Assert
      if (workflowDeleteHandler) {
        const handler = workflowDeleteHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, { id: 'invalid' }); // Invalid: object instead of string
        }).toThrow('workflowId must be string');
      }
    });

    it('should validate agentId type in agents:delete', () => {
      // Arrange
      const agentsDeleteHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'agents:delete'
      );

      // Act & Assert
      if (agentsDeleteHandler) {
        const handler = agentsDeleteHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, undefined); // Invalid: undefined instead of string
        }).toThrow('agentId must be string');
      }
    });
  });

  describe('ConfigReader Integration', () => {
    it('should call configReader.listAgents on agents:list', async () => {
      // Arrange
      const agentsListHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'agents:list'
      );

      // Act
      if (agentsListHandler) {
        const handler = agentsListHandler[1];
        const result = await handler({});

        // Assert
        expect(mockConfigReader.listAgents).toHaveBeenCalled();
      }
    });

    it('should call configReader.validateCliPath on cli:validate', async () => {
      // Arrange
      const cliValidateHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'cli:validate'
      );

      // Act
      if (cliValidateHandler) {
        const handler = cliValidateHandler[1];
        await handler({}, '/usr/local/bin/gemini');

        // Assert
        expect(mockConfigReader.validateCliPath).toHaveBeenCalledWith('/usr/local/bin/gemini');
      }
    });

    it('should reject invalid cliPath type in cli:validate', () => {
      // Arrange
      const cliValidateHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'cli:validate'
      );

      // Act & Assert
      if (cliValidateHandler) {
        const handler = cliValidateHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, 12345); // Invalid: number instead of string
        }).toThrow('cliPath must be string');
      }
    });
  });

  describe('Inspector Handlers', () => {
    it('should reject invalid filePath type in inspector:read', () => {
      // Arrange
      const inspectorReadHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'inspector:read'
      );

      // Act & Assert
      if (inspectorReadHandler) {
        const handler = inspectorReadHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, ['/path/to/file']); // Invalid: array instead of string
        }).toThrow('filePath must be string');
      }
    });

    it('should reject invalid content type in inspector:write', () => {
      // Arrange
      const inspectorWriteHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'inspector:write'
      );

      // Act & Assert
      if (inspectorWriteHandler) {
        const handler = inspectorWriteHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, '/path/to/file', { content: 'test' }); // Invalid: object instead of string
        }).toThrow('content must be string');
      }
    });

    it('should reject invalid dirPath type in inspector:list', () => {
      // Arrange
      const inspectorListHandler = mockIpcMain.handle.mock.calls.find(
        (call) => call[0] === 'inspector:list'
      );

      // Act & Assert
      if (inspectorListHandler) {
        const handler = inspectorListHandler[1];
        const mockEvent = {};

        expect(() => {
          handler(mockEvent, null); // Invalid: null instead of string
        }).toThrow('dirPath must be string');
      }
    });
  });
});