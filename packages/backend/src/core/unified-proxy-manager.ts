import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import axios from 'axios';
import { type PortManager } from './port-manager.js';

interface ServerConfig {
  id: string;
  name: string;
  type?: string;
  transport?: string;
  [key: string]: unknown;
}

interface UnifiedStatus {
  mode: string;
  healthy: boolean;
  port: number | null;
  startTime: Date | null;
  uptime: number;
  restartCount: number;
  endpoint: string | null;
  servers: ServerConfig[];
  totalServers: number;
}

interface ServerRoute {
  id: string;
  name: string;
  route: string;
  docsUrl: string;
  baseUrl: string;
  type: string;
  configured: boolean;
}

interface OpenAPIEndpoint {
  name: string;
  url: string;
  openapi_url: string;
  docs_url: string;
  proxyType: string;
}

export class UnifiedProxyManager {
  protected configPath: string;
  protected portManager: PortManager;
  protected mcpoProcess: ChildProcess | null;
  protected mcpoPort: number | null;
  protected startTime: Date | null;
  protected restartCount: number;
  protected isHealthy: boolean;
  protected servers: Map<string, ServerConfig>;
  protected healthCheckTimer: ReturnType<typeof setInterval> | null;

  constructor(configPath: string, portManager: PortManager) {
    this.configPath = configPath;
    this.portManager = portManager;
    this.mcpoProcess = null;
    this.mcpoPort = null;
    this.startTime = null;
    this.restartCount = 0;
    this.isHealthy = false;
    this.servers = new Map();
    this.healthCheckTimer = null;
  }

  async start(): Promise<boolean> {
    try {
      if (this.mcpoProcess) {
        console.log('Unified MCPO already running');
        return true;
      }

      this.mcpoPort = this.portManager.allocatePort('unified-mcpo');
      if (!this.mcpoPort) {
        console.error('Failed to allocate port for unified MCPO');
        return false;
      }

      console.log(`Starting unified MCPO on port ${this.mcpoPort}`);
      console.log(`Config: ${this.configPath}`);

      this.mcpoProcess = spawn('uvx', [
        'mcpo',
        '--config', this.configPath,
        '--port', this.mcpoPort.toString(),
        '--host', '0.0.0.0',
        '--hot-reload',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });

      this.startTime = new Date();
      this.setupProcessHandlers();
      await this.waitForStartup();
      this.startHealthMonitoring();
      await this.loadServerConfigs();

      console.log('Unified MCPO started successfully');
      return true;
    } catch (error) {
      console.error('Failed to start unified MCPO:', (error as Error).message);
      await this.cleanup();
      return false;
    }
  }

  async stop(): Promise<boolean> {
    try {
      console.log('Stopping unified MCPO...');

      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }

      if (this.mcpoProcess && !this.mcpoProcess.killed) {
        this.mcpoProcess.kill('SIGTERM');
        await this.sleep(3000);
        if (!this.mcpoProcess.killed) {
          this.mcpoProcess.kill('SIGKILL');
        }
      }

      await this.cleanup();
      console.log('Unified MCPO stopped successfully');
      return true;
    } catch (error) {
      console.error('Error stopping unified MCPO:', (error as Error).message);
      return false;
    }
  }

  async restart(): Promise<boolean> {
    console.log('Restarting unified MCPO...');
    this.restartCount++;
    await this.stop();
    await this.sleep(2000);
    return await this.start();
  }

  async checkHealth(): Promise<boolean> {
    if (!this.mcpoProcess || !this.mcpoPort) return false;

    try {
      const response = await axios.get(`http://localhost:${this.mcpoPort}/docs`, {
        timeout: 5000,
        validateStatus: (status: number) => status === 200,
      });

      this.isHealthy = response.status === 200;
      return this.isHealthy;
    } catch {
      try {
        await axios.get(`http://localhost:${this.mcpoPort}/openapi.json`, {
          timeout: 2000,
          validateStatus: (status: number) => status === 200,
        });
        this.isHealthy = true;
        return true;
      } catch {
        this.isHealthy = false;
        return false;
      }
    }
  }

  getStatus(): UnifiedStatus {
    return {
      mode: 'unified',
      healthy: this.isHealthy,
      port: this.mcpoPort,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      restartCount: this.restartCount,
      endpoint: this.mcpoPort ? `http://localhost:${this.mcpoPort}` : null,
      servers: Array.from(this.servers.values()),
      totalServers: this.servers.size,
    };
  }

  getServerRoutes(): ServerRoute[] {
    return Array.from(this.servers.values()).map(server => ({
      id: server.id,
      name: server.name,
      route: `/${server.id}`,
      docsUrl: `http://localhost:${this.mcpoPort}/${server.id}/docs`,
      baseUrl: `http://localhost:${this.mcpoPort}/${server.id}`,
      type: (server.type || server.transport || 'stdio') as string,
      configured: true,
    }));
  }

  getOpenAPIEndpoints(): OpenAPIEndpoint[] {
    if (!this.mcpoPort || !this.isHealthy) return [];

    return Array.from(this.servers.values()).map(server => ({
      name: server.id,
      url: `http://localhost:${this.mcpoPort}/${server.id}`,
      openapi_url: `http://localhost:${this.mcpoPort}/${server.id}/openapi.json`,
      docs_url: `http://localhost:${this.mcpoPort}/${server.id}/docs`,
      proxyType: 'unified-mcpo',
    }));
  }

  protected setupProcessHandlers(): void {
    if (!this.mcpoProcess) return;

    this.mcpoProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[unified-mcpo:stdout] ${data.toString().trim()}`);
    });

    this.mcpoProcess.stderr?.on('data', (data: Buffer) => {
      console.log(`[unified-mcpo:stderr] ${data.toString().trim()}`);
    });

    this.mcpoProcess.on('exit', (code, signal) => {
      console.log(`[unified-mcpo] Process exited with code ${code}, signal ${signal}`);
      this.isHealthy = false;

      if (code !== 0 && !signal) {
        console.log('Unified MCPO crashed, attempting restart...');
        setTimeout(() => this.restart(), 5000);
      }
    });

    this.mcpoProcess.on('error', (error) => {
      console.error('Unified MCPO process error:', error.message);
      this.isHealthy = false;
    });
  }

  protected async waitForStartup(): Promise<void> {
    const maxWait = 30000;
    const checkInterval = 1000;
    let waited = 0;

    console.log('Waiting for unified MCPO to start...');

    while (waited < maxWait) {
      if (await this.checkHealth()) {
        console.log(`Unified MCPO ready after ${waited}ms`);
        return;
      }

      await this.sleep(checkInterval);
      waited += checkInterval;
    }

    throw new Error(`Unified MCPO failed to start within ${maxWait}ms`);
  }

  protected startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.checkHealth();
    }, 30000);
  }

  protected async loadServerConfigs(): Promise<void> {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn(`Config file not found: ${this.configPath}`);
        return;
      }

      const configContent = await fs.promises.readFile(this.configPath, 'utf8');
      const config = JSON.parse(configContent);

      if (!config.mcpServers) {
        console.warn('No mcpServers found in config');
        return;
      }

      this.servers.clear();

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        this.servers.set(name, {
          id: name,
          name,
          ...(serverConfig as Record<string, unknown>),
        });
      }

      console.log(`Loaded ${this.servers.size} server configs for unified mode`);
    } catch (error) {
      console.error('Error loading server configs:', (error as Error).message);
    }
  }

  protected async cleanup(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.mcpoProcess = null;
    this.isHealthy = false;

    if (this.mcpoPort) {
      this.portManager.deallocatePort('unified-mcpo');
      this.mcpoPort = null;
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
