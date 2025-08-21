const { spawn } = require("child_process"); // Built-in Node.js module
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const InstallationManager = require("./installation-manager");

class ProxyManager {
  constructor(portManager, defaultProxyType = "mcpo") {
    this.portManager = portManager;
    this.defaultProxyType = defaultProxyType; // 'mcpo' or 'mcp-bridge'
    this.runningProxies = new Map(); // serverId -> proxy process info
    this.healthCheckInterval = 30000; // 30 seconds
    this.fallbackAttempts = new Map(); // serverId -> { attempts: Set<proxyType>, lastAttempt: timestamp, totalAttempts: number }
    this.maxRetryAttempts = 3; // Maximum total retry attempts per server
    this.portReuseDelay = 10000; // 10 seconds delay before port reuse
    this.serverErrors = new Map(); // serverId -> { lastError: string, errorType: string, timestamp: Date }
    this.installationManager = new InstallationManager(); // NPM cache corruption prevention
    this.mcpBridgeConfigDir = '/app/tmp/mcp-bridge-configs'; // Base directory for MCP-Bridge configs
    
    // Allowed commands for security (whitelist approach)
    this.allowedCommands = new Set([
      'uvx',
      'python',
      'python3',
      'node',
      'npm',
      'npx',
      'uv',
      'pip',
      'pip3'
    ]);
  }

  /**
   * Record error details for a server
   * @param {string} serverId - Server ID
   * @param {string} error - Error message
   * @param {string} errorType - Type of error (auth, connection, dependency, etc.)
   */
  recordError(serverId, error, errorType = 'unknown') {
    console.log(`🔍 Recording error for ${serverId}: [${errorType}] ${error}`);
    this.serverErrors.set(serverId, {
      lastError: error,
      errorType,
      timestamp: new Date()
    });
  }

  /**
   * Get error details for a server
   * @param {string} serverId - Server ID
   * @returns {Object|null} - Error details or null
   */
  getServerError(serverId) {
    return this.serverErrors.get(serverId) || null;
  }

  /**
   * Clear error details for a server (when it becomes healthy)
   * @param {string} serverId - Server ID
   */
  clearServerError(serverId) {
    if (this.serverErrors.has(serverId)) {
      console.log(`Clearing error for ${serverId} - server is now healthy`);
      this.serverErrors.delete(serverId);
    }
  }

  /**
   * Validate command for security (whitelist approach)
   * @param {string} command - Command to validate
   * @returns {string|null} - Validated command or null if invalid
   */
  validateCommand(command) {
    if (typeof command !== 'string') {
      console.error(`Command validation failed: not a string`);
      return null;
    }

    // Extract base command (remove path if present)
    const baseCommand = path.basename(command);
    
    if (!this.allowedCommands.has(baseCommand)) {
      console.error(`Command validation failed: '${baseCommand}' not in allowlist`);
      return null;
    }

    // Additional security checks
    if (command.includes('..') || command.includes(';') || command.includes('&') || command.includes('|')) {
      console.error(`Command validation failed: contains dangerous characters`);
      return null;
    }

    return command;
  }

  /**
   * Validate and sanitize arguments array
   * @param {Array} args - Arguments array to validate
   * @returns {Array} - Sanitized arguments array
   */
  validateArgs(args) {
    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }

    const sanitizedArgs = args.map((arg, index) => {
      if (typeof arg !== 'string') {
        throw new Error(`Argument at index ${index} must be a string`);
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
        /[;&|`$(){}[\]\\]/,  // Command injection characters
        /\x00/,              // Null bytes
        /\.\.\//             // Path traversal attempts
      ];

      if (dangerousPatterns.some(pattern => pattern.test(arg))) {
        throw new Error(`Argument '${arg}' contains potentially dangerous characters`);
      }

      // Limit argument length
      if (arg.length > 1000) {
        throw new Error(`Argument too long: ${arg.length} characters`);
      }

      return arg;
    });

    // Limit total number of arguments
    if (sanitizedArgs.length > 50) {
      throw new Error(`Too many arguments: ${sanitizedArgs.length}`);
    }

    return sanitizedArgs;
  }

  /**
   * Dynamically detect and categorize errors from process output
   * @param {string} serverId - Server ID
   * @param {string} output - Process output
   */
  detectAndRecordErrors(serverId, output) {
    // Skip informational messages that aren't errors
    if (this.isInformationalMessage(output)) {
      return;
    }

    // Extract the most relevant error message from the output
    const errorMessage = this.extractErrorMessage(output);
    if (!errorMessage) return;

    // Dynamically categorize the error type
    const errorType = this.categorizeError(errorMessage, output);
    
    // Record the actual error message from the process
    this.recordError(serverId, errorMessage, errorType);
  }

  /**
   * Check if output is informational and not an error
   * @param {string} output - Process output
   * @returns {boolean} - True if informational
   */
  isInformationalMessage(output) {
    const informationalPatterns = [
      /^INFO:/,
      /Starting .+ on/i,
      /Uvicorn running on/i,
      /Application startup complete/i,
      /Listening on port/i,
      /Building .+ packages/i,
      /Downloading .+\(/i,
      /Installed \d+ packages/i,
      /npm warn/i
    ];

    return informationalPatterns.some(pattern => pattern.test(output));
  }

  /**
   * Extract the most relevant error message from process output
   * @param {string} output - Process output
   * @returns {string|null} - Extracted error message
   */
  extractErrorMessage(output) {
    // Remove common prefixes that add noise
    const cleanOutput = output
      .replace(/^\[[^\]]+\]\s*/, '')  // Remove [prefix] at start
      .replace(/^Child stderr:\s*/i, '') // Remove "Child stderr:" prefix
      .replace(/^Child non-JSON:\s*/i, '') // Remove "Child non-JSON:" prefix
      .trim();
    
    // Try to extract structured error messages first
    const errorPatterns = [
      // Exception/Error patterns
      /ERROR:\s*(.+)/i,
      /Error:\s*(.+)/i,
      /Exception:\s*(.+)/i,
      /RuntimeError:\s*(.+)/i,
      /McpError:\s*(.+)/i,
      /ConnectionError:\s*(.+)/i,
      
      // Question/prompt patterns (usually indicate missing config)  
      /\?\s*(.+(?:API key|token|password|username).+)/i,
      /Please enter your\s+(.+)/i,
      /Missing required\s+(.+)/i,
      /Configuration required:\s*(.+)/i,
      
      // Process exit patterns
      /Child exited:\s*(.+)/i,
      /Process .+ with code\s*(\d+)/i,
      
      // Connection patterns
      /Connection (.+)/i,
      /Failed to connect:\s*(.+)/i,
      /Unable to connect:\s*(.+)/i,
      
      // General failure patterns
      /Failed to (.+)/i,
      /Cannot (.+)/i,
      /Unable to (.+)/i
    ];

    // First try patterns on cleaned output
    for (const pattern of errorPatterns) {
      const match = cleanOutput.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    // Also try patterns on original output in case cleaning removed important context
    for (const pattern of errorPatterns) {
      const match = output.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // If no structured pattern matches, check for critical keywords
    const criticalKeywords = [
      'killed', 'crashed', 'terminated', 'aborted', 'failed', 'error', 
      'exception', 'refused', 'timeout', 'unauthorized', 'forbidden'
    ];

    const lowerOutput = output.toLowerCase();
    if (criticalKeywords.some(keyword => lowerOutput.includes(keyword))) {
      // Return the first line that contains the critical keyword
      const lines = output.split('\n');
      for (const line of lines) {
        if (criticalKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
          return line.trim();
        }
      }
    }

    return null;
  }

  /**
   * Dynamically categorize error type based on content
   * @param {string} errorMessage - Extracted error message
   * @param {string} fullOutput - Full process output for context
   * @returns {string} - Error category
   */
  categorizeError(errorMessage, fullOutput) {
    const lowerMessage = errorMessage.toLowerCase();
    const lowerOutput = fullOutput.toLowerCase();

    // Authentication/Authorization
    if (/api[_\s]*key|token|password|username|auth|login|credential|unauthorized|forbidden|401|403/.test(lowerMessage)) {
      return 'auth';
    }

    // Connection/Network
    if (/connection|connect|network|timeout|refused|closed|host|port|socket|mcperror|runtimeerror.*yield/.test(lowerMessage)) {
      return 'connection';
    }

    // Resource/Memory
    if (/memory|killed|resource|space|limit|137|sigkill|oom/.test(lowerMessage) || lowerOutput.includes('code=137')) {
      return 'resource';
    }

    // Dependency/Installation
    if (/package|dependency|install|build|compile|module|import/.test(lowerMessage)) {
      return 'dependency';
    }

    // Configuration
    if (/config|setting|parameter|missing|required|invalid/.test(lowerMessage)) {
      return 'config';
    }

    // Default to generic error
    return 'runtime';
  }

  /**
   * Generate MCP-Bridge configuration file
   * @param {Object} serverConfig - Server configuration
   * @param {number} port - Allocated port
   * @param {Object} env - Environment variables
   * @returns {Object} - MCP-Bridge configuration object
   */
  generateMCPBridgeConfig(serverConfig, port, env) {
    return {
      inference_server: {
        base_url: "http://localhost:11434/v1", // Dummy inference server URL
        api_key: "dummy" // MCP-Bridge requires this but we don't use inference features
      },
      mcp_servers: {
        [serverConfig.id]: {
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: env // Pass environment variables to the MCP server
        }
      },
      network: {
        host: "0.0.0.0",
        port: port
      },
      logging: {
        log_level: "INFO"
      }
    };
  }

  /**
   * Create MCP-Bridge working directory and config file
   * @param {Object} serverConfig - Server configuration  
   * @param {number} port - Allocated port
   * @param {Object} env - Environment variables
   * @returns {Promise<string>} - Path to working directory
   */
  async createMCPBridgeConfig(serverConfig, port, env) {
    const workingDir = path.join(this.mcpBridgeConfigDir, serverConfig.id);
    const configPath = path.join(workingDir, 'config.json');

    try {
      // Create working directory
      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
      }

      // Generate and write config
      const config = this.generateMCPBridgeConfig(serverConfig, port, env);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log(`📁 Created MCP-Bridge config for ${serverConfig.id} at ${configPath}`);
      return workingDir;
    } catch (error) {
      console.error(`Failed to create MCP-Bridge config for ${serverConfig.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleanup MCP-Bridge config directory for a server
   * @param {string} serverId - Server ID
   */
  cleanupMCPBridgeConfig(serverId) {
    const workingDir = path.join(this.mcpBridgeConfigDir, serverId);
    try {
      if (fs.existsSync(workingDir)) {
        fs.rmSync(workingDir, { recursive: true, force: true });
        console.log(`Cleaned up MCP-Bridge config for ${serverId}`);
      }
    } catch (error) {
      console.warn(`Failed to cleanup MCP-Bridge config for ${serverId}: ${error.message}`);
    }
  }

  /**
   * Spawn MCPO proxy for SSE servers  
   * @param {Object} serverConfig - SSE server configuration
   * @param {number} port - Allocated port
   * @returns {Promise<import('child_process').ChildProcess|null>} - Spawned process or null
   */
  async spawnSSEProxy(serverConfig, port) {
    console.log(`Starting SSE-to-OpenAPI proxy for ${serverConfig.id} on port ${port}`);
    
    const command = "uvx";
    const args = [
      "mcpo",
      "--host", "0.0.0.0",
      "--port", port.toString(),
      "--server-type", "sse",
    ];
    
    // Add headers if provided
    if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
      args.push("--header", JSON.stringify(serverConfig.headers));
    }
    
    // Add the SSE URL
    args.push("--", serverConfig.url);
    
    // Environment setup - add timeout configuration for SSE persistent connections
    const env = {
      ...process.env,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
      // Configure extended timeouts for SSE persistent connections
      // HTTPX defaults to 5s read timeout which breaks SSE streams
      MCP_SSE_READ_TIMEOUT: '300',  // 5 minutes for SSE read timeout
      MCP_SSE_CONNECT_TIMEOUT: '30', // 30s for initial connection
      HTTPX_TIMEOUT: '300',         // Try generic httpx timeout env var
      UVICORN_TIMEOUT_KEEP_ALIVE: '600' // Extended keep-alive for persistent connections
    };

    console.log(`Spawning: ${command} ${args.join(' ')}`);

    const proxyProcess = spawn(command, args, {
      env: env,
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    return proxyProcess;
  }

  /**
   * Spawn MCPO proxy for streamable-http servers  
   * @param {Object} serverConfig - Streamable-HTTP server configuration
   * @param {number} port - Allocated port
   * @returns {Promise<import('child_process').ChildProcess|null>} - Spawned process or null
   */
  async spawnStreamableHttpProxy(serverConfig, port) {
    console.log(`Starting Streamable-HTTP-to-OpenAPI proxy for ${serverConfig.id} on port ${port}`);
    
    const command = "uvx";
    const args = [
      "mcpo",
      "--host", "0.0.0.0",
      "--port", port.toString(),
      "--server-type", "streamable-http",
    ];
    
    // Add headers if provided
    if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
      args.push("--header", JSON.stringify(serverConfig.headers));
    }
    
    // Add the streamable-http URL
    args.push("--", serverConfig.url);
    
    // Environment setup - extended timeouts for persistent HTTP connections
    const env = {
      ...process.env,
      TMPDIR: '/app/tmp',
      NPM_CONFIG_TMP: '/app/tmp',
      NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
      UV_TOOL_DIR: '/home/mcpuser/.local/share/uv/tools',
      UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
      // Configure extended timeouts for streamable-http persistent connections
      MCP_HTTP_READ_TIMEOUT: '300',  // 5 minutes for HTTP read timeout
      MCP_HTTP_CONNECT_TIMEOUT: '30', // 30s for initial connection
      HTTPX_TIMEOUT: '300',         // Try generic httpx timeout env var
      UVICORN_TIMEOUT_KEEP_ALIVE: '600' // Extended keep-alive for persistent connections
    };

    console.log(`Spawning: ${command} ${args.join(' ')}`);

    const proxyProcess = spawn(command, args, {
      env: env,
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    return proxyProcess;
  }

  /**
   * Start a proxy for an MCP server
   * @param {Object} serverConfig - Server configuration
   * @param {Object} options - Optional options (forceProxyType, allowFallback, enableSSEProxy)
   * @returns {Promise<boolean>} - True if started successfully
   */
  async startProxy(serverConfig, options = {}) {
    try {
      // Handle SSE servers - automatically proxy them for OpenWebUI compatibility
      if (serverConfig.transport === 'sse' && serverConfig.url) {
        console.log(`📡 Auto-detected SSE server ${serverConfig.id}, will proxy for OpenWebUI compatibility`);
        // Continue to proxy SSE server using MCPO - no need to skip
      } else if (serverConfig.transport === 'streamable-http' && serverConfig.url) {
        console.log(`📡 Auto-detected Streamable-HTTP server ${serverConfig.id}, will proxy for OpenWebUI compatibility`);
        // Continue to proxy streamable-http server using MCPO - no need to skip
      } else if (!serverConfig.needsProxy) {
        console.log(`Server ${serverConfig.id} doesn't need proxy, skipping`);
        return true;
      }

      // Check if already running
      if (this.runningProxies.has(serverConfig.id)) {
        console.log(`Proxy for ${serverConfig.id} already running`);
        return true;
      }

      // Check retry limits to prevent infinite loops
      const fallbackInfo = this.fallbackAttempts.get(serverConfig.id) || {
        attempts: new Set(),
        lastAttempt: 0,
        totalAttempts: 0
      };

      if (fallbackInfo.totalAttempts >= this.maxRetryAttempts) {
        console.error(`Server ${serverConfig.id} has exceeded maximum retry attempts (${this.maxRetryAttempts}). Marking as failed.`);
        return false;
      }

      // Reset attempts if enough time has passed (30 minutes)
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

      // Determine proxy type order
      const forcedType = options.forceProxyType;
      const allowFallback = options.allowFallback !== false; // default true
      // Treat as explicit only if the Claude config actually provided the key
      const hasExplicit = Object.prototype.hasOwnProperty.call(
        serverConfig,
        "proxyType"
      );
      const explicitType = hasExplicit ? serverConfig.proxyType : undefined;
      const initialType = forcedType || explicitType || this.defaultProxyType;

      // Build try order, excluding already attempted types
      const tryOrder = [];
      if (!fallbackInfo.attempts.has(initialType)) {
        tryOrder.push(initialType);
      }
      
      if (!hasExplicit && allowFallback) {
        const alt = initialType === "mcpo" ? "mcp-bridge" : "mcpo";
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

        // Track this attempt
        fallbackInfo.attempts.add(proxyType);
        fallbackInfo.lastAttempt = Date.now();
        fallbackInfo.totalAttempts++;
        this.fallbackAttempts.set(serverConfig.id, fallbackInfo);

        if (hasExplicit && i === 0 && fallbackInfo.totalAttempts === 1) {
          console.log(
            `Server ${serverConfig.id} has explicit proxyType=${explicitType}; fallback disabled`
          );
        }
        console.log(
          `Starting ${proxyType} proxy for ${serverConfig.id} on port ${port} (attempt ${fallbackInfo.totalAttempts})`
        );
        const proxyProcess = await this.spawnProxy(
          serverConfig,
          port,
          proxyType
        );
        if (!proxyProcess) {
          continue; // try next candidate
        }

        // Tentatively record the process so exit events are captured
        this.runningProxies.set(serverConfig.id, {
          process: proxyProcess,
          port: port,
          config: serverConfig,
          startTime: new Date(),
          restartCount: 0,
          healthy: false, // Will be set to true after health check
          proxyTypeUsed: proxyType,
          fallbackUsed: isFallbackAttempt,
        });

        // Wait longer for MCPO servers to fully initialize their MCP connections
        // SSE and streamable-http servers need extra time to establish session connections
        const isSSEServer = serverConfig.transport === 'sse' || serverConfig.type === 'sse';
        const isStreamableHttpServer = serverConfig.transport === 'streamable-http' || serverConfig.type === 'streamable-http';
        const isPersistentTransport = isSSEServer || isStreamableHttpServer;
        const initDelay = isPersistentTransport ? 15000 : 8000; // 15s for persistent transports, 8s for stdio
        const transportType = isSSEServer ? 'SSE' : isStreamableHttpServer ? 'Streamable-HTTP' : 'stdio';
        console.log(`⏳ Waiting ${initDelay}ms for ${transportType} server initialization...`);
        await this.sleep(initDelay);

        // Perform health check
        const healthResult = await this.healthCheck(serverConfig.id);
        if (healthResult.isHealthy) {
          this.runningProxies.get(serverConfig.id).healthy = true;
          // Clear any previous error when server becomes healthy
          this.clearServerError(serverConfig.id);
          console.log(`Proxy for ${serverConfig.id} is healthy`);
          return true;
        }

        // Check if this is an authentication error that we shouldn't retry
        if (healthResult.isAuthError) {
          console.warn(
            `Server ${serverConfig.id} has authentication errors (HTTP ${healthResult.statusCode}). Marking as running but unhealthy - requires external authentication.`
          );
          this.recordError(serverConfig.id, 'Authentication required for external service', 'auth');
          this.runningProxies.get(serverConfig.id).healthy = false;
          this.runningProxies.get(serverConfig.id).authError = true;
          return true; // Don't retry authentication errors
        }

        console.warn(
          `Proxy for ${serverConfig.id} failed health check using ${proxyType}`
        );
        
        // Record health check failure
        this.recordError(serverConfig.id, `Health check failed for ${proxyType} proxy`, 'health');

        // If explicit type was specified, or this was the last candidate, don't fallback further
        if (hasExplicit || i === tryOrder.length - 1) {
          console.log(`No more fallback options for ${serverConfig.id}, keeping current proxy running`);
          return true; // keep running; health monitor may recover/restart
        }

        console.log(
          `Falling back to alternate proxy for ${
            serverConfig.id
          } (from ${proxyType} to next option)`
        );
        // Stop current attempt before fallback
        await this.stopProxy(serverConfig.id);
        
        // Wait for port cleanup to prevent EADDRINUSE errors
        console.log(`Waiting ${this.portReuseDelay}ms for port cleanup before fallback...`);
        await this.sleep(this.portReuseDelay);
        
        // Reallocate port
        port = this.portManager.allocatePort(serverConfig.id);
        if (!port) {
          console.error(
            `Failed to allocate port for fallback for ${serverConfig.id}`
          );
          return false;
        }
      }

      // If we reach here, all attempts failed to produce a healthy proxy
      console.error(`All proxy attempts failed for ${serverConfig.id} after ${fallbackInfo.totalAttempts} attempts`);
      this.portManager.deallocatePort(serverConfig.id);
      return false;
    } catch (error) {
      console.error(
        `Error starting proxy for ${serverConfig.id}: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Spawn the actual proxy process
   * @param {Object} serverConfig - Server configuration
   * @param {number} port - Allocated port
   * @param {string} proxyType - Proxy type to use ('mcpo' or 'mcp-bridge')
   * @returns {Promise<import('child_process').ChildProcess|null>} - Spawned process or null
   */
  async spawnProxy(serverConfig, port, proxyType = "mcpo") {
    // Special handling for SSE servers - always use MCPO with SSE mode
    if (serverConfig.transport === 'sse' && serverConfig.url) {
      return this.spawnSSEProxy(serverConfig, port);
    }

    // Special handling for streamable-http servers - always use MCPO with streamable-http mode
    if (serverConfig.transport === 'streamable-http' && serverConfig.url) {
      return this.spawnStreamableHttpProxy(serverConfig, port);
    }
    
    // Pre-spawn cache validation and cleanup
    const packageName = this.extractPackageName(serverConfig);
    if (packageName) {
      console.log(`🔍 Validating cache for ${serverConfig.id} (${packageName})`);
      
      try {
        const isCorrupted = await this.installationManager.validateNpmCache(packageName);
        if (isCorrupted) {
          console.log(`🧹 Detected cache corruption for ${serverConfig.id}, cleaning...`);
          await this.installationManager.cleanNpmCache(packageName);
          this.recordError(serverConfig.id, `Cache corruption detected and cleaned for ${packageName}`, 'dependency');
        }
      } catch (error) {
        console.warn(`Cache validation warning for ${serverConfig.id}: ${error.message}`);
      }
    }

    // Prepare environment first (needed for both proxy types)
    const env = {
      ...process.env,
      ...serverConfig.env,
    };

    // Load environment file if specified
    if (serverConfig.envFile && fs.existsSync(serverConfig.envFile)) {
      const envFileContent = fs.readFileSync(serverConfig.envFile, "utf8");
      envFileContent.split("\n").forEach((line) => {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join("=").trim();
        }
      });
    }

    // Initialize command and args variables, and working directory
    let command, args, workingDir = serverConfig.cwd || process.cwd();

    if (proxyType === "mcpo") {
      command = "uvx";
      args = [
        "mcpo",
        "--host",
        "0.0.0.0",
        "--port",
        port.toString(),
        "--",
        serverConfig.command,
        ...serverConfig.args,
      ];
    } else if (proxyType === "mcp-bridge") {
      try {
        // Create MCP-Bridge config file and get working directory
        workingDir = await this.createMCPBridgeConfig(serverConfig, port, env);
        
        command = "uvx";
        args = ["mcp-bridge"];
        
        console.log(`MCP-Bridge will run from ${workingDir} for ${serverConfig.id}`);
      } catch (error) {
        console.error(`Failed to setup MCP-Bridge for ${serverConfig.id}: ${error.message}`);
        return null;
      }
    } else {
      console.error(`Unknown proxy type: ${proxyType}`);
      return null;
    }

    const options = {
      env: env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workingDir,
    };

    // Log effective temp dirs to help diagnose noexec/tmp issues
    const effectiveTmpdir = env.TMPDIR || process.env.TMPDIR || "/tmp";
    const effectiveNpmTmp =
      env.NPM_CONFIG_TMP || process.env.NPM_CONFIG_TMP || "(unset)";
    const effectivePathHead = (env.PATH || process.env.PATH || "")
      .split(":")
      .slice(0, 6)
      .join(":");
    const uvToolDir = env.UV_TOOL_DIR || process.env.UV_TOOL_DIR || "(unset)";
    const uvCacheDir =
      env.UV_CACHE_DIR || process.env.UV_CACHE_DIR || "(unset)";
    const npmCacheDir =
      env.NPM_CONFIG_CACHE || process.env.NPM_CONFIG_CACHE || "(unset)";
    console.log(
      `[${serverConfig.id}] TMPDIR=${effectiveTmpdir} NPM_CONFIG_TMP=${effectiveNpmTmp}`
    );
    console.log(`[${serverConfig.id}] PATH(head)=${effectivePathHead}`);
    console.log(
      `[${serverConfig.id}] UV_TOOL_DIR=${uvToolDir} UV_CACHE_DIR=${uvCacheDir} NPM_CONFIG_CACHE=${npmCacheDir}`
    );

    // Validate command and arguments before spawning for security
    const validatedCommand = this.validateCommand(command);
    const validatedArgs = this.validateArgs(args);

    if (!validatedCommand) {
      throw new Error(`Invalid or unauthorized command: ${command}`);
    }

    console.log(`Spawning: ${validatedCommand} ${validatedArgs.join(" ")}`);

    const childProcess = spawn(validatedCommand, validatedArgs, options);

    // Handle process events
    childProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`[${serverConfig.id}:stdout] ${output}`);
      
      // Also check stdout for errors (some proxies output errors to stdout)
      this.detectAndRecordErrors(serverConfig.id, output);
    });

    childProcess.stderr.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`[${serverConfig.id}:stderr] ${output}`);
      
      // Detect specific error patterns and record them
      this.detectAndRecordErrors(serverConfig.id, output);
    });

    childProcess.on("error", (error) => {
      console.error(`[${serverConfig.id}:error] ${error.message}`);
      
      // Record process spawn errors
      this.recordError(serverConfig.id, error.message, 'runtime');
    });

    childProcess.on("exit", (code, signal) => {
      console.log(`[${serverConfig.id}:exit] code=${code}, signal=${signal}`);
      
      // Don't record errors for intentional shutdowns (SIGTERM, SIGINT) or successful exits
      if (signal !== 'SIGTERM' && signal !== 'SIGINT' && code !== 0 && code !== null) {
        let exitMessage = `Process exited with code ${code}`;
        let errorType = 'runtime';
        
        if (code === 137) {
          exitMessage = 'Process killed by system (likely memory exhaustion)';
          errorType = 'resource';
        } else if (code === 1) {
          exitMessage = 'Process exited with general error';
          errorType = 'runtime';
        } else if (code === 127) {
          exitMessage = 'Command not found or executable not available';
          errorType = 'dependency';
        } else if (code === 126) {
          exitMessage = 'Command found but not executable';
          errorType = 'config';
        }
        
        // Only record exit code errors if we don't have a more specific stderr error
        const existingError = this.getServerError(serverConfig.id);
        if (!existingError || existingError.errorType === 'health' || existingError.lastError.includes('Health check failed')) {
          this.recordError(serverConfig.id, exitMessage, errorType);
        }
      } else if (signal === 'SIGTERM' || signal === 'SIGINT') {
        console.log(`Process ${serverConfig.id} was intentionally stopped (${signal})`);
      }
      
      this.handleProcessExit(serverConfig.id, code);
    });

    return childProcess;
  }

  /**
   * Stop a proxy
   * @param {string} serverId - Server ID
   * @returns {Promise<boolean>} - True if stopped successfully
   */
  async stopProxy(serverId) {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) {
      console.log(`No running proxy found for ${serverId}`);
      return true;
    }

    console.log(`Stopping proxy for ${serverId}`);

    try {
      // Kill the process
      proxyInfo.process.kill("SIGTERM");

      // Wait a bit for graceful shutdown
      await this.sleep(3000);

      // Force kill if still running
      if (!proxyInfo.process.killed) {
        proxyInfo.process.kill("SIGKILL");
      }

      // Clean up
      this.runningProxies.delete(serverId);
      this.portManager.deallocatePort(serverId);
      
      // Clean up MCP-Bridge config if it was used
      if (proxyInfo.proxyTypeUsed === 'mcp-bridge') {
        this.cleanupMCPBridgeConfig(serverId);
      }

      console.log(`Proxy for ${serverId} stopped successfully`);
      return true;
    } catch (error) {
      console.error(`Error stopping proxy for ${serverId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Reset fallback attempts for a server (useful for manual recovery)
   * @param {string} serverId - Server ID
   */
  resetFallbackAttempts(serverId) {
    if (this.fallbackAttempts.has(serverId)) {
      this.fallbackAttempts.delete(serverId);
      console.log(`Reset fallback attempts for ${serverId}`);
    }
  }

  /**
   * Get fallback attempt statistics
   * @returns {Object} - Fallback attempt statistics
   */
  getFallbackStats() {
    const stats = {};
    for (const [serverId, info] of this.fallbackAttempts) {
      stats[serverId] = {
        totalAttempts: info.totalAttempts,
        attemptedTypes: Array.from(info.attempts),
        lastAttempt: new Date(info.lastAttempt).toISOString(),
        maxAttemptsReached: info.totalAttempts >= this.maxRetryAttempts
      };
    }
    return stats;
  }

  /**
   * Restart a proxy
   * @param {string} serverId - Server ID
   * @returns {Promise<boolean>} - True if restarted successfully
   */
  async restartProxy(serverId) {
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
      this.runningProxies.get(serverId).restartCount++;
    }

    return success;
  }

  /**
   * Handle process exit
   * @param {string} serverId - Server ID
   * @param {number} code - Exit code
   * @param {string} signal - Exit signal
   */
  async handleProcessExit(serverId, code) {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return;

    console.log(`Process for ${serverId} exited with code ${code}`);

    // Clean up the proxy info
    this.runningProxies.delete(serverId);
    this.portManager.deallocatePort(serverId);
    
    // Clean up MCP-Bridge config if it was used
    if (proxyInfo.proxyTypeUsed === 'mcp-bridge') {
      this.cleanupMCPBridgeConfig(serverId);
    }

    // Check fallback attempts to prevent infinite restart loops
    const fallbackInfo = this.fallbackAttempts.get(serverId);
    const totalAttempts = fallbackInfo ? fallbackInfo.totalAttempts : 0;

    // Auto-restart if exit was unexpected and limits not exceeded
    if (code !== 0 && proxyInfo.restartCount < 3 && totalAttempts < this.maxRetryAttempts) {
      console.log(
        `Auto-restarting ${serverId} (restart ${proxyInfo.restartCount + 1}, total attempts ${totalAttempts})`
      );
      await this.sleep(5000); // Wait 5 seconds before restart
      await this.startProxy(proxyInfo.config);
    } else if (totalAttempts >= this.maxRetryAttempts) {
      console.error(`Server ${serverId} has exceeded maximum retry attempts, not auto-restarting`);
    }
  }

  /**
   * Perform health check on a proxy
   * @param {string} serverId - Server ID
   * @returns {Promise<{isHealthy: boolean, isAuthError: boolean, statusCode: number|null}>} - Health check result
   */
  async healthCheck(serverId) {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return { isHealthy: false, isAuthError: false, statusCode: null };

    try {
      // Check MCPO-specific endpoints in order of reliability
      const endpoints = [
        {
          url: `http://localhost:${proxyInfo.port}/openapi.json`,
          name: 'openapi'
        },
        {
          url: `http://localhost:${proxyInfo.port}/docs`,
          name: 'docs'
        },
        {
          url: `http://localhost:${proxyInfo.port}/`,
          name: 'root'
        }
      ];

      let lastStatusCode = null;
      let hasAuthError = false;

      for (const endpoint of endpoints) {
        try {
          // SSE servers may need longer to respond during session establishment
          const proxyInfo = this.runningProxies.get(serverId);
          const isSSEServer = proxyInfo?.config?.transport === 'sse' || proxyInfo?.config?.type === 'sse';
          const healthTimeout = isSSEServer ? 10000 : 5000; // 10s for SSE, 5s for stdio
          
          const response = await axios.get(endpoint.url, {
            timeout: healthTimeout,
            validateStatus: (status) => status === 200 // Only 200 OK is healthy
          });

          if (response.status === 200) {
            return { isHealthy: true, isAuthError: false, statusCode: 200 };
          }
        } catch (endpointError) {
          lastStatusCode = endpointError.response?.status || lastStatusCode;
          
          // Check for authentication errors (401 Unauthorized)
          if (endpointError.response?.status === 401) {
            hasAuthError = true;
          }
          
          // Continue to next endpoint
          continue;
        }
      }

      return { 
        isHealthy: false, 
        isAuthError: hasAuthError, 
        statusCode: lastStatusCode 
      };
    } catch (error) {
      console.warn(`Health check failed for ${serverId}: ${error.message}`);
      return { isHealthy: false, isAuthError: false, statusCode: null };
    }
  }

  /**
   * Get status of all proxies
   * @returns {Array} - Array of proxy status objects
   */
  getProxyStatuses() {
    const statuses = [];

    for (const [serverId, proxyInfo] of this.runningProxies) {
      statuses.push({
        serverId: serverId,
        port: proxyInfo.port,
        healthy: proxyInfo.healthy,
        startTime: proxyInfo.startTime,
        restartCount: proxyInfo.restartCount,
        uptime: Date.now() - proxyInfo.startTime.getTime(),
        endpoint: `http://localhost:${proxyInfo.port}`,
        proxyType:
          proxyInfo.proxyTypeUsed ||
          (proxyInfo.config && proxyInfo.config.proxyType) ||
          this.defaultProxyType,
        fallbackUsed: !!proxyInfo.fallbackUsed,
        authError: !!proxyInfo.authError,
      });
    }

    return statuses;
  }

  /**
   * Start health check monitoring
   */
  startHealthMonitoring() {
    // Clear existing interval if any
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(async () => {
      for (const [serverId, proxyInfo] of this.runningProxies) {
        const healthResult = await this.healthCheck(serverId);
        proxyInfo.healthy = healthResult.isHealthy;

        // Clear error when server becomes healthy
        if (healthResult.isHealthy) {
          this.clearServerError(serverId);
        }

        // Don't restart servers with authentication errors
        if (!healthResult.isHealthy && !healthResult.isAuthError && proxyInfo.restartCount < 3) {
          console.log(`Health check failed for ${serverId}, restarting...`);
          await this.restartProxy(serverId);
        } else if (healthResult.isAuthError) {
          console.log(`Server ${serverId} has authentication errors - skipping restart`);
          proxyInfo.authError = true;
        }
      }
    }, this.healthCheckInterval);

    console.log(
      `Started health monitoring (interval: ${this.healthCheckInterval}ms)`
    );
  }

  /**
   * Stop all proxies
   * @returns {Promise<boolean>} - True if all stopped successfully
   */
  async stopAllProxies() {
    console.log("Stopping all proxies...");
    const serverIds = Array.from(this.runningProxies.keys());

    const stopPromises = serverIds.map((serverId) => this.stopProxy(serverId));
    const results = await Promise.all(stopPromises);

    return results.every((result) => result === true);
  }

  /**
   * Extract package name from server configuration for cache validation
   * @param {Object} serverConfig - Server configuration
   * @returns {string|null} - Package name or null
   */
  extractPackageName(serverConfig) {
    if (!serverConfig.args || serverConfig.args.length === 0) return null;

    // Common patterns for different package managers
    const patterns = [
      // NPX patterns: npx -y package-name
      { command: 'npx', pattern: /^-y$|^--yes$/, nextArg: true },
      // UVX patterns: uvx package-name
      { command: 'uvx', pattern: /^[^-]/, currentArg: true },
      // Direct package references
      { command: 'npx', pattern: /^@[\w-]+\/[\w-]+|^[\w-]+/, currentArg: true }
    ];

    for (const { command, pattern, nextArg, currentArg } of patterns) {
      if (serverConfig.command === command) {
        for (let i = 0; i < serverConfig.args.length; i++) {
          const arg = serverConfig.args[i];
          
          if (nextArg && pattern.test(arg) && i + 1 < serverConfig.args.length) {
            const packageArg = serverConfig.args[i + 1];
            if (!packageArg.startsWith('-')) {
              return packageArg.split('@')[0]; // Remove version specifiers
            }
          }
          
          if (currentArg && pattern.test(arg) && !arg.startsWith('-')) {
            return arg.split('@')[0]; // Remove version specifiers
          }
        }
      }
    }

    return null;
  }

  /**
   * Get installation manager statistics
   * @returns {Object} Installation stats
   */
  getInstallationStats() {
    return this.installationManager.getStats();
  }

  /**
   * Force clean NPM cache for a specific server
   * @param {string} serverId - Server ID
   * @returns {Promise<boolean>} - Success status
   */
  async cleanServerCache(serverId) {
    const proxyInfo = this.runningProxies.get(serverId);
    if (!proxyInfo) return false;

    const packageName = this.extractPackageName(proxyInfo.config);
    return await this.installationManager.cleanNpmCache(packageName);
  }

  /**
   * Cleanup all resources and intervals
   */
  cleanup() {
    console.log('🧹 Cleaning up proxy manager resources...');
    
    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('Health check timer cleared');
    }
    
    // Stop all running proxies
    for (const [serverId, proxyInfo] of this.runningProxies) {
      if (proxyInfo.process && !proxyInfo.process.killed) {
        console.log(`Stopping proxy: ${serverId}`);
        proxyInfo.process.kill('SIGTERM');
      }
    }
    
    // Clear running proxies map
    this.runningProxies.clear();
    
    console.log('Proxy manager cleanup complete');
  }

  /**
   * Utility function to sleep
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after timeout
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ProxyManager;
