import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
}

export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

export interface MCPClientConfig {
  id: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export type MCPClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * MCP protocol client supporting stdio, SSE, and streamable-http transports.
 * Implements the JSON-RPC 2.0 based MCP protocol.
 */
export class MCPClient extends EventEmitter {
  readonly config: MCPClientConfig;
  private _status: MCPClientStatus = 'disconnected';
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // stdio transport
  private process: ChildProcess | null = null;
  private stdioBuffer = '';

  // SSE transport
  private sseAbort: AbortController | null = null;
  private sseMessagesUrl: string | null = null;

  private serverInfo: MCPInitializeResult | null = null;
  private discoveredTools: MCPTool[] = [];

  static readonly REQUEST_TIMEOUT = 30_000;

  constructor(config: MCPClientConfig) {
    super();
    this.config = config;
  }

  get status(): MCPClientStatus { return this._status; }
  get tools(): MCPTool[] { return this.discoveredTools; }
  get info(): MCPInitializeResult | null { return this.serverInfo; }

  private setStatus(status: MCPClientStatus) {
    this._status = status;
    this.emit('status', status);
  }

  /**
   * Connect to the MCP server and perform the initialize handshake.
   */
  async connect(): Promise<MCPInitializeResult> {
    this.setStatus('connecting');

    try {
      switch (this.config.transport) {
        case 'stdio':
          await this.connectStdio();
          break;
        case 'sse':
          await this.connectSSE();
          break;
        case 'streamable-http':
          // No persistent connection needed - stateless HTTP
          break;
        default:
          throw new Error(`Unsupported transport: ${this.config.transport}`);
      }

      // Initialize handshake
      const result = await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-platform', version: '0.1.0' },
      }) as MCPInitializeResult;

      this.serverInfo = result;

      // Send initialized notification
      await this.notify('notifications/initialized', {});

      this.setStatus('connected');
      this.emit('connected', result);

      return result;
    } catch (err) {
      this.setStatus('error');
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    // Cancel all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
      this.pendingRequests.delete(id);
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }

    this.sseMessagesUrl = null;
    this.setStatus('disconnected');
    this.emit('disconnected');
  }

  /**
   * List available tools on the server.
   */
  async listTools(): Promise<MCPTool[]> {
    const result = await this.request('tools/list', {}) as { tools: MCPTool[] };
    this.discoveredTools = result.tools ?? [];
    return this.discoveredTools;
  }

  /**
   * Call a tool on the server.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    const result = await this.request('tools/call', { name, arguments: args });
    return result as MCPToolCallResult;
  }

  /**
   * Ping the server.
   */
  async ping(): Promise<{ latencyMs: number }> {
    const start = Date.now();
    await this.request('ping', {});
    return { latencyMs: Date.now() - start };
  }

  // --- Transport: stdio ---

  private connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        reject(new Error('stdio transport requires a command'));
        return;
      }

      const args = this.config.args ?? [];
      const env = { ...process.env, ...this.config.env };

      this.process = spawn(this.config.command, args, {
        cwd: this.config.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', (err) => {
        this.setStatus('error');
        this.emit('error', err);
      });

      this.process.on('exit', (code) => {
        if (this._status === 'connected') {
          this.setStatus('disconnected');
          this.emit('disconnected', { code });
        }
      });

      this.process.stdout!.on('data', (chunk: Buffer) => {
        this.stdioBuffer += chunk.toString();
        this.processStdioBuffer();
      });

      this.process.stderr!.on('data', (chunk: Buffer) => {
        this.emit('stderr', chunk.toString());
      });

      // Give the process a moment to start, then resolve
      // The actual validation happens during the initialize handshake
      setTimeout(resolve, 100);
    });
  }

  private processStdioBuffer() {
    const lines = this.stdioBuffer.split('\n');
    this.stdioBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this.handleResponse(msg);
      } catch {
        // Not JSON - could be startup output, ignore
      }
    }
  }

  private sendStdio(msg: unknown): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('stdio process not available');
    }
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  // --- Transport: SSE ---

  private async connectSSE(): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE transport requires a URL');
    }

    this.sseAbort = new AbortController();
    const headers: Record<string, string> = { ...this.config.headers };

    const response = await fetch(this.config.url, {
      headers,
      signal: this.sseAbort.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    // Read the SSE stream in background
    this.readSSEStream(response.body);

    // Wait for the endpoint event that tells us where to send messages
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSE endpoint event timeout')), 10_000);

      const handler = (url: string) => {
        clearTimeout(timeout);
        this.sseMessagesUrl = url;
        this.off('sse:endpoint', handler);
        resolve();
      };
      this.on('sse:endpoint', handler);
    });
  }

  private async readSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (eventType === 'endpoint') {
              // The server sends us the URL to post messages to
              const messagesUrl = data.startsWith('http')
                ? data
                : new URL(data, this.config.url).toString();
              this.emit('sse:endpoint', messagesUrl);
            } else if (eventType === 'message') {
              try {
                const msg = JSON.parse(data);
                this.handleResponse(msg);
              } catch {
                // Invalid JSON in SSE event
              }
            }
            eventType = '';
          } else if (line === '') {
            eventType = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.emit('error', err);
      }
    }
  }

  private async sendSSE(msg: unknown): Promise<void> {
    if (!this.sseMessagesUrl) {
      throw new Error('SSE messages URL not established');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    const response = await fetch(this.sseMessagesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
    });

    if (!response.ok) {
      throw new Error(`SSE message send failed: ${response.status}`);
    }
  }

  // --- Transport: Streamable HTTP ---

  private async sendStreamableHTTP(msg: unknown): Promise<unknown> {
    if (!this.config.url) {
      throw new Error('Streamable HTTP transport requires a URL');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }

  // --- JSON-RPC ---

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const msg = { jsonrpc: '2.0', id, method, params };

    if (this.config.transport === 'streamable-http') {
      // Streamable HTTP is request/response - no pending tracking needed
      const response = await this.sendStreamableHTTP(msg);
      const rpc = response as { result?: unknown; error?: { code: number; message: string } };
      if (rpc.error) {
        throw new Error(`MCP error ${rpc.error.code}: ${rpc.error.message}`);
      }
      return rpc.result;
    }

    // For stdio and SSE, use pending request tracking
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (${MCPClient.REQUEST_TIMEOUT}ms)`));
      }, MCPClient.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        if (this.config.transport === 'stdio') {
          this.sendStdio(msg);
        } else if (this.config.transport === 'sse') {
          this.sendSSE(msg).catch(reject);
        }
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const msg = { jsonrpc: '2.0', method, params };

    if (this.config.transport === 'streamable-http') {
      await this.sendStreamableHTTP(msg);
    } else if (this.config.transport === 'stdio') {
      this.sendStdio(msg);
    } else if (this.config.transport === 'sse') {
      await this.sendSSE(msg);
    }
  }

  private handleResponse(msg: { id?: number; result?: unknown; error?: { code: number; message: string } }) {
    if (msg.id == null) return; // notification, not a response

    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }
}
