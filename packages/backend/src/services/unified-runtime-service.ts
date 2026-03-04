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
import { secureLogger } from '../core/secure-logger.js';
import { classifyError, isInformationalMessage } from '../core/error-classifier.js';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STOP_GRACE_PERIOD_MS = 3_000;
const STARTUP_WAIT_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 3;
const MAX_LOG_BUFFER = 200;

export interface UnifiedConfig {
  port?: number;
  host?: string;
  healthCheckIntervalMs?: number;
}

export interface ServerRoute {
  id: string;
  name: string;
  route: string;
  docsUrl: string;
  baseUrl: string;
}

export class UnifiedRuntimeService extends EventEmitter {
  private mcpoProcess: ChildProcess | null = null;
  private mcpoPort: number | null = null;
  private healthy = false;
  private restartCount = 0;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private portManager: PortManager;
  private configFilePath: string;
  private logBuffer: string[] = [];
  private config: Required<UnifiedConfig>;

  constructor(
    private serverService: ServerService,
    private healthService: HealthService,
    private secretsService: SecretsService | null,
    private db: AppDatabase,
    config?: UnifiedConfig,
  ) {
    super();
    this.portManager = new PortManager();
    this.configFilePath = '/app/tmp/unified-mcpo-config.json';
    this.config = {
      port: config?.port ?? 4200,
      host: config?.host ?? '0.0.0.0',
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 30_000,
    };
  }

  async start(): Promise<boolean> {
    if (this.mcpoProcess) return true;

    // Generate config from DB servers
    await this.generateConfigFile();

    // Allocate the unified port
    const port = this.portManager.allocatePort('unified-mcpo') ?? this.config.port;
    this.mcpoPort = port;

    const env = await this.buildProcessEnv();
    const args = [
      'mcpo',
      '--host', this.config.host,
      '--port', port.toString(),
      '--config', this.configFilePath,
      '--hot-reload',
    ];

    try {
      this.mcpoProcess = spawn('uvx', args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.setupProcessHandlers();

      // Wait for startup
      await new Promise(resolve => setTimeout(resolve, STARTUP_WAIT_MS));

      // Health check
      const result = await this.checkHealth();
      this.healthy = result.healthy;

      if (this.healthy) {
        console.log(`[unified] Started on port ${port} (pid: ${this.mcpoProcess.pid})`);
        this.emit('unified:started', { port, pid: this.mcpoProcess.pid });

        // Mark all servers as running in unified mode
        await this.markServersRunning(port);
        return true;
      }

      // Not healthy — clean up
      this.mcpoProcess.kill('SIGTERM');
      this.mcpoProcess = null;
      this.portManager.deallocatePort('unified-mcpo');
      this.mcpoPort = null;
      throw new Error('Unified MCPO failed health check after startup');
    } catch (err) {
      this.mcpoProcess = null;
      this.portManager.deallocatePort('unified-mcpo');
      this.mcpoPort = null;
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.mcpoProcess) return;

    const proc = this.mcpoProcess;
    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
        resolve();
      }, STOP_GRACE_PERIOD_MS);
      proc.on('exit', () => { clearTimeout(timeout); resolve(); });
    });

    this.mcpoProcess = null;
    this.portManager.deallocatePort('unified-mcpo');
    this.healthy = false;

    // Mark all servers as stopped
    await this.markServersStopped();

    this.mcpoPort = null;
    console.log('[unified] Stopped');
    this.emit('unified:stopped');
  }

  async restart(): Promise<boolean> {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    return this.start();
  }

  isRunning(): boolean {
    return this.mcpoProcess !== null && !this.mcpoProcess.killed;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  getPort(): number | null {
    return this.mcpoPort;
  }

  getPid(): number | null {
    return this.mcpoProcess?.pid ?? null;
  }

  async getServerRoutes(): Promise<ServerRoute[]> {
    if (!this.mcpoPort) return [];
    const servers = await this.serverService.listServers();
    return servers.map(s => ({
      id: s.id,
      name: s.displayName || s.name,
      route: `/${s.name}`,
      docsUrl: `http://localhost:${this.mcpoPort}/${s.name}/docs`,
      baseUrl: `http://localhost:${this.mcpoPort}/${s.name}`,
    }));
  }

  getStatus() {
    return {
      mode: 'unified' as const,
      running: this.isRunning(),
      healthy: this.healthy,
      port: this.mcpoPort,
      pid: this.mcpoProcess?.pid ?? null,
      restartCount: this.restartCount,
    };
  }

  // Regenerate config when servers change in DB
  async refreshConfig(): Promise<void> {
    await this.generateConfigFile();
    // MCPO hot-reload will pick up the change automatically
    console.log('[unified] Config refreshed (hot-reload will pick it up)');
  }

  // --- Health Monitoring ---

  startHealthMonitoring(): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => this.runHealthCheck(), this.config.healthCheckIntervalMs);
  }

  stopHealthMonitoring(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  async shutdown(): Promise<void> {
    this.stopHealthMonitoring();
    await this.stop();
  }

  // --- Private ---

  private async generateConfigFile(): Promise<void> {
    const servers = await this.serverService.listServers();
    const mcpServersConfig: Record<string, Record<string, unknown>> = {};

    for (const server of servers) {
      const autoStart = (server as Record<string, unknown>).autoStart ?? true;
      if (!autoStart) continue;

      const entry: Record<string, unknown> = {};

      if (server.transport === 'stdio' && server.command) {
        entry.command = server.command;
        entry.args = server.args ?? [];
        if (server.cwd) entry.cwd = server.cwd;
      } else if ((server.transport === 'sse' || server.transport === 'streamable-http') && server.url) {
        entry.transport = server.transport;
        entry.url = server.url;
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = server.headers;
        }
      } else {
        continue; // Skip servers without valid config
      }

      // Decrypt and attach env vars
      if (this.secretsService) {
        try {
          const decrypted = await this.secretsService.getDecryptedEnvVars(server.id);
          if (Object.keys(decrypted).length > 0) {
            entry.env = decrypted;
          }
        } catch { /* no env vars */ }
      }

      mcpServersConfig[server.name] = entry;
    }

    const configContent = { mcpServers: mcpServersConfig };
    const configDir = path.dirname(this.configFilePath);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(this.configFilePath, JSON.stringify(configContent, null, 2));
  }

  private setupProcessHandlers(): void {
    if (!this.mcpoProcess) return;

    this.mcpoProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      this.logBuffer.push(line);
      if (this.logBuffer.length > MAX_LOG_BUFFER) this.logBuffer.shift();
      this.persistLog('stdout', line);
    });

    this.mcpoProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      this.logBuffer.push(line);
      if (this.logBuffer.length > MAX_LOG_BUFFER) this.logBuffer.shift();
      this.persistLog('stderr', line);

      if (!isInformationalMessage(line)) {
        const classified = classifyError(line);
        if (classified) {
          this.emit('unified:error', classified);
        }
      }
    });

    this.mcpoProcess.on('exit', (code, signal) => {
      console.log(`[unified] Process exited (code: ${code}, signal: ${signal})`);
      this.mcpoProcess = null;
      this.healthy = false;

      if (this.restartCount < MAX_RESTART_ATTEMPTS) {
        this.restartCount++;
        const delay = 2_000 * Math.pow(2, this.restartCount - 1);
        console.log(`[unified] Restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RESTART_ATTEMPTS})`);
        setTimeout(() => {
          this.start().catch(err => {
            console.error(`[unified] Restart failed: ${(err as Error).message}`);
          });
        }, delay);
      } else {
        console.error(`[unified] Max restart attempts (${MAX_RESTART_ATTEMPTS}) exceeded`);
        this.emit('unified:crashed', { restartCount: this.restartCount });
      }
    });

    this.mcpoProcess.on('error', (err) => {
      console.error(`[unified] Process error: ${err.message}`);
    });
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.mcpoProcess || !this.mcpoPort) return;

    const startTime = Date.now();
    const result = await this.checkHealth();
    const responseTime = Date.now() - startTime;

    this.healthy = result.healthy;

    // Record health for the unified endpoint
    await this.healthService.recordHealth({
      serverId: 'unified-mcpo',
      healthy: result.healthy,
      responseTime,
      error: result.healthy ? null : 'Unified MCPO health check failed',
    });
  }

  private async checkHealth(): Promise<{ healthy: boolean; statusCode: number | null }> {
    if (!this.mcpoPort) return { healthy: false, statusCode: null };

    const endpoints = [
      `http://localhost:${this.mcpoPort}/docs`,
      `http://localhost:${this.mcpoPort}/openapi.json`,
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
        if (response.ok) return { healthy: true, statusCode: response.status };
      } catch { /* try next */ }
    }

    return { healthy: false, statusCode: null };
  }

  private async markServersRunning(port: number): Promise<void> {
    const servers = await this.serverService.listServers();
    for (const server of servers) {
      try {
        this.db.update(mcpServers).set({
          runtimeStatus: 'running',
          runtimePort: port,
          runtimeMode: 'unified',
        }).where(eq(mcpServers.id, server.id)).run();
      } catch { /* non-critical */ }
    }
  }

  private async markServersStopped(): Promise<void> {
    const servers = await this.serverService.listServers();
    for (const server of servers) {
      try {
        this.db.update(mcpServers).set({
          runtimeStatus: 'stopped',
          runtimePort: null,
          runtimeMode: 'individual',
        }).where(eq(mcpServers.id, server.id)).run();
      } catch { /* non-critical */ }
    }
  }

  private async buildProcessEnv(): Promise<Record<string, string>> {
    return {
      ...(process.env as Record<string, string>),
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
    };
  }

  private persistLog(stream: string, message: string): void {
    try {
      const maskedMessage = secureLogger.maskSensitiveString(message);
      this.db.insert(serverRuntimeLogs).values({
        id: crypto.randomUUID(),
        serverId: 'unified-mcpo',
        stream,
        message: maskedMessage,
      }).run();
    } catch { /* non-critical */ }
  }
}
