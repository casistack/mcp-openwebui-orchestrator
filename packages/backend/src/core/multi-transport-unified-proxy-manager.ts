import { spawn, type ChildProcess } from 'child_process';
import axios from 'axios';
import WebSocket from 'ws';
import { UnifiedProxyManager } from './unified-proxy-manager.js';
import { logger } from './logger.js';
import { type PortManager } from './port-manager.js';

interface TransportConfig {
  enabled: boolean;
  name: string;
  port?: number | null;
}

interface SuperGatewayProcessInfo {
  process: ChildProcess;
  port: number;
  serverId: string;
  transport: string;
  command: string;
  startTime: Date;
  restartCount: number;
}

interface ServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: string;
  url?: string;
  [key: string]: unknown;
}

export class MultiTransportUnifiedProxyManager extends UnifiedProxyManager {
  private readonly supergatewayProcesses: Map<string, SuperGatewayProcessInfo>;
  private readonly transportHealth: Map<string, boolean>;
  private readonly transportConfig: Record<string, TransportConfig>;
  private transportHealthInterval: ReturnType<typeof setInterval> | null;

  constructor(configPath: string, portManager: PortManager) {
    super(configPath, portManager);

    this.supergatewayProcesses = new Map();
    this.transportHealth = new Map();
    this.transportHealthInterval = null;

    this.transportConfig = {
      streamable: { enabled: process.env.TRANSPORT_STREAMABLE !== 'false', name: 'StreamableHTTP' },
      websocket: { enabled: process.env.TRANSPORT_WEBSOCKET !== 'false', name: 'WebSocket' },
      sse: { enabled: process.env.TRANSPORT_SSE !== 'false', name: 'SSE' },
      openapi: { enabled: true, name: 'OpenAPI' },
    };

    this.calculateResourceRequirements();

    console.log('Multi-Transport Configuration:', {
      streamable: this.transportConfig.streamable.enabled,
      websocket: this.transportConfig.websocket.enabled,
      sse: this.transportConfig.sse.enabled,
      openapi: this.transportConfig.openapi.enabled,
    });
  }

  private calculateResourceRequirements(): void {
    setTimeout(() => {
      const serverCount = this.servers ? this.servers.size : 12;
      const enabledTransports = this.getEnabledTransports();
      const supergatewayTransports = enabledTransports.filter(t => t !== 'openapi');

      const totalProcesses = 1 + (serverCount * supergatewayTransports.length);
      const estimatedMemory = totalProcesses * 80;

      console.log(`\nMULTI-TRANSPORT RESOURCE REQUIREMENTS:`);
      console.log(`   Servers: ${serverCount}`);
      console.log(`   Enabled Transports: ${enabledTransports.join(', ')}`);
      console.log(`   Total Processes: ${totalProcesses}`);
      console.log(`   Estimated Memory: ~${estimatedMemory}MB\n`);

      if (totalProcesses > 40) {
        console.warn(`HIGH RESOURCE USAGE: ${totalProcesses} processes may impact system performance`);
      }
    }, 1000);
  }

  async start(): Promise<boolean> {
    try {
      console.log('Starting unified MCPO for OpenAPI transport...');
      const mcpoStarted = await super.start();
      if (!mcpoStarted) {
        console.error('Failed to start base unified MCPO');
        return false;
      }

      this.transportConfig.openapi.port = this.mcpoPort;
      this.transportHealth.set('openapi', true);
      console.log(`MCPO started successfully on port ${this.mcpoPort}`);

      await this.waitForServerConfigs();
      await this.startAllSuperGatewayTransports();
      this.startHealthMonitoring();

      const enabledTransports = this.getEnabledTransports();
      const totalProcesses = 1 + this.supergatewayProcesses.size;

      console.log(`\nMulti-transport unified proxy started successfully!`);
      console.log(`   Transports: ${enabledTransports.join(', ')}`);
      console.log(`   Total Processes: ${totalProcesses}`);
      console.log(`   Servers: ${this.servers.size}`);
      console.log(`   Ports Used: ${this.getAllocatedPorts().length}\n`);

      return true;
    } catch (error) {
      console.error('Failed to start multi-transport unified proxy:', error);
      await this.stop();
      return false;
    }
  }

  private async waitForServerConfigs(): Promise<void> {
    const maxWait = 10000;
    const interval = 500;
    let waited = 0;

    while (!this.servers || this.servers.size === 0) {
      if (waited >= maxWait) {
        throw new Error('Timeout waiting for server configs to load');
      }
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
    }

    console.log(`Loaded ${this.servers.size} server configurations`);
  }

  private async startAllSuperGatewayTransports(): Promise<void> {
    const enabledTransports = this.getEnabledTransports().filter(t => t !== 'openapi');

    if (enabledTransports.length === 0) {
      console.log('No additional transports enabled - running OpenAPI only');
      return;
    }

    console.log(`Starting SuperGateway processes for ${enabledTransports.length} transport(s)...`);

    const startupPromises: Promise<void>[] = [];

    for (const [serverId, serverConfig] of this.servers) {
      if ((serverConfig as ServerConfig).transport === 'sse' && (serverConfig as ServerConfig).url) {
        console.log(`Skipping ${serverId} - already uses SSE transport via URL`);
        continue;
      }

      const cfg = serverConfig as ServerConfig;
      if (!cfg.command || !Array.isArray(cfg.args)) {
        console.log(`Skipping ${serverId} - invalid or missing command/args configuration`);
        continue;
      }

      for (const transport of enabledTransports) {
        startupPromises.push(this.startSuperGatewayForServer(serverId, cfg, transport));
      }
    }

    console.log(`Starting ${startupPromises.length} SuperGateway processes concurrently...`);
    const results = await Promise.allSettled(startupPromises);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`SuperGateway startup results: ${successful} successful, ${failed} failed`);

    if (failed > 0) {
      console.warn(`${failed} SuperGateway processes failed to start`);
    }
  }

  private async startSuperGatewayForServer(serverId: string, serverConfig: ServerConfig, transport: string): Promise<void> {
    try {
      const processKey = `${serverId}-${transport}`;

      const port = this.portManager.allocatePort(processKey);
      if (!port) {
        throw new Error(`Failed to allocate port for ${serverId} ${transport} transport`);
      }

      logger.info(`Starting ${transport} SuperGateway for server '${serverId}' on port ${port}`);

      const mcpCommand = this.buildMCPServerCommand(serverConfig);

      const args = [
        'supergateway',
        '--stdio', mcpCommand,
        '--port', port.toString(),
        '--host', '0.0.0.0',
        '--healthEndpoint', '/health',
        '--logLevel', process.env.SUPERGATEWAY_LOG_LEVEL || 'info',
      ];

      if (transport === 'websocket') {
        args.push('--outputTransport', 'ws');
      } else if (transport === 'streamable') {
        args.push('--outputTransport', 'streamableHttp');
      }

      console.log(`[${processKey}] Command: npx ${args.join(' ')}`);

      const sanitizedEnv = this.sanitizeEnvironment(serverConfig.env || {});
      const childProcess = spawn('npx', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...sanitizedEnv },
      });

      this.supergatewayProcesses.set(processKey, {
        process: childProcess,
        port,
        serverId,
        transport,
        command: mcpCommand,
        startTime: new Date(),
        restartCount: 0,
      });

      this.setupSuperGatewayHandlers(processKey, childProcess);

      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log(`${transport} transport starting for '${serverId}' on port ${port} (initializing...)`);
      this.transportHealth.set(processKey, false);

      setTimeout(async () => {
        try {
          const isHealthy = await this.checkTransportHealthForServer(serverId, transport, port);
          this.transportHealth.set(processKey, isHealthy);

          if (isHealthy) {
            console.log(`${transport} transport for '${serverId}' on port ${port} is now healthy`);
          } else {
            console.log(`${transport} transport for '${serverId}' on port ${port} still initializing`);
          }
        } catch (error) {
          console.error(`Initial health check failed for ${serverId} ${transport}:`, (error as Error).message);
        }
      }, 5000);
    } catch (error) {
      console.error(`Failed to start ${transport} transport for '${serverId}':`, error);
      this.transportHealth.set(`${serverId}-${transport}`, false);
      throw error;
    }
  }

  securityBaseline(args: string[]): string[] {
    const criticalPatterns = [/[;&|`$()]/,  /\.\./, /^\s*[|&;]/, /\n|\r/];

    return args.map(arg => {
      if (typeof arg === 'string') {
        for (const pattern of criticalPatterns) {
          if (pattern.test(arg)) {
            const sanitized = arg.replace(/[;&|`$()\\n\\r]/g, '');
            logger.warn(`Security: Sanitized potentially dangerous argument: "${arg}" -> "${sanitized}"`);
            return sanitized;
          }
        }
      }
      return arg;
    });
  }

  sanitizeEnvironment(userEnv: Record<string, string> = {}): Record<string, string> {
    const sanitizedEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(userEnv)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        logger.warn(`Security: Skipped invalid environment variable name: ${key}`);
        continue;
      }

      if (typeof value === 'string') {
        const sanitizedValue = value.replace(/[;&|`\n\r]/g, '');
        if (sanitizedValue !== value) {
          logger.warn(`Security: Sanitized environment variable ${key}`);
        }
        sanitizedEnv[key] = sanitizedValue;
      }
    }

    return sanitizedEnv;
  }

  private buildMCPServerCommand(serverConfig: ServerConfig): string {
    const secureArgs = this.securityBaseline(serverConfig.args || []);

    const args = secureArgs.map(arg => {
      if (typeof arg === 'string' && (arg.includes(' ') || arg.includes('"') || arg.includes("'"))) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });

    return `${serverConfig.command} ${args.join(' ')}`;
  }

  private setupSuperGatewayHandlers(processKey: string, childProcess: ChildProcess): void {
    const processInfo = this.supergatewayProcesses.get(processKey);

    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) logger.info(`[${processKey}] ${output}`);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString().trim();
      if (error && !error.includes('npm WARN')) {
        if (error.includes('SSE') || error.includes('connection') || error.includes('client disconnected')) {
          logger.info(`[${processKey}] Connection event: ${error}`);
        } else {
          logger.error(`[${processKey}] ${error}`);
        }
      }
    });

    childProcess.on('exit', (code, signal) => {
      logger.warn(`${processKey} process exited with code ${code}, signal ${signal}`);
      this.transportHealth.set(processKey, false);

      if (code !== 0 && !signal && processInfo && processInfo.restartCount < 3) {
        processInfo.restartCount++;
        logger.warn(`Attempting to restart ${processKey} (attempt ${processInfo.restartCount}/3)...`);

        setTimeout(async () => {
          try {
            const serverConfig = this.servers.get(processInfo.serverId);
            if (serverConfig) {
              await this.startSuperGatewayForServer(processInfo.serverId, serverConfig as ServerConfig, processInfo.transport);
            }
          } catch (error) {
            console.error(`Failed to restart ${processKey}:`, error);
          }
        }, 5000);
      } else if (processInfo && processInfo.restartCount >= 3) {
        console.error(`${processKey} exceeded maximum restart attempts (3), giving up`);
      }
    });

    childProcess.on('error', (error) => {
      console.error(`${processKey} process error:`, error);
      this.transportHealth.set(processKey, false);
    });
  }

  private async checkTransportHealthForServer(serverId: string, transport: string, port: number): Promise<boolean> {
    if (!port) return false;

    try {
      switch (transport) {
        case 'streamable': return await this.checkStreamableHealth(port);
        case 'websocket': return await this.checkWebSocketHealth(port);
        case 'sse': return await this.checkSSEHealth(port);
        case 'openapi': return await this.checkOpenAPIHealth(port);
        default: return false;
      }
    } catch (error) {
      console.error(`Health check failed for ${serverId} ${transport} on port ${port}:`, (error as Error).message);
      return false;
    }
  }

  private async checkStreamableHealth(port: number): Promise<boolean> {
    const endpoints = ['/message', '/', '/health'];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`http://localhost:${port}${endpoint}`, {
          timeout: 3000,
          headers: { 'Accept': 'application/json' },
          validateStatus: (status: number) => status < 500,
        });
        if (response.status < 500) return true;
      } catch {
        // Continue to next endpoint
      }
    }
    return false;
  }

  private async checkWebSocketHealth(port: number): Promise<boolean> {
    const wsEndpoints = ['/', '/ws'];

    for (const endpoint of wsEndpoints) {
      const wsUrl = `ws://localhost:${port}${endpoint}`;

      const result = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.terminate(); resolve(false); }, 3000);

        ws.on('open', () => { clearTimeout(timeout); ws.terminate(); resolve(true); });

        ws.on('error', (error: Error) => {
          if (error.message?.includes('400') || error.message?.includes('Unexpected server response')) {
            clearTimeout(timeout);
            resolve(true);
            return;
          }
          clearTimeout(timeout);
          resolve(false);
        });
      });

      if (result) return true;
    }
    return false;
  }

  private async checkSSEHealth(port: number): Promise<boolean> {
    const endpoints = ['/', '/events'];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`http://localhost:${port}${endpoint}`, {
          timeout: 3000,
          headers: { 'Accept': 'text/event-stream' },
          validateStatus: (status: number) => status < 500,
        });
        if (response.status < 500) return true;
      } catch (error: unknown) {
        const err = error as { message?: string };
        if (err.message?.includes('aborted')) return true;
      }
    }
    return false;
  }

  private async checkOpenAPIHealth(port: number): Promise<boolean> {
    try {
      const response = await axios.get(`http://localhost:${port}/docs`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  protected startHealthMonitoring(): void {
    super.startHealthMonitoring();

    this.transportHealthInterval = setInterval(async () => {
      const healthPromises: Promise<unknown>[] = [];

      for (const [processKey, processInfo] of this.supergatewayProcesses) {
        const healthPromise = this.checkTransportHealthForServer(
          processInfo.serverId,
          processInfo.transport,
          processInfo.port,
        ).then(isHealthy => {
          const wasHealthy = this.transportHealth.get(processKey);
          if (isHealthy !== wasHealthy) {
            console.log(`${processKey} health changed: ${wasHealthy} -> ${isHealthy}`);
            this.transportHealth.set(processKey, isHealthy);
          }
        }).catch(error => {
          console.error(`Health check error for ${processKey}:`, (error as Error).message);
          this.transportHealth.set(processKey, false);
        });

        healthPromises.push(healthPromise);
      }

      if (healthPromises.length > 0) {
        await Promise.allSettled(healthPromises);
      }
    }, 30000);
  }

  getEnabledTransports(): string[] {
    return Object.keys(this.transportConfig).filter(t => this.transportConfig[t].enabled);
  }

  getTransportStatus() {
    const status: Record<string, unknown> = {
      openapi: {
        enabled: true,
        healthy: this.transportHealth.get('openapi') || false,
        port: this.mcpoPort,
        url: `http://localhost:${this.mcpoPort}`,
        description: 'Universal REST API compatibility',
        servers: 'all',
      },
      servers: {} as Record<string, Record<string, unknown>>,
    };

    const servers = status.servers as Record<string, Record<string, unknown>>;

    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      const { serverId, transport, port } = processInfo;
      const isHealthy = this.transportHealth.get(processKey) || false;

      if (!servers[serverId]) {
        servers[serverId] = {};
      }

      servers[serverId][transport] = {
        enabled: true,
        healthy: isHealthy,
        port,
        url: this.getTransportUrl(transport, port),
        description: this.getTransportDescription(transport),
        processKey,
        startTime: processInfo.startTime,
        restartCount: processInfo.restartCount,
      };
    }

    return status;
  }

  getAllocatedPorts() {
    const ports: Array<{ port: number; serverId: string; transport: string; description: string; processKey?: string }> = [];

    if (this.mcpoPort) {
      ports.push({ port: this.mcpoPort, serverId: 'unified-mcpo', transport: 'openapi', description: 'Unified MCPO (all servers)' });
    }

    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      ports.push({
        port: processInfo.port,
        serverId: processInfo.serverId,
        transport: processInfo.transport,
        processKey,
        description: `${processInfo.serverId} via ${processInfo.transport}`,
      });
    }

    return ports;
  }

  getTransportUrl(transport: string, port: number): string | null {
    if (!port) return null;

    switch (transport) {
      case 'streamable': return `http://localhost:${port}/mcp`;
      case 'websocket': return `ws://localhost:${port}/ws`;
      case 'sse': return `http://localhost:${port}/sse`;
      case 'openapi': return `http://localhost:${port}`;
      default: return null;
    }
  }

  getTransportDescription(transport: string): string {
    switch (transport) {
      case 'streamable': return 'Modern MCP transport (Recommended)';
      case 'websocket': return 'Real-time bidirectional communication';
      case 'sse': return 'Legacy server-sent events';
      case 'openapi': return 'Universal REST API compatibility';
      default: return 'Unknown transport';
    }
  }

  async stop(): Promise<boolean> {
    console.log('Stopping multi-transport unified proxy...');

    const stopPromises: Promise<void>[] = [];

    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      if (processInfo.process && !processInfo.process.killed) {
        console.log(`Stopping ${processKey}...`);

        const stopPromise = new Promise<void>((resolve) => {
          const cleanup = () => {
            if (processInfo.port) {
              this.portManager.deallocatePort(processKey);
            }
            resolve();
          };

          processInfo.process.once('exit', cleanup);
          processInfo.process.kill('SIGTERM');

          setTimeout(() => {
            if (!processInfo.process.killed) {
              console.log(`Force killing ${processKey}...`);
              processInfo.process.kill('SIGKILL');
            }
            cleanup();
          }, 5000);
        });

        stopPromises.push(stopPromise);
      }
    }

    if (stopPromises.length > 0) {
      console.log(`Waiting for ${stopPromises.length} SuperGateway processes to stop...`);
      await Promise.allSettled(stopPromises);
    }

    if (this.transportHealthInterval) {
      clearInterval(this.transportHealthInterval);
      this.transportHealthInterval = null;
    }

    this.supergatewayProcesses.clear();
    this.transportHealth.clear();

    await super.stop();

    console.log('Multi-transport unified proxy stopped successfully');
    return true;
  }
}
