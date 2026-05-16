/**
 * McpClient - Model Context Protocol (MCP) 클라이언트
 *
 * MCP는 에이전트가 외부 도구/데이터 소스에 접근할 수 있게 하는 프로토콜입니다.
 * 이 클라이언트는 MCP 서버에 연결하여 도구 목록 조회, 도구 호출, 리소스 접근을 수행합니다.
 *
 * 기능:
 * - MCP 서버 연결 관리 (stdio/SSE 전송)
 * - 도구 목록 조회 (tools/list)
 * - 도구 호출 (tools/call)
 * - 리소스 목록 조회 (resources/list)
 * - 리소스 읽기 (resources/read)
 * - 프롬프트 목록 조회 (prompts/list)
 *
 * Phase 5 완료 항목:
 * - [x] MCP 서버 통합
 */

import { spawn, ChildProcess } from 'child_process';

/** MCP 서버 설정 */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** MCP 도구 정의 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP 도구 호출 결과 */
export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/** MCP 리소스 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP 프롬프트 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/** JSON-RPC 2.0 요청 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 응답 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * McpClient 클래스
 * MCP 서버와의 통신을 관리하는 클라이언트
 */
export class McpClient {
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = new Map();
  private buffer = '';
  private connected = false;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /**
   * MCP 서버 연결
   * stdio 전송으로 서버 프로세스를 spawn하고 초기화 핸드셰이크 수행
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
        const currentPath = process.env.PATH ?? '';
        this.process = spawn(this.config.command, this.config.args ?? [], {
          env: { ...process.env, ...this.config.env, PATH: [...extraPaths, currentPath].filter(Boolean).join(':') },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString());
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
        });

        this.process.on('error', (err) => {
          console.error(`[MCP ${this.config.name}] process error:`, err);
          this.connected = false;
          reject(err);
        });

        this.process.on('close', (code) => {
          console.error(`[MCP ${this.config.name}] process exited with code ${code}`);
          this.connected = false;
        });

        // 초기화 핸드셰이크
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'agent-orchestrator',
            version: '0.1.0',
          },
        }).then(async () => {
          // 초기화 완료 알림
          this.sendNotification('notifications/initialized', {});
          this.connected = true;

          // 도구/리소스/프롬프트 목록 조회
          await this.refreshCapabilities();

          resolve();
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * MCP 서버 연결 해제
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  /**
   * 연결 상태 확인
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 도구 목록 반환
   */
  getTools(): McpTool[] {
    return this.tools;
  }

  /**
   * 리소스 목록 반환
   */
  getResources(): McpResource[] {
    return this.resources;
  }

  /**
   * 프롬프트 목록 반환
   */
  getPrompts(): McpPrompt[] {
    return this.prompts;
  }

  /**
   * 도구 호출
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return result as McpToolResult;
  }

  /**
   * 리소스 읽기
   */
  async readResource(uri: string): Promise<unknown> {
    return this.sendRequest('resources/read', { uri });
  }

  /**
   * 프롬프트 가져오기
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    return this.sendRequest('prompts/get', {
      name,
      arguments: args,
    });
  }

  /**
   * 도구/리소스/프롬프트 목록 새로고침
   */
  private async refreshCapabilities(): Promise<void> {
    try {
      const toolsResult = await this.sendRequest('tools/list', {}) as { tools: McpTool[] };
      this.tools = toolsResult?.tools ?? [];
    } catch {
      this.tools = [];
    }

    try {
      const resourcesResult = await this.sendRequest('resources/list', {}) as { resources: McpResource[] };
      this.resources = resourcesResult?.resources ?? [];
    } catch {
      this.resources = [];
    }

    try {
      const promptsResult = await this.sendRequest('prompts/list', {}) as { prompts: McpPrompt[] };
      this.prompts = promptsResult?.prompts ?? [];
    } catch {
      this.prompts = [];
    }
  }

  /**
   * JSON-RPC 요청 전송
   */
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(message);
    });
  }

  /**
   * JSON-RPC 알림 전송 (응답 대기 없음)
   */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification) + '\n';
    this.process?.stdin?.write(message);
  }

  /**
   * 수신 데이터 처리 (JSON-RPC 메시지 파싱)
   */
  private handleData(data: string): void {
    this.buffer += data;

    // 줄바꿈으로 메시지 분리
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(line);

        if (response.id !== undefined) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);

            if (response.error) {
              pending.reject(new Error(`MCP Error: ${response.error.message}`));
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch {
        // JSON 파싱 실패 시 무시
        console.error(`[MCP ${this.config.name}] Failed to parse message:`, line);
      }
    }
  }
}

/**
 * McpManager - MCP 서버 관리자
 * 여러 MCP 서버 연결을 중앙 관리
 */
export class McpManager {
  private clients: Map<string, McpClient> = new Map();

  /**
   * MCP 서버 등록 및 연결
   */
  async addServer(config: McpServerConfig): Promise<McpClient> {
    const existing = this.clients.get(config.name);
    if (existing?.isConnected()) {
      return existing;
    }

    const client = new McpClient(config);
    await client.connect();
    this.clients.set(config.name, client);
    return client;
  }

  /**
   * MCP 서버 연결 해제
   */
  removeServer(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  /**
   * 특정 서버의 클라이언트 조회
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  /**
   * 모든 서버의 도구 목록 조회
   */
  getAllTools(): Array<{ server: string; tools: McpTool[] }> {
    const result: Array<{ server: string; tools: McpTool[] }> = [];
    for (const [name, client] of this.clients) {
      result.push({ server: name, tools: client.getTools() });
    }
    return result;
  }

  /**
   * 도구 이름으로 서버 찾기
   */
  findToolServer(toolName: string): { server: string; client: McpClient } | null {
    for (const [name, client] of this.clients) {
      if (client.getTools().some(t => t.name === toolName)) {
        return { server: name, client };
      }
    }
    return null;
  }

  /**
   * 모든 서버 연결 해제
   */
  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }

  /**
   * 연결된 서버 개수
   */
  get serverCount(): number {
    return this.clients.size;
  }
}

export default McpManager;