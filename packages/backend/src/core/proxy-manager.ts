import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { InstallationManager } from './installation-manager.js';
import { type PortManager } from './port-manager.js';
import { type ParsedMCPServer } from './config-parser.js';

interface ProxyInfo {
  process: ChildProcess;
  port: number;
  config: ParsedMCPServer;
  startTime: Date;
  restartCount: number;
  healthy: boolean;
  proxyTypeUsed: string;
  fallbackUsed: boolean;
  authError?: boolean;
}

interface FallbackInfo {
  attempts: Set<string>;
  lastAttempt: number;
  totalAttempts: number;
}

interface ServerError {
  lastError: string;
  errorType: string;
  timestamp: Date;
}

interface HealthCheckResult {
  isHealthy: boolean;
  isAuthError: boolean;
  statusCode: number | null;
}

interface ProxyStatus {
  serverId: string;
  port: number;
  healthy: boolean;
  startTime: Date;
  restartCount: number;
  uptime: number;
  endpoint: string;
  proxyType: string;
  fallbackUsed: boolean;
  authError: boolean;
}

interface StartProxyOptions {
  forceProxyType?: string;
  allowFallback?: boolean;
}

const ALLOWED_COMMANDS = new Set([
  'uvx', 'python', 'python3', 'node', 'npm', 'npx', 'uv', 'pip', 'pip3',
]);

const INFORMATIONAL_PATTERNS = [
  /^INFO:/,
  /Starting .+ on/i,
  /Uvicorn running on/i,
  /Application startup complete/i,
  /Listening on port/i,
  /Building .+ packages/i,
  /Downloading .+\(/i,
  /Installed \d+ packages/i,
  /npm warn/i,
];

const ERROR_PATTERNS = [
  /ERROR:\s*(.+)/i,
  /Error:\s*(.+)/i,
  /Exception:\s*(.+)/i,
  /RuntimeError:\s*(.+)/i,
  /McpError:\s*(.+)/i,
  /ConnectionError:\s*(.+)/i,
  /\?\s*(.+(?:API key|token|password|username).+)/i,
  /Please enter your\s+(.+)/i,
  /Missing required\s+(.+)/i,
  /Configuration required:\s*(.+)/i,
  /Child exited:\s*(.+)/i,
  /Process .+ with code\s*(\d+)/i,
  /Connection (.+)/i,
  /Failed to connect:\s*(.+)/i,
  /Unable to connect:\s*(.+)/i,
  /Failed to (.+)/i,
  /Cannot (.+)/i,
  /Unable to (.+)/i,
];

const CRITICAL_KEYWORDS = [
  'killed', 'crashed', 'terminated', 'aborted', 'failed', 'error',
  'exception', 'refused', 'timeout', 'unauthorized', 'forbidden',
];

export class ProxyManager {
  private readonly portManager: PortManager;
  private readonly defaultProxyType: string;
  private readonly runningProxies: Map<string, ProxyInfo>;
  private readonly healthCheckInterval: number;
  private readonly fallbackAttempts: Map<string, FallbackInfo>;
  private readonly maxRetryAttempts: number;
  private readonly portReuseDelay: number;
  private readonly serverErrors: Map<string, ServerError>;
  readonly installationManager: InstallationManager;
  private readonly mcpBridgeConfigDir: string;
  private healthCheckTimer: ReturnType<typeof setInterval> | null;

  constructor(portManager: PortManager, defaultProxyType = 'mcpo') {
    this.portManager = portManager;
    this.defaultProxyType = defaultProxyType;
    this.runningProxies = new Map();
    this.healthCheckInterval = 30000;
    this.fallbackAttempts = new Map();
    this.maxRetryAttempts = 3;
    this.portReuseDelay = 10000;
    this.serverErrors = new Map();
    this.installationManager = new InstallationManager();
    this.mcpBridgeConfigDir = '/app/tmp/mcp-bridge-configs';
    this.healthCheckTimer = null;
  }

  recordError(serverId: string, error: string, errorType = 'unknown'): void {
    console.log(`Recording error for ${serverId}: [${errorType}] ${error}`);
    this.serverErrors.set(serverId, { lastError: error, errorType, timestamp: new Date() });
  }

  getServerError(serverId: string): ServerError | null {
    return this.serverErrors.get(serverId) || null;
  }

  clearServerError(serverId: string): void {
    if (this.serverErrors.has(serverId)) {
      console.log(`Clearing error for ${serverId} - server is now healthy`);
      this.serverErrors.delete(serverId);
    }
  }

  validateCommand(command: string): string | null {
    if (typeof command !== 'string') {
      console.error('Command validation failed: not a string');
      return null;
    }

    const baseCommand = path.basename(command);
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      console.error(`Command validation failed: '${baseCommand}' not in allowlist`);
      return null;
    }

    if (command.includes('..') || command.includes(';') || command.includes('&') || command.includes('|')) {
      console.error('Command validation failed: contains dangerous characters');
      return null;
    }

    return command;
  }

  validateArgs(args: string[]): string[] {
    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }

    const dangerousPatterns = [/[;&|`$(){}[\]\\]/, /\x00/, /\.\.\//];

    const sanitizedArgs = args.map((arg, index) => {
      if (typeof arg !== 'string') {
        throw new Error(`Argument at index ${index} must be a string`);
      }

      if (dangerousPatterns.some(pattern => pattern.test(arg))) {
        throw new Error(`Argument '${arg}' contains potentially dangerous characters`);
      }

      if (arg.length > 1000) {
        throw new Error(`Argument too long: ${arg.length} characters`);
      }

      return arg;
    });

    if (sanitizedArgs.length > 50) {
      throw new Error(`Too many arguments: ${sanitizedArgs.length}`);
    }

    return sanitizedArgs;
  }

  detectAndRecordErrors(serverId: string, output: string): void {
    if (this.isInformationalMessage(output)) return;
    const errorMessage = this.extractErrorMessage(output);
    if (!errorMessage) return;
    const errorType = this.categorizeError(errorMessage, output);
    this.recordError(serverId, errorMessage, errorType);
  }

  isInformationalMessage(output: string): boolean {
    return INFORMATIONAL_PATTERNS.some(pattern => pattern.test(output));
  }

  extractErrorMessage(output: string): string | null {
    const cleanOutput = output
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^Child stderr:\s*/i, '')
      .replace(/^Child non-JSON:\s*/i, '')
      .trim();

    for (const pattern of ERROR_PATTERNS) {
      const match = cleanOutput.match(pattern);
      if (match?.[1]) return match[1].trim();
    }

    for (const pattern of ERROR_PATTERNS) {
      const match = output.match(pattern);
      if (match?.[1]) return match[1].trim();
    }

    const lowerOutput = output.toLowerCase();
    if (CRITICAL_KEYWORDS.some(keyword => lowerOutput.includes(keyword))) {
      const lines = output.split('\n');
      for (const line of lines) {
        if (CRITICAL_KEYWORDS.some(keyword => line.toLowerCase().includes(keyword))) {
          return line.trim();
        }
      }
    }

    return null;
  }

  categorizeError(errorMessage: string, fullOutput: string): string {
    const lowerMessage = errorMessage.toLowerCase();

    if (/api[_\s]*key|token|password|username|auth|login|credential|unauthorized|forbidden|401|403/.test(lowerMessage)) {
      return 'auth';
    }
    if (/connection|connect|network|timeout|refused|closed|host|port|socket|mcperror|runtimeerror.*yield/.test(lowerMessage)) {
      return 'connection';
    }
    if (/memory|killed|resource|space|limit|137|sigkill|oom/.test(lowerMessage) || fullOutput.toLowerCase().includes('code=137')) {
      return 'resource';
    }
    if (/package|dependency|install|build|compile|module|import/.test(lowerMessage)) {
      return 'dependency';
    }
    if (/config|setting|parameter|missing|required|invalid/.test(lowerMessage)) {
      return 'config';
    }
    return 'runtime';
  }

  generateMCPBridgeConfig(serverConfig: ParsedMCPServer, port: number, env: Record<string, string>) {
    return {
      inference_server: { base_url: 'http://localhost:11434/v1', api_key: 'dummy' },
      mcp_servers: {
        [serverConfig.id]: {
          command: serverConfig.command,
          args: serverConfig.args || [],
          env,
        },
      },
      network: { host: '0.0.0.0', port },
      logging: { log_level: 'INFO' },
    };
  }

  async createMCPBridgeConfig(serverConfig: ParsedMCPServer, port: number, env: Record<string, string>): Promise<string> {
    const workingDir = path.join(this.mcpBridgeConfigDir, serverConfig.id);
    const configPath = path.join(workingDir, 'config.json');

    try {
      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
      }

      const config = this.generateMCPBridgeConfig(serverConfig, port, env);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log(`Created MCP-Bridge config for ${serverConfig.id} at ${configPath}`);
      return workingDir;
    } catch (error) {
      console.error(`Failed to create MCP-Bridge config for ${serverConfig.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  cleanupMCPBridgeConfig(serverId: string): void {
    const workingDir = path.join(this.mcpBridgeConfigDir, serverId);
    try {
      if (fs.existsSync(workingDir)) {
        fs.rmSync(workingDir, { recursive: true, force: true });
        console.log(`Cleaned up MCP-Bridge config for ${serverId}`);
      }
    } catch (error) {
      console.warn(`Failed to cleanup MCP-Bridge config for ${serverId}: ${(error as Error).message}`);
    }
  }

  async spawnSSEProxy(serverConfig: ParsedMCPServer, port: number): Promise<ChildProcess> {
    console.log(`Starting SSE-to-OpenAPI proxy for ${serverConfig.id} on port ${port}`);

    const args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString(), '--server-type', 'sse'];

    if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
      args.push('--header', JSON.stringify(serverConfig.headers));
    }

    args.push('--', serverConfig.url!);

    const env = {
      ...process.env,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
      MCP_SSE_READ_TIMEOUT: '300',
      MCP_SSE_CONNECT_TIMEOUT: '30',
      HTTPX_TIMEOUT: '300',
      UVICORN_TIMEOUT_KEEP_ALIVE: '600',
    };

    console.log(`Spawning: uvx ${args.join(' ')}`);

    return spawn('uvx', args, {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  async spawnStreamableHttpProxy(serverConfig: ParsedMCPServer, port: number): Promise<ChildProcess> {
    console.log(`Starting Streamable-HTTP-to-OpenAPI proxy for ${serverConfig.id} on port ${port}`);

    const args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString(), '--server-type', 'streamable-http'];

    if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
      args.push('--header', JSON.stringify(serverConfig.headers));
    }

    args.push('--', serverConfig.url!);

    const env = {
      ...process.env,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
      MCP_HTTP_READ_TIMEOUT: '300',
      MCP_HTTP_CONNECT_TIMEOUT: '30',
      HTTPX_TIMEOUT: '300',
      UVICORN_TIMEOUT_KEEP_ALIVE: '600',
    };

    console.log(`Spawning: uvx ${args.join(' ')}`);

    return spawn('uvx', args, {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  async startProxy(serverConfig: ParsedMCPServer, options: StartProxyOptions = {}): Promise<boolean> {
    try {
      if (serverConfig.transport === 'sse' && serverConfig.url) {
        console.log(`Auto-detected SSE server ${serverConfig.id}, will proxy for OpenWebUI compatibility`);
      } else if (serverConfig.transport === 'streamable-http' && serverConfig.url) {
        console.log(`Auto-detected Streamable-HTTP server ${serverConfig.id}, will proxy for OpenWebUI compatibility`);
      } else if (!serverConfig.needsProxy) {
        console.log(`Server ${serverConfig.id} doesn't need proxy, skipping`);
        return true;
      }

      if (this.runningProxies.has(serverConfig.id)) {
        console.log(`Proxy for ${serverConfig.id} already running`);
        return true;
      }

      const fallbackInfo: FallbackInfo = this.fallbackAttempts.get(serverConfig.id) || {
        attempts: new Set(),
        lastAttempt: 0,
        totalAttempts: 0,
      };

      if (fallbackInfo.totalAttempts >= this.maxRetryAttempts) {
        console.error(`Server ${serverConfig.id} has exceeded maximum retry attempts (${this.maxRetryAttempts}). Marking as failed.`);
        return false;
      }

      if (Date.now() - fallbackInfo.lastAttempt > 1800000) {
        fallbackInfo.attempts.clear();
        fallbackInfo.totalAttempts = 0;
        console.log(`Reset retry attempts for ${serverConfig.id} after timeout`);
      }

      let port = this.portManager.allocatePort(serverConfig.id);
      if (!port) {
        console.error(`Failed to allocate port for ${serverConfig.id}`);
        return false;
      }

      const forcedType = options.forceProxyType;
      const allowFallback = options.allowFallback !== false;
      const hasExplicit = Object.prototype.hasOwnProperty.call(serverConfig, 'proxyType');
      const explicitType = hasExplicit ? serverConfig.proxyType : undefined;
      const initialType = forcedType || explicitType || this.defaultProxyType;

      const tryOrder: string[] = [];
      if (!fallbackInfo.attempts.has(initialType)) {
        tryOrder.push(initialType);
      }

      if (!hasExplicit && allowFallback) {
        const alt = initialType === 'mcpo' ? 'mcp-bridge' : 'mcpo';
        if (!fallbackInfo.attempts.has(alt)) {
          tryOrder.push(alt);
        }
      }

      if (tryOrder.length === 0) {
        console.error(`No untried proxy types remaining for ${serverConfig.id}`);
        return false;
      }

      for (let i = 0; i < tryOrder.length; i++) {
        const proxyType = tryOrder[i];
        const isFallbackAttempt = i > 0 || fallbackInfo.totalAttempts > 0;

        fallbackInfo.attempts.add(proxyType);
        fallbackInfo.lastAttempt = Date.now();
        fallbackInfo.totalAttempts++;
        this.fallbackAttempts.set(serverConfig.id, fallbackInfo);

        if (hasExplicit && i === 0 && fallbackInfo.totalAttempts === 1) {
          console.log(`Server ${serverConfig.id} has explicit proxyType=${explicitType}; fallback disabled`);
        }
        console.log(`Starting ${proxyType} proxy for ${serverConfig.id} on port ${port} (attempt ${fallbackInfo.totalAttempts})`);

        const proxyProcess = await this.spawnProxy(serverConfig, port, proxyType);
        if (!proxyProcess) continue;

        this.runningProxies.set(serverConfig.id, {
          process: proxyProcess,
          port,
          config: serverConfig,
          startTime: new Date(),
          restartCount: 0,
          healthy: false,
          proxyTypeUsed: proxyType,
          fallbackUsed: isFallbackAttempt,
        });

        const isPersistentTransport = serverConfig.transport === 'sse' || serverConfig.transport === 'streamable-http';
        const initDelay = isPersistentTransport ? 15000 : 8000;
        const transportType = serverConfig.transport === 'sse' ? 'SSE' : serverConfig.transport === 'streamable-http' ? 'Streamable-HTTP' : 'stdio';
        console.log(`Waiting ${initDelay}ms for ${transportType} server initialization...`);
        await this.sleep(initDelay);

        const healthResult = await this.healthCheck(serverConfig.id);
        if (healthResult.isHealthy) {
          const proxy = this.runningProxies.get(serverConfig.id);
          if (proxy) proxy.healthy = true;
          this.clearServerError(serverConfig.id);
          console.log(`Proxy for ${serverConfig.id} is healthy`);
          return true;
        }

        if (healthResult.isAuthError) {
          console.warn(`Server ${serverConfig.id} has authentication errors (HTTP ${healthResult.statusCode}). Marking as running but unhealthy.`);
          this.recordError(serverConfig.id, 'Authentication required for external service', 'auth');
          const proxy = this.runningProxies.get(serverConfig.id);
          if (proxy) {
            proxy.healthy = false;
            proxy.authError = true;
          }
          return true;
        }

        console.warn(`Proxy for ${serverConfig.id} failed health check using ${proxyType}`);
        this.recordError(serverConfig.id, `Health check failed for ${proxyType} proxy`, 'health');

        if (hasExplicit || i === tryOrder.length - 1) {
          console.log(`No more fallback options for ${serverConfig.id}, keeping current proxy running`);
          return true;
        }

        console.log(`Falling back to alternate proxy for ${serverConfig.id}`);
        await this.stopProxy(serverConfig.id);

        console.log(`Waiting ${this.portReuseDelay}ms for port cleanup before fallback...`);
        await this.sleep(this.portReuseDelay);

        port = this.portManager.allocatePort(serverConfig.id);
        if (!port) {
          console.error(`Failed to allocate port for fallback for ${serverConfig.id}`);
          return false;
        }
      }

      console.error(`All proxy attempts failed for ${serverConfig.id} after ${fallbackInfo.totalAttempts} attempts`);
      this.portManager.deallocatePort(serverConfig.id);
      return false;
    } catch (error) {
      console.error(`Error starting proxy for ${serverConfig.id}: ${(error as Error).message}`);
      return false;
    }
  }

  async spawnProxy(serverConfig: ParsedMCPServer, port: number, proxyType = 'mcpo'): Promise<ChildProcess | null> {
    if (serverConfig.transport === 'sse' && serverConfig.url) {
      return this.spawnSSEProxy(serverConfig, port);
    }
    if (serverConfig.transport === 'streamable-http' && serverConfig.url) {
      return this.spawnStreamableHttpProxy(serverConfig, port);
    }

    const packageName = this.extractPackageName(serverConfig);
    if (packageName) {
      console.log(`Validating cache for ${serverConfig.id} (${packageName})`);
      try {
        const isCorrupted = await this.installationManager.validateNpmCache(packageName);
        if (isCorrupted) {
          console.log(`Detected cache corruption for ${serverConfig.id}, cleaning...`);
          await this.installationManager.cleanNpmCache(packageName);
          this.recordError(serverConfig.id, `Cache corruption detected and cleaned for ${packageName}`, 'dependency');
        }
      } catch (error) {
        console.warn(`Cache validation warning for ${serverConfig.id}: ${(error as Error).message}`);
      }
    }

    const env: Record<string, string | undefined> = { ...process.env, ...serverConfig.env };

    if (serverConfig.envFile && fs.existsSync(serverConfig.envFile)) {
      const envFileContent = fs.readFileSync(serverConfig.envFile, 'utf8');
      envFileContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join('=').trim();
        }
      });
    }

    let command: string;
    let args: string[];
    let workingDir = serverConfig.cwd || process.cwd();

    if (proxyType === 'mcpo') {
      command = 'uvx';
      args = ['mcpo', '--host', '0.0.0.0', '--port', port.toString(), '--', serverConfig.command!, ...serverConfig.args!];
    } else if (proxyType === 'mcp-bridge') {
      try {
        workingDir = await this.createMCPBridgeConfig(serverConfig, port, env as Record<string, string>);
        command = 'uvx';
        args = ['mcp-bridge'];
        console.log(`MCP-Bridge will run from ${workingDir} for ${serverConfig.id}`);
      } catch (error) {
        console.error(`Failed to setup MCP-Bridge for ${serverConfig.id}: ${(error as Error).message}`);
        return null;
      }
    } else {
      console.error(`Unknown proxy type: ${proxyType}`);
      return null;
    }

    const validatedCommand = this.validateCommand(command);
    const validatedArgs = this.validateArgs(args);

    if (!validatedCommand) {
      throw new Error(`Invalid or unauthorized command: ${command}`);
    }

    console.log(`Spawning: ${validatedCommand} ${validatedArgs.join(' ')}`);

    const childProcess = spawn(validatedCommand, validatedArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workingDir,
    });

    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      console.log(`[${serverConfig.id}:stdout] ${output}`);
      this.detectAndRecordErrors(serverConfig.id, output);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      console.log(`[${serverConfig.id}:stderr] ${output}`);
      this.detectAndRecordErrors(serverConfig.id, output);
    });

    childProcess.on('error', (error) => {
      console.error(`[${serverConfig.id}:error] ${error.message}`);
      this.recordError(serverConfig.id, error.message, 'runtime');
    });

    childProcess.on('exit', (code, signal) => {
      console.log(`[${serverConfig.id}:exit] code=${code}, signal=${signal}`);

      if (signal !== 'SIGTERM' && signal !== 'SIGINT' && code !== 0 && code !== null) {
        let exitMessage = `Process exited with code ${code}`;
        let errorType = 'runtime';

        if (code === 137) { exitMessage = 'Process killed by system (likely memory exhaustion)'; errorType = 'resource'; }
        else if (code === 127) { exitMessage = 'Command not found or executable not available'; errorType = 'dependency'; }
        else if (code === 126) { exitMessage = 'Command found but not executable'; errorType = 'config'; }

        const existingError = this.getServerError(serverConfig.id);
        if (!existingError || existingError.errorType === 'health' || existingError.lastError.includes('Health check failed')) {
          this.recordError(serverConfig.id, exitMessage, errorType);
        }
      }

      this.handleProcessExit(serverConfig.id, code);
    });

    return childProcess;
  }

  async stopProxy(serverId: string): Promise<boolean> {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) {
      console.log(`No running proxy found for ${serverId}`);
      return true;
    }

    console.log(`Stopping proxy for ${serverId}`);

    try {
      proxyInfo.process.kill('SIGTERM');
      await this.sleep(3000);

      if (!proxyInfo.process.killed) {
        proxyInfo.process.kill('SIGKILL');
      }

      this.runningProxies.delete(serverId);
      this.portManager.deallocatePort(serverId);

      if (proxyInfo.proxyTypeUsed === 'mcp-bridge') {
        this.cleanupMCPBridgeConfig(serverId);
      }

      console.log(`Proxy for ${serverId} stopped successfully`);
      return true;
    } catch (error) {
      console.error(`Error stopping proxy for ${serverId}: ${(error as Error).message}`);
      return false;
    }
  }

  resetFallbackAttempts(serverId: string): void {
    if (this.fallbackAttempts.has(serverId)) {
      this.fallbackAttempts.delete(serverId);
      console.log(`Reset fallback attempts for ${serverId}`);
    }
  }

  getFallbackStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [serverId, info] of this.fallbackAttempts) {
      stats[serverId] = {
        totalAttempts: info.totalAttempts,
        attemptedTypes: Array.from(info.attempts),
        lastAttempt: new Date(info.lastAttempt).toISOString(),
        maxAttemptsReached: info.totalAttempts >= this.maxRetryAttempts,
      };
    }
    return stats;
  }

  async restartProxy(serverId: string): Promise<boolean> {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) {
      console.log(`No running proxy found for ${serverId}`);
      return false;
    }

    const config = proxyInfo.config;
    await this.stopProxy(serverId);
    await this.sleep(1000);

    const success = await this.startProxy(config);
    if (success && this.runningProxies.has(serverId)) {
      this.runningProxies.get(serverId)!.restartCount++;
    }

    return success;
  }

  async handleProcessExit(serverId: string, code: number | null): Promise<void> {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return;

    console.log(`Process for ${serverId} exited with code ${code}`);

    this.runningProxies.delete(serverId);
    this.portManager.deallocatePort(serverId);

    if (proxyInfo.proxyTypeUsed === 'mcp-bridge') {
      this.cleanupMCPBridgeConfig(serverId);
    }

    const fallbackInfo = this.fallbackAttempts.get(serverId);
    const totalAttempts = fallbackInfo ? fallbackInfo.totalAttempts : 0;

    if (code !== 0 && proxyInfo.restartCount < 3 && totalAttempts < this.maxRetryAttempts) {
      console.log(`Auto-restarting ${serverId} (restart ${proxyInfo.restartCount + 1}, total attempts ${totalAttempts})`);
      await this.sleep(5000);
      await this.startProxy(proxyInfo.config);
    } else if (totalAttempts >= this.maxRetryAttempts) {
      console.error(`Server ${serverId} has exceeded maximum retry attempts, not auto-restarting`);
    }
  }

  async healthCheck(serverId: string): Promise<HealthCheckResult> {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return { isHealthy: false, isAuthError: false, statusCode: null };

    try {
      const endpoints = [
        { url: `http://localhost:${proxyInfo.port}/openapi.json`, name: 'openapi' },
        { url: `http://localhost:${proxyInfo.port}/docs`, name: 'docs' },
        { url: `http://localhost:${proxyInfo.port}/`, name: 'root' },
      ];

      let lastStatusCode: number | null = null;
      let hasAuthError = false;

      for (const endpoint of endpoints) {
        try {
          const isSSEServer = proxyInfo.config?.transport === 'sse';
          const healthTimeout = isSSEServer ? 10000 : 5000;

          const response = await axios.get(endpoint.url, {
            timeout: healthTimeout,
            validateStatus: (status: number) => status === 200,
          });

          if (response.status === 200) {
            return { isHealthy: true, isAuthError: false, statusCode: 200 };
          }
        } catch (endpointError: unknown) {
          const axiosErr = endpointError as { response?: { status?: number } };
          lastStatusCode = axiosErr.response?.status ?? lastStatusCode;
          if (axiosErr.response?.status === 401) {
            hasAuthError = true;
          }
        }
      }

      return { isHealthy: false, isAuthError: hasAuthError, statusCode: lastStatusCode };
    } catch (error) {
      console.warn(`Health check failed for ${serverId}: ${(error as Error).message}`);
      return { isHealthy: false, isAuthError: false, statusCode: null };
    }
  }

  getProxyStatuses(): ProxyStatus[] {
    const statuses: ProxyStatus[] = [];

    for (const [serverId, proxyInfo] of this.runningProxies) {
      statuses.push({
        serverId,
        port: proxyInfo.port,
        healthy: proxyInfo.healthy,
        startTime: proxyInfo.startTime,
        restartCount: proxyInfo.restartCount,
        uptime: Date.now() - proxyInfo.startTime.getTime(),
        endpoint: `http://localhost:${proxyInfo.port}`,
        proxyType: proxyInfo.proxyTypeUsed || proxyInfo.config?.proxyType || this.defaultProxyType,
        fallbackUsed: !!proxyInfo.fallbackUsed,
        authError: !!proxyInfo.authError,
      });
    }

    return statuses;
  }

  startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      for (const [serverId, proxyInfo] of this.runningProxies) {
        const healthResult = await this.healthCheck(serverId);
        proxyInfo.healthy = healthResult.isHealthy;

        if (healthResult.isHealthy) {
          this.clearServerError(serverId);
        }

        if (!healthResult.isHealthy && !healthResult.isAuthError && proxyInfo.restartCount < 3) {
          console.log(`Health check failed for ${serverId}, restarting...`);
          await this.restartProxy(serverId);
        } else if (healthResult.isAuthError) {
          console.log(`Server ${serverId} has authentication errors - skipping restart`);
          proxyInfo.authError = true;
        }
      }
    }, this.healthCheckInterval);

    console.log(`Started health monitoring (interval: ${this.healthCheckInterval}ms)`);
  }

  async stopAllProxies(): Promise<boolean> {
    console.log('Stopping all proxies...');
    const serverIds = Array.from(this.runningProxies.keys());
    const stopPromises = serverIds.map(serverId => this.stopProxy(serverId));
    const results = await Promise.all(stopPromises);
    return results.every(result => result === true);
  }

  extractPackageName(serverConfig: ParsedMCPServer): string | null {
    if (!serverConfig.args || serverConfig.args.length === 0) return null;

    const patterns = [
      { command: 'npx', pattern: /^-y$|^--yes$/, nextArg: true, currentArg: false },
      { command: 'uvx', pattern: /^[^-]/, nextArg: false, currentArg: true },
      { command: 'npx', pattern: /^@[\w-]+\/[\w-]+|^[\w-]+/, nextArg: false, currentArg: true },
    ];

    for (const { command, pattern, nextArg, currentArg } of patterns) {
      if (serverConfig.command === command) {
        for (let i = 0; i < serverConfig.args.length; i++) {
          const arg = serverConfig.args[i];

          if (nextArg && pattern.test(arg) && i + 1 < serverConfig.args.length) {
            const packageArg = serverConfig.args[i + 1];
            if (!packageArg.startsWith('-')) {
              return packageArg.split('@')[0];
            }
          }

          if (currentArg && pattern.test(arg) && !arg.startsWith('-')) {
            return arg.split('@')[0];
          }
        }
      }
    }

    return null;
  }

  getInstallationStats() {
    return this.installationManager.getStats();
  }

  async cleanServerCache(serverId: string): Promise<boolean> {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return false;

    const packageName = this.extractPackageName(proxyInfo.config);
    return await this.installationManager.cleanNpmCache(packageName);
  }

  cleanup(): void {
    console.log('Cleaning up proxy manager resources...');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('Health check timer cleared');
    }

    for (const [serverId, proxyInfo] of this.runningProxies) {
      if (proxyInfo.process && !proxyInfo.process.killed) {
        console.log(`Stopping proxy: ${serverId}`);
        proxyInfo.process.kill('SIGTERM');
      }
    }

    this.runningProxies.clear();
    console.log('Proxy manager cleanup complete');
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
