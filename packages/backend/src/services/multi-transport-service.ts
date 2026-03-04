import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import WebSocket from 'ws';
import type { ServerService } from './server-service.js';
import type { HealthService } from './health-service.js';
import type { SecretsService } from './secrets-service.js';
import { PortManager } from './port-manager.js';
import type { AppDatabase } from '@mcp-platform/db';
import { serverRuntimeLogs } from '@mcp-platform/db';
import { secureLogger } from '../core/secure-logger.js';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STOP_GRACE_PERIOD_MS = 5_000;
const STARTUP_WAIT_MS = 3_000;
const HEALTH_CHECK_DELAY_MS = 5_000;
const MAX_RESTART_ATTEMPTS = 3;
const MAX_LOG_BUFFER = 200;
const RESOURCE_WARNING_THRESHOLD = 40;

export type TransportType = 'sse' | 'websocket' | 'streamable-http';

export interface TransportConfig {
  sse: boolean;
  websocket: boolean;
  streamableHttp: boolean;
}

export interface MultiTransportConfig {
  transports?: Partial<TransportConfig>;
  healthCheckIntervalMs?: number;
}

interface TransportProcess {
  process: ChildProcess;
  serverId: string;
  transport: TransportType;
  port: number;
  healthy: boolean;
  restartCount: number;
  logBuffer: string[];
}

export interface TransportStatus {
  serverId: string;
  transport: TransportType;
  port: number;
  running: boolean;
  healthy: boolean;
  url: string;
}

export class MultiTransportService extends EventEmitter {
  private processes = new Map<string, TransportProcess>();
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private portManager: PortManager;
  private transportConfig: TransportConfig;
  private healthCheckIntervalMs: number;

  constructor(
    private serverService: ServerService,
    private healthService: HealthService,
    private secretsService: SecretsService | null,
    private db: AppDatabase,
    config?: MultiTransportConfig,
  ) {
    super();
    this.portManager = new PortManager();
    this.transportConfig = {
      sse: config?.transports?.sse ?? (process.env.TRANSPORT_SSE !== 'false'),
      websocket: config?.transports?.websocket ?? (process.env.TRANSPORT_WEBSOCKET !== 'false'),
      streamableHttp: config?.transports?.streamableHttp ?? (process.env.TRANSPORT_STREAMABLE !== 'false'),
    };
    this.healthCheckIntervalMs = config?.healthCheckIntervalMs ?? 30_000;
  }

  async start(): Promise<{ started: number; failed: number }> {
    const servers = await this.serverService.listServers();
    const enabledTransports = this.getEnabledTransports();

    // Resource estimation warning
    const estimatedProcesses = servers.length * enabledTransports.length;
    if (estimatedProcesses > RESOURCE_WARNING_THRESHOLD) {
      console.log(`[multi-transport] Warning: spawning ~${estimatedProcesses} processes (~${estimatedProcesses * 80}MB estimated)`);
    }

    let started = 0;
    let failed = 0;

    const tasks = servers.flatMap(server => {
      // Only start stdio servers (SSE/streamable-http servers don't need SuperGateway wrapping)
      if (server.transport !== 'stdio' || !server.command) return [];
      const autoStart = (server as Record<string, unknown>).autoStart ?? true;
      if (!autoStart) return [];

      return enabledTransports.map(transport => ({ server, transport }));
    });

    const results = await Promise.allSettled(
      tasks.map(({ server, transport }) => this.startTransport(server, transport))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) started++;
      else failed++;
    }

    console.log(`[multi-transport] Started ${started} transport processes, ${failed} failed`);
    return { started, failed };
  }

  async stop(): Promise<void> {
    const keys = Array.from(this.processes.keys());
    await Promise.allSettled(
      keys.map(key => this.stopTransportByKey(key))
    );
    console.log('[multi-transport] All transport processes stopped');
  }

  async shutdown(): Promise<void> {
    this.stopHealthMonitoring();
    await this.stop();
  }

  getTransportStatus(): TransportStatus[] {
    return Array.from(this.processes.values()).map(tp => ({
      serverId: tp.serverId,
      transport: tp.transport,
      port: tp.port,
      running: !tp.process.killed,
      healthy: tp.healthy,
      url: this.getTransportUrl(tp.transport, tp.port),
    }));
  }

  getTransportConfig(): TransportConfig {
    return { ...this.transportConfig };
  }

  setTransportConfig(config: Partial<TransportConfig>): void {
    if (config.sse !== undefined) this.transportConfig.sse = config.sse;
    if (config.websocket !== undefined) this.transportConfig.websocket = config.websocket;
    if (config.streamableHttp !== undefined) this.transportConfig.streamableHttp = config.streamableHttp;
  }

  // --- Health Monitoring ---

  startHealthMonitoring(): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => this.runHealthChecks(), this.healthCheckIntervalMs);
  }

  stopHealthMonitoring(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // --- Private: Transport Lifecycle ---

  private async startTransport(
    server: { id: string; name: string; command?: string | null; args?: string[] | null; cwd?: string | null },
    transport: TransportType,
  ): Promise<boolean> {
    const key = `${server.id}-${transport}`;
    if (this.processes.has(key)) return true;

    const port = this.portManager.allocatePort(key);
    if (port === null) {
      console.error(`[multi-transport] No available port for ${key}`);
      return false;
    }

    const env = await this.buildProcessEnv(server.id);
    const mcpCommand = this.buildMcpCommand(server);

    const args = [
      'supergateway',
      '--stdio', mcpCommand,
      '--port', port.toString(),
      '--host', '0.0.0.0',
      '--healthEndpoint', '/health',
      '--logLevel', process.env.SUPERGATEWAY_LOG_LEVEL ?? 'info',
    ];

    // Add transport-specific output
    if (transport === 'websocket') {
      args.push('--outputTransport', 'ws');
    } else if (transport === 'streamable-http') {
      args.push('--outputTransport', 'streamableHttp');
    }
    // SSE is the default SuperGateway output, no flag needed

    try {
      const proc = spawn('npx', ['-y', ...args], {
        env,
        cwd: server.cwd ?? undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const tp: TransportProcess = {
        process: proc,
        serverId: server.id,
        transport,
        port,
        healthy: false,
        restartCount: 0,
        logBuffer: [],
      };

      this.processes.set(key, tp);
      this.setupTransportHandlers(key, tp);

      // Wait for startup, then check health
      await new Promise(resolve => setTimeout(resolve, STARTUP_WAIT_MS));
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_DELAY_MS));

      const healthy = await this.checkTransportHealth(transport, port);
      tp.healthy = healthy;

      if (healthy) {
        console.log(`[multi-transport] ${server.name}/${transport} started on port ${port}`);
        this.emit('transport:started', { serverId: server.id, transport, port });
        return true;
      }

      // Not healthy — clean up
      this.processes.delete(key);
      proc.kill('SIGTERM');
      this.portManager.deallocatePort(key);
      console.warn(`[multi-transport] ${server.name}/${transport} failed health check`);
      return false;
    } catch (err) {
      this.processes.delete(key);
      this.portManager.deallocatePort(key);
      console.error(`[multi-transport] Failed to start ${key}: ${(err as Error).message}`);
      return false;
    }
  }

  private async stopTransportByKey(key: string): Promise<void> {
    const tp = this.processes.get(key);
    if (!tp) return;

    tp.process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!tp.process.killed) tp.process.kill('SIGKILL');
        resolve();
      }, STOP_GRACE_PERIOD_MS);
      tp.process.on('exit', () => { clearTimeout(timeout); resolve(); });
    });

    this.processes.delete(key);
    this.portManager.deallocatePort(key);
    this.emit('transport:stopped', { serverId: tp.serverId, transport: tp.transport });
  }

  private setupTransportHandlers(key: string, tp: TransportProcess): void {
    tp.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      tp.logBuffer.push(line);
      if (tp.logBuffer.length > MAX_LOG_BUFFER) tp.logBuffer.shift();
      this.persistLog(tp.serverId, tp.transport, 'stdout', line);
    });

    tp.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      tp.logBuffer.push(line);
      if (tp.logBuffer.length > MAX_LOG_BUFFER) tp.logBuffer.shift();
      this.persistLog(tp.serverId, tp.transport, 'stderr', line);
    });

    tp.process.on('exit', (code, signal) => {
      console.log(`[multi-transport] ${key} exited (code: ${code}, signal: ${signal})`);
      const existing = this.processes.get(key);
      if (!existing) return;

      existing.restartCount++;
      this.processes.delete(key);
      this.portManager.deallocatePort(key);

      if (existing.restartCount < MAX_RESTART_ATTEMPTS) {
        const delay = 2_000 * Math.pow(2, existing.restartCount - 1);
        console.log(`[multi-transport] Restarting ${key} in ${delay}ms`);
        setTimeout(async () => {
          try {
            const server = await this.serverService.getServer(tp.serverId);
            if (server) await this.startTransport(server, tp.transport);
          } catch (err) {
            console.error(`[multi-transport] Restart failed for ${key}: ${(err as Error).message}`);
          }
        }, delay);
      }
    });
  }

  // --- Health Checks ---

  private async runHealthChecks(): Promise<void> {
    for (const [key, tp] of this.processes) {
      try {
        const startTime = Date.now();
        const healthy = await this.checkTransportHealth(tp.transport, tp.port);
        const responseTime = Date.now() - startTime;

        tp.healthy = healthy;

        await this.healthService.recordHealth({
          serverId: `${tp.serverId}-${tp.transport}`,
          healthy,
          responseTime,
          error: healthy ? null : `${tp.transport} health check failed`,
        });
      } catch {
        tp.healthy = false;
      }
    }
  }

  private async checkTransportHealth(transport: TransportType, port: number): Promise<boolean> {
    switch (transport) {
      case 'sse':
        return this.checkSSEHealth(port);
      case 'websocket':
        return this.checkWebSocketHealth(port);
      case 'streamable-http':
        return this.checkStreamableHealth(port);
    }
  }

  private async checkSSEHealth(port: number): Promise<boolean> {
    const endpoints = [`http://localhost:${port}/health`, `http://localhost:${port}/`];
    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          headers: { Accept: 'text/event-stream' },
        });
        if (response.status < 500) return true;
      } catch { /* try next */ }
    }
    return false;
  }

  private async checkWebSocketHealth(port: number): Promise<boolean> {
    const endpoints = [`ws://localhost:${port}/`, `ws://localhost:${port}/ws`];
    for (const url of endpoints) {
      try {
        const healthy = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(url);
          const timeout = setTimeout(() => { ws.terminate(); resolve(false); }, HEALTH_CHECK_TIMEOUT_MS);
          ws.on('open', () => { clearTimeout(timeout); ws.close(); resolve(true); });
          ws.on('error', () => { clearTimeout(timeout); resolve(false); });
          // Unexpected response (400) still means the server is alive
          ws.on('unexpected-response', () => { clearTimeout(timeout); resolve(true); });
        });
        if (healthy) return true;
      } catch { /* try next */ }
    }
    return false;
  }

  private async checkStreamableHealth(port: number): Promise<boolean> {
    const endpoints = [`http://localhost:${port}/health`, `http://localhost:${port}/message`, `http://localhost:${port}/`];
    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        });
        if (response.status < 500) return true;
      } catch { /* try next */ }
    }
    return false;
  }

  // --- Helpers ---

  private getEnabledTransports(): TransportType[] {
    const transports: TransportType[] = [];
    if (this.transportConfig.sse) transports.push('sse');
    if (this.transportConfig.websocket) transports.push('websocket');
    if (this.transportConfig.streamableHttp) transports.push('streamable-http');
    return transports;
  }

  private buildMcpCommand(server: { command?: string | null; args?: string[] | null }): string {
    const cmd = server.command ?? '';
    const args = (server.args ?? []).map(arg =>
      arg.includes(' ') ? `"${arg.replace(/"/g, '\\"')}"` : arg
    );
    return [cmd, ...args].join(' ');
  }

  private getTransportUrl(transport: TransportType, port: number): string {
    switch (transport) {
      case 'sse': return `http://localhost:${port}/sse`;
      case 'websocket': return `ws://localhost:${port}/`;
      case 'streamable-http': return `http://localhost:${port}/message`;
    }
  }

  private async buildProcessEnv(serverId: string): Promise<Record<string, string>> {
    let decrypted: Record<string, string> = {};
    if (this.secretsService) {
      try {
        decrypted = await this.secretsService.getDecryptedEnvVars(serverId);
      } catch { /* no env vars */ }
    }

    return {
      ...(process.env as Record<string, string>),
      ...decrypted,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
    };
  }

  private persistLog(serverId: string, transport: string, stream: string, message: string): void {
    try {
      const maskedMessage = secureLogger.maskSensitiveString(message);
      this.db.insert(serverRuntimeLogs).values({
        id: crypto.randomUUID(),
        serverId: `${serverId}-${transport}`,
        stream,
        message: maskedMessage,
      }).run();
    } catch { /* non-critical */ }
  }
}
