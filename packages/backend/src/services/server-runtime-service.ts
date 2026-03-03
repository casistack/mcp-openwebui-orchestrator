import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ServerService } from './server-service.js';
import type { HealthService } from './health-service.js';
import type { SecretsService } from './secrets-service.js';
import { PortManager } from './port-manager.js';
import type { AppDatabase } from '@mcp-platform/db';
import { serverRuntimeLogs, mcpServers, eq } from '@mcp-platform/db';

const ALLOWED_COMMANDS = new Set(['npx', 'uvx', 'uv', 'python', 'node', 'docker']);

const MAX_LOG_BUFFER = 200;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STOP_GRACE_PERIOD_MS = 3_000;
const STARTUP_WAIT_MS = 8_000;
const STARTUP_WAIT_SSE_MS = 15_000;

interface ManagedProcess {
  process: ChildProcess;
  serverId: string;
  port: number;
  proxyType: string;
  startedAt: Date;
  restartCount: number;
  healthy: boolean;
  lastError: string | null;
  logBuffer: string[];
}

export interface RuntimeStatus {
  serverId: string;
  status: string;
  pid: number | null;
  port: number | null;
  proxyType: string | null;
  startedAt: Date | null;
  restartCount: number;
  healthy: boolean;
  lastError: string | null;
}

export interface RuntimeConfig {
  defaultProxyType: 'mcpo' | 'mcp-bridge';
  allowFallback: boolean;
  maxRestartAttempts: number;
  healthCheckIntervalMs: number;
}

export class ServerRuntimeService extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private portManager: PortManager;
  private config: RuntimeConfig;

  constructor(
    private serverService: ServerService,
    private healthService: HealthService,
    private secretsService: SecretsService | null,
    private db: AppDatabase,
    config?: Partial<RuntimeConfig>,
  ) {
    super();
    this.portManager = new PortManager();
    this.config = {
      defaultProxyType: (process.env.MCP_PROXY_TYPE as 'mcpo' | 'mcp-bridge') ?? 'mcpo',
      allowFallback: true,
      maxRestartAttempts: 3,
      healthCheckIntervalMs: 30_000,
      ...config,
    };
  }

  async startServer(serverId: string): Promise<boolean> {
    if (this.processes.has(serverId)) {
      return true; // Already running
    }

    const server = await this.serverService.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Validate command for stdio servers
    if (server.transport === 'stdio') {
      if (!server.command) {
        throw new Error(`Server ${serverId} has no command configured`);
      }
      const baseCmd = path.basename(server.command.split(' ')[0]);
      if (!ALLOWED_COMMANDS.has(baseCmd)) {
        throw new Error(`Command "${baseCmd}" is not in the allowed commands list`);
      }
    }

    const port = this.portManager.allocatePort(serverId);
    if (port === null) {
      throw new Error('No available ports in the configured range');
    }

    await this.updateRuntimeState(serverId, {
      runtimeStatus: 'starting',
      runtimePort: port,
    });

    const proxyType = server.proxyType ?? this.config.defaultProxyType;

    try {
      const proc = await this.spawnProxy(server, port, proxyType);
      const managed: ManagedProcess = {
        process: proc,
        serverId,
        port,
        proxyType,
        startedAt: new Date(),
        restartCount: 0,
        healthy: false,
        lastError: null,
        logBuffer: [],
      };
      this.processes.set(serverId, managed);
      this.setupProcessHandlers(serverId, proc, managed);

      // Wait for startup
      const waitMs = server.transport === 'stdio' ? STARTUP_WAIT_MS : STARTUP_WAIT_SSE_MS;
      await new Promise(resolve => setTimeout(resolve, waitMs));

      // Initial health check
      managed.healthy = await this.checkProcessHealth(port);

      await this.updateRuntimeState(serverId, {
        runtimeStatus: 'running',
        runtimePid: proc.pid ?? null,
        runtimePort: port,
        runtimeProxyTypeUsed: proxyType,
        runtimeStartedAt: new Date(),
        runtimeRestartCount: 0,
        runtimeLastError: null,
      });

      this.emit('process:started', { serverId, port, pid: proc.pid });
      console.log(`[runtime] Started ${serverId} on port ${port} (${proxyType}, pid: ${proc.pid})`);
      return true;
    } catch (err) {
      this.portManager.deallocatePort(serverId);
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.updateRuntimeState(serverId, {
        runtimeStatus: 'error',
        runtimeLastError: errorMsg,
      });
      throw err;
    }
  }

  async stopServer(serverId: string): Promise<boolean> {
    const managed = this.processes.get(serverId);
    if (!managed) return false;

    await this.updateRuntimeState(serverId, { runtimeStatus: 'stopping' });

    const proc = managed.process;

    // Graceful shutdown: SIGTERM -> wait -> SIGKILL
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, STOP_GRACE_PERIOD_MS);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.processes.delete(serverId);
    this.portManager.deallocatePort(serverId);

    // Clean up MCP-Bridge config if used
    if (managed.proxyType === 'mcp-bridge') {
      this.cleanupBridgeConfig(serverId);
    }

    await this.updateRuntimeState(serverId, {
      runtimeStatus: 'stopped',
      runtimePid: null,
      runtimePort: null,
    });

    this.emit('process:stopped', { serverId });
    console.log(`[runtime] Stopped ${serverId}`);
    return true;
  }

  async restartServer(serverId: string): Promise<boolean> {
    await this.stopServer(serverId);
    await new Promise(resolve => setTimeout(resolve, 1_000));
    return this.startServer(serverId);
  }

  getProcessInfo(serverId: string): RuntimeStatus | null {
    const managed = this.processes.get(serverId);
    if (!managed) return null;
    return {
      serverId,
      status: managed.healthy ? 'running' : 'unhealthy',
      pid: managed.process.pid ?? null,
      port: managed.port,
      proxyType: managed.proxyType,
      startedAt: managed.startedAt,
      restartCount: managed.restartCount,
      healthy: managed.healthy,
      lastError: managed.lastError,
    };
  }

  listRunningProcesses(): RuntimeStatus[] {
    return Array.from(this.processes.values()).map(m => ({
      serverId: m.serverId,
      status: m.healthy ? 'running' : 'unhealthy',
      pid: m.process.pid ?? null,
      port: m.port,
      proxyType: m.proxyType,
      startedAt: m.startedAt,
      restartCount: m.restartCount,
      healthy: m.healthy,
      lastError: m.lastError,
    }));
  }

  async getLogs(serverId: string, limit = 100): Promise<Array<{ stream: string; message: string; createdAt: Date | null }>> {
    const rows = this.db
      .select()
      .from(serverRuntimeLogs)
      .all();

    return rows
      .filter((r: { serverId: string }) => r.serverId === serverId)
      .sort((a: { createdAt: Date | null }, b: { createdAt: Date | null }) =>
        (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, limit)
      .reverse()
      .map((r: { stream: string; message: string; createdAt: Date | null }) => ({
        stream: r.stream,
        message: r.message,
        createdAt: r.createdAt,
      }));
  }

  getPortManager(): PortManager {
    return this.portManager;
  }

  // --- Health Monitoring ---

  startHealthMonitoring(): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => this.runHealthChecks(), this.config.healthCheckIntervalMs);
  }

  stopHealthMonitoring(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [serverId, managed] of this.processes) {
      try {
        const startTime = Date.now();
        const healthy = await this.checkProcessHealth(managed.port);
        const responseTime = Date.now() - startTime;

        managed.healthy = healthy;
        await this.healthService.recordHealth({
          serverId,
          healthy,
          responseTime,
          error: healthy ? null : 'Health check failed',
        });

        if (!healthy) {
          managed.lastError = 'Health check failed';
        }
      } catch (err) {
        managed.healthy = false;
        managed.lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private async checkProcessHealth(port: number): Promise<boolean> {
    const endpoints = [
      `http://localhost:${port}/openapi.json`,
      `http://localhost:${port}/docs`,
      `http://localhost:${port}/`,
    ];
    for (const url of endpoints) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
        if (response.ok) return true;
      } catch {
        // Try next endpoint
      }
    }
    return false;
  }

  // --- Lifecycle ---

  async startAll(): Promise<{ started: number; failed: number }> {
    const servers = await this.serverService.listServers();
    let started = 0;
    let failed = 0;

    for (const server of servers) {
      if (server.transport === 'stdio' && server.command) {
        try {
          await this.startServer(server.id);
          started++;
        } catch (err) {
          console.warn(`[runtime] Failed to start ${server.id}: ${(err as Error).message}`);
          failed++;
        }
      }
    }

    return { started, failed };
  }

  async stopAll(): Promise<void> {
    const serverIds = Array.from(this.processes.keys());
    for (const serverId of serverIds) {
      try {
        await this.stopServer(serverId);
      } catch (err) {
        console.warn(`[runtime] Failed to stop ${serverId}: ${(err as Error).message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopHealthMonitoring();
    await this.stopAll();
  }

  // --- Private: Process Spawning ---

  private async spawnProxy(
    server: { id: string; transport: string; command?: string | null; args?: string[] | null; cwd?: string | null; url?: string | null; headers?: Record<string, string> | null },
    port: number,
    proxyType: string,
  ): Promise<ChildProcess> {
    if (proxyType === 'mcp-bridge') {
      return this.spawnMCPBridge(server, port);
    }

    // Default to MCPO
    switch (server.transport) {
      case 'sse':
        return this.spawnMCPOForSSE(server, port);
      case 'streamable-http':
        return this.spawnMCPOForStreamableHttp(server, port);
      default:
        return this.spawnMCPO(server, port);
    }
  }

  private async spawnMCPO(
    server: { id: string; command?: string | null; args?: string[] | null; cwd?: string | null },
    port: number,
  ): Promise<ChildProcess> {
    const env = await this.buildProcessEnv(server.id);
    const args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString()];
    args.push('--', server.command!, ...(server.args ?? []));
    return spawn('uvx', args, {
      env,
      cwd: server.cwd ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async spawnMCPOForSSE(
    server: { id: string; url?: string | null; headers?: Record<string, string> | null },
    port: number,
  ): Promise<ChildProcess> {
    const env = await this.buildProcessEnv(server.id);
    const args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString(), '--server-type', 'sse'];
    if (server.headers && Object.keys(server.headers).length > 0) {
      args.push('--header', JSON.stringify(server.headers));
    }
    args.push('--', server.url!);
    return spawn('uvx', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async spawnMCPOForStreamableHttp(
    server: { id: string; url?: string | null; headers?: Record<string, string> | null },
    port: number,
  ): Promise<ChildProcess> {
    const env = await this.buildProcessEnv(server.id);
    const args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString(), '--server-type', 'streamable-http'];
    if (server.headers && Object.keys(server.headers).length > 0) {
      args.push('--header', JSON.stringify(server.headers));
    }
    args.push('--', server.url!);
    return spawn('uvx', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async spawnMCPBridge(
    server: { id: string; command?: string | null; args?: string[] | null; cwd?: string | null },
    port: number,
  ): Promise<ChildProcess> {
    const configDir = `/app/tmp/mcp-bridge-configs/${server.id}`;
    fs.mkdirSync(configDir, { recursive: true });

    const bridgeConfig = {
      inference_server: { base_url: 'http://localhost:11434/v1', api_key: 'dummy' },
      mcp_servers: {
        [server.id]: {
          command: server.command,
          args: server.args ?? [],
        },
      },
      network: { host: '0.0.0.0', port },
      logging: { log_level: 'INFO' },
    };

    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(bridgeConfig, null, 2));

    const env = await this.buildProcessEnv(server.id);
    return spawn('uvx', ['mcp-bridge'], {
      env,
      cwd: configDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  // --- Private: Process Management ---

  private setupProcessHandlers(serverId: string, proc: ChildProcess, managed: ManagedProcess): void {
    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      managed.logBuffer.push(line);
      if (managed.logBuffer.length > MAX_LOG_BUFFER) {
        managed.logBuffer.shift();
      }
      this.persistLog(serverId, 'stdout', line);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      managed.logBuffer.push(line);
      if (managed.logBuffer.length > MAX_LOG_BUFFER) {
        managed.logBuffer.shift();
      }
      this.persistLog(serverId, 'stderr', line);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[runtime] Process ${serverId} exited (code: ${code}, signal: ${signal})`);
      if (this.processes.has(serverId)) {
        // Unexpected exit — attempt restart
        this.handleProcessCrash(serverId, code, signal);
      }
    });

    proc.on('error', (err) => {
      console.error(`[runtime] Process ${serverId} error: ${err.message}`);
      managed.lastError = err.message;
    });
  }

  private async handleProcessCrash(serverId: string, code: number | null, _signal: string | null): Promise<void> {
    const managed = this.processes.get(serverId);
    if (!managed) return;

    managed.restartCount++;
    this.processes.delete(serverId);
    this.portManager.deallocatePort(serverId);

    if (managed.restartCount >= this.config.maxRestartAttempts) {
      await this.updateRuntimeState(serverId, {
        runtimeStatus: 'crashed',
        runtimePid: null,
        runtimePort: null,
        runtimeRestartCount: managed.restartCount,
        runtimeLastError: `Max restart attempts (${this.config.maxRestartAttempts}) exceeded. Last exit code: ${code}`,
      });
      this.emit('process:crashed', { serverId, restartCount: managed.restartCount });
      console.error(`[runtime] ${serverId} crashed after ${managed.restartCount} restart attempts`);
      return;
    }

    const delay = 2_000 * Math.pow(2, managed.restartCount - 1);
    console.log(`[runtime] ${serverId} crashed (attempt ${managed.restartCount}/${this.config.maxRestartAttempts}), restarting in ${delay}ms`);

    await this.updateRuntimeState(serverId, {
      runtimeStatus: 'starting',
      runtimeRestartCount: managed.restartCount,
      runtimeLastError: `Restarting after exit code ${code}`,
    });

    setTimeout(async () => {
      try {
        await this.startServer(serverId);
      } catch (err) {
        console.error(`[runtime] Failed to restart ${serverId}: ${(err as Error).message}`);
      }
    }, delay);
  }

  private async updateRuntimeState(serverId: string, state: Record<string, unknown>): Promise<void> {
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      updateData[key] = value instanceof Date ? Math.floor(value.getTime() / 1000) : value ?? null;
    }

    if (Object.keys(updateData).length === 0) return;

    this.db
      .update(mcpServers)
      .set(updateData)
      .where(eq(mcpServers.id, serverId))
      .run();
  }

  private persistLog(serverId: string, stream: string, message: string): void {
    try {
      this.db.insert(serverRuntimeLogs).values({
        id: crypto.randomUUID(),
        serverId,
        stream,
        message,
      }).run();
    } catch {
      // Non-critical — log persistence failure shouldn't crash the service
    }
  }

  private async buildProcessEnv(serverId: string): Promise<Record<string, string>> {
    let decrypted: Record<string, string> = {};
    if (this.secretsService) {
      try {
        decrypted = await this.secretsService.getDecryptedEnvVars(serverId);
      } catch {
        // No env vars or decryption failed — proceed without
      }
    }

    return {
      ...(process.env as Record<string, string>),
      ...decrypted,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
    };
  }

  private cleanupBridgeConfig(serverId: string): void {
    const configDir = `/app/tmp/mcp-bridge-configs/${serverId}`;
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch {
      // Non-critical
    }
  }
}
