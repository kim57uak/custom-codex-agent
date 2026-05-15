import { describe, it, expect } from 'vitest';
import {
  RunOptionsSchema,
  AgentConfigSchema,
  WorkflowSchema,
  RunEventSchema,
  EngineTypeSchema,
  RunStatusSchema,
  IpcVersionCheckSchema,
  FileChangeSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
} from '../ipc-contract';

describe('Zod Schema Validation (integration)', () => {
  describe('RunOptionsSchema', () => {
    it('should accept valid run options', () => {
      const result = RunOptionsSchema.parse({
        agentId: 'agent-1',
        prompt: 'Hello world',
      });
      expect(result.agentId).toBe('agent-1');
    });

    it('should accept run options with all fields', () => {
      const result = RunOptionsSchema.parse({
        agentId: 'agent-1',
        prompt: 'Hello world',
        workspace: '/path/to/workspace',
        timeout: 60,
        maxTokens: 4096,
      });
      expect(result.timeout).toBe(60);
      expect(result.maxTokens).toBe(4096);
    });

    it('should reject prompt exceeding 100KB', () => {
      expect(() => RunOptionsSchema.parse({
        agentId: 'agent-1',
        prompt: 'x'.repeat(100_001),
      })).toThrow();
    });

    it('should reject missing agentId', () => {
      expect(() => RunOptionsSchema.parse({ prompt: 'hello' })).toThrow();
    });
  });

  describe('AgentConfigSchema', () => {
    it('should accept minimal valid agent config', () => {
      const result = AgentConfigSchema.parse({
        id: 'agent-1',
        name: 'My Agent',
        engine: 'codex',
      });
      expect(result.name).toBe('My Agent');
    });

    it('should accept agent with all optional fields', () => {
      const result = AgentConfigSchema.parse({
        id: 'agent-2',
        name: 'Full Agent',
        engine: 'gemini',
        cliPath: '/usr/local/bin/gemini',
        model: 'gemini-2.0-flash',
        env: { KEY: 'value' },
        description: 'A test agent',
      });
      expect(result.cliPath).toBe('/usr/local/bin/gemini');
      expect(result.env!.KEY).toBe('value');
    });

    it('should reject invalid engine type', () => {
      expect(() => AgentConfigSchema.parse({
        id: 'agent-3',
        name: 'Bad Agent',
        engine: 'invalid-engine',
      })).toThrow();
    });

    it('should reject missing name', () => {
      expect(() => AgentConfigSchema.parse({
        id: 'agent-4',
        engine: 'codex',
      })).toThrow();
    });
  });

  describe('WorkflowSchema', () => {
    const validWorkflow = {
      id: 'wf-1',
      name: 'Test Workflow',
      nodes: [
        { id: 'node-1', name: 'Lint', type: 'agent', agentId: 'agent-1' },
        { id: 'node-2', name: 'Test', type: 'agent', agentId: 'agent-2' },
      ],
      edges: [
        { id: 'edge-1', from: 'node-1', to: 'node-2' },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    it('should accept valid workflow', () => {
      const result = WorkflowSchema.parse(validWorkflow);
      expect(result.name).toBe('Test Workflow');
      expect(result.nodes).toHaveLength(2);
    });

    it('should reject workflow with invalid node type', () => {
      expect(() => WorkflowSchema.parse({
        ...validWorkflow,
        nodes: [{ id: 'bad-node', type: 'invalid' }],
      })).toThrow();
    });

    it('should reject workflow missing edges', () => {
      expect(() => WorkflowSchema.parse({
        ...validWorkflow,
        edges: undefined,
      })).toThrow();
    });
  });

  describe('EngineTypeSchema', () => {
    it('should accept all valid engines', () => {
      expect(EngineTypeSchema.parse('codex')).toBe('codex');
      expect(EngineTypeSchema.parse('gemini')).toBe('gemini');
      expect(EngineTypeSchema.parse('opencode')).toBe('opencode');
      expect(EngineTypeSchema.parse('claudecode')).toBe('claudecode');
    });

    it('should reject invalid engine', () => {
      expect(() => EngineTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('RunStatusSchema', () => {
    it('should accept all valid statuses', () => {
      const statuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
      for (const s of statuses) {
        expect(RunStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe('RunEventSchema', () => {
    it('should accept valid run event', () => {
      const result = RunEventSchema.parse({
        runId: 'run-1',
        type: 'start',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { foo: 'bar' },
      });
      expect(result.type).toBe('start');
    });
  });

  describe('WorkflowNodeSchema', () => {
    it('should accept all valid node types', () => {
      const types = ['agent', 'condition', 'merge', 'delay', 'start', 'end'] as const;
      for (const type of types) {
        const result = WorkflowNodeSchema.parse({ id: 'n1', type });
        expect(result.type).toBe(type);
      }
    });
  });

  describe('WorkflowEdgeSchema', () => {
    it('should accept valid edge', () => {
      const result = WorkflowEdgeSchema.parse({ id: 'e1', from: 'n1', to: 'n2' });
      expect(result.from).toBe('n1');
    });

    it('should accept edge with optional fields', () => {
      const result = WorkflowEdgeSchema.parse({ id: 'e1', from: 'n1', to: 'n2', condition: 'success', label: 'pass' });
      expect(result.condition).toBe('success');
    });
  });

  describe('IpcVersionCheckSchema', () => {
    it('should accept valid version check', () => {
      const result = IpcVersionCheckSchema.parse({ version: '1.0.0', minVersion: '1.0.0' });
      expect(result.version).toBe('1.0.0');
    });
  });

  describe('FileChangeSchema', () => {
    it('should accept valid file change', () => {
      const result = FileChangeSchema.parse({ path: '/test.txt', event: 'change' });
      expect(result.event).toBe('change');
    });

    it('should reject invalid event type', () => {
      expect(() => FileChangeSchema.parse({ path: '/test.txt', event: 'rename' })).toThrow();
    });
  });
});
