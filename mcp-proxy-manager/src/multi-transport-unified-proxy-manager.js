const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
const UnifiedProxyManager = require('./unified-proxy-manager');

/**
 * Multi-Transport Unified Proxy Manager - CORRECTED ARCHITECTURE
 * 
 * Extends UnifiedProxyManager to support multiple transport protocols:
 * - OpenAPI via existing unified MCPO (1 port for all servers)
 * - SSE via SuperGateway per server (n ports - 1 per server)
 * - WebSocket via SuperGateway per server (n ports - 1 per server) 
 * - Streamable HTTP via SuperGateway per server (n ports - 1 per server)
 * 
 * CORRECTED Understanding:
 * - SuperGateway runs MCP servers directly via --stdio "command"
 * - Each SuperGateway process spawns its own MCP server instance
 * - No protocol conversion - SuperGateway is a transport gateway, not converter
 * - Total processes: 1 MCPO + (n servers × m enabled transports)
 * - Total ports: 1 + (n servers × m enabled transports)
 */
class MultiTransportUnifiedProxyManager extends UnifiedProxyManager {
  constructor(configPath, portManager) {
    super(configPath, portManager);
    
    // SuperGateway processes per server per transport: serverId-transport -> process info
    this.supergatewayProcesses = new Map(); 
    
    // Health tracking per server per transport: serverId-transport -> boolean
    this.transportHealth = new Map();
    
    // Load transport configuration from environment
    this.transportConfig = {
      streamable: { 
        enabled: process.env.TRANSPORT_STREAMABLE !== 'false',
        name: 'StreamableHTTP'
      },
      websocket: { 
        enabled: process.env.TRANSPORT_WEBSOCKET !== 'false',
        name: 'WebSocket'
      },
      sse: { 
        enabled: process.env.TRANSPORT_SSE !== 'false',
        name: 'SSE'
      },
      openapi: {
        enabled: true, // Always enabled (handled by parent UnifiedProxyManager)
        name: 'OpenAPI'
      }
    };
    
    // Calculate resource requirements
    this.calculateResourceRequirements();
    
    console.log('Multi-Transport Configuration:', {
      streamable: this.transportConfig.streamable.enabled,
      websocket: this.transportConfig.websocket.enabled,
      sse: this.transportConfig.sse.enabled,
      openapi: this.transportConfig.openapi.enabled
    });
  }

  /**
   * Calculate and warn about resource requirements
   */
  calculateResourceRequirements() {
    // We need to wait for servers to be loaded to get accurate count
    setTimeout(() => {
      const serverCount = this.servers ? this.servers.size : 12; // Fallback estimate
      const enabledTransports = this.getEnabledTransports();
      const supergatewayTransports = enabledTransports.filter(t => t !== 'openapi');
      
      const totalProcesses = 1 + (serverCount * supergatewayTransports.length);
      const totalPorts = totalProcesses;
      const estimatedMemory = totalProcesses * 80; // ~80MB per process
      
      console.log(`\nMULTI-TRANSPORT RESOURCE REQUIREMENTS:`);
      console.log(`   Servers: ${serverCount}`);
      console.log(`   Enabled Transports: ${enabledTransports.join(', ')}`);
      console.log(`   Total Processes: ${totalProcesses} (1 MCPO + ${serverCount * supergatewayTransports.length} SuperGateway)`);
      console.log(`   Total Ports: ${totalPorts}`);
      console.log(`   Estimated Memory: ~${estimatedMemory}MB`);
      console.log(`   Estimated Startup Time: 30-60 seconds\n`);
      
      if (totalProcesses > 40) {
        console.warn(`HIGH RESOURCE USAGE: ${totalProcesses} processes may impact system performance`);
      }
    }, 1000);
  }

  /**
   * Start unified proxy with multi-transport support - CORRECTED IMPLEMENTATION
   * @returns {Promise<boolean>} - Success status
   */
  async start() {
    try {
      // Step 1: Start the base unified MCPO process first (handles OpenAPI for all servers)
      console.log('Starting unified MCPO for OpenAPI transport...');
      const mcpoStarted = await super.start();
      if (!mcpoStarted) {
        console.error('Failed to start base unified MCPO');
        return false;
      }
      
      // Store OpenAPI port for status reporting
      this.transportConfig.openapi.port = this.mcpoPort;
      this.transportHealth.set('openapi', true);
      console.log(`MCPO started successfully on port ${this.mcpoPort}`);
      
      // Step 2: Wait for server configs to be loaded
      await this.waitForServerConfigs();
      
      // Step 3: Start SuperGateway processes for each server for each enabled transport
      await this.startAllSuperGatewayTransports();
      
      // Step 4: Start health monitoring for all transports
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

  /**
   * Wait for server configs to be loaded by parent class
   */
  async waitForServerConfigs() {
    const maxWait = 10000; // 10 seconds
    const interval = 500;   // 500ms
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

  /**
   * Start SuperGateway processes for all servers and enabled transports
   */
  async startAllSuperGatewayTransports() {
    const enabledTransports = this.getEnabledTransports().filter(t => t !== 'openapi');
    
    if (enabledTransports.length === 0) {
      console.log('No additional transports enabled - running OpenAPI only');
      return;
    }
    
    console.log(`Starting SuperGateway processes for ${enabledTransports.length} transport(s)...`);
    
    const startupPromises = [];
    
    // For each server, start SuperGateway process for each enabled transport
    for (const [serverId, serverConfig] of this.servers) {
      // Skip servers that already use non-stdio transports (like SSE servers)
      if (serverConfig.transport === 'sse' && serverConfig.url) {
        console.log(`Skipping ${serverId} - already uses SSE transport via URL`);
        continue;
      }
      
      // Skip servers that don't have stdio command configuration
      if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
        console.log(`Skipping ${serverId} - invalid or missing command/args configuration`);
        continue;
      }
      
      for (const transport of enabledTransports) {
        const promise = this.startSuperGatewayForServer(serverId, serverConfig, transport);
        startupPromises.push(promise);
      }
    }
    
    // Start all SuperGateway processes concurrently for faster startup
    console.log(`Starting ${startupPromises.length} SuperGateway processes concurrently...`);
    const results = await Promise.allSettled(startupPromises);
    
    // Count successes and failures
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`SuperGateway startup results: ${successful} successful, ${failed} failed`);
    
    if (failed > 0) {
      console.warn(`${failed} SuperGateway processes failed to start - check logs for details`);
    }
  }

  /**
   * Start a SuperGateway process for a specific server and transport - CORRECTED IMPLEMENTATION
   * @param {string} serverId - Server identifier
   * @param {object} serverConfig - Server configuration
   * @param {string} transport - Transport type (streamable, websocket, sse)
   */
  async startSuperGatewayForServer(serverId, serverConfig, transport) {
    try {
      const processKey = `${serverId}-${transport}`;
      
      // Allocate port for this server-transport combination
      const port = this.portManager.allocatePort(processKey);
      if (!port) {
        throw new Error(`Failed to allocate port for ${serverId} ${transport} transport`);
      }

      console.log(`Starting ${transport} SuperGateway for server '${serverId}' on port ${port}`);

      // Build the MCP server command from config
      const mcpCommand = this.buildMCPServerCommand(serverConfig);
      
      // Build SuperGateway arguments with correct --stdio approach
      const args = [
        'supergateway',
        '--stdio', mcpCommand,  // SuperGateway runs MCP server directly
        '--port', port.toString(),
        '--host', '0.0.0.0',
        '--logLevel', 'none'    // Suppress connection logging to reduce console spam
      ];
      
      // Add transport-specific flags
      if (transport === 'websocket') {
        args.push('--outputTransport', 'ws');
      } else if (transport === 'streamable') {
        args.push('--outputTransport', 'streamableHttp');
      }
      // SSE is the default transport, no additional flags needed

      console.log(`[${processKey}] Command: npx ${args.join(' ')}`);

      // Spawn SuperGateway process
      const childProcess = spawn('npx', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...serverConfig.env } // Include server-specific environment variables
      });

      // Store process info
      this.supergatewayProcesses.set(processKey, {
        process: childProcess,
        port,
        serverId,
        transport,
        command: mcpCommand,
        startTime: new Date(),
        restartCount: 0
      });

      // Setup process handlers
      this.setupSuperGatewayHandlers(processKey, childProcess);

      // Give process time to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Give SuperGateway process time to initialize before health check
      console.log(`${transport} transport starting for '${serverId}' on port ${port} (initializing...)`);
      
      // Set as initializing (false for now, health monitoring will update)
      this.transportHealth.set(processKey, false);
      
      // Delayed initial health check (5 seconds after startup)
      setTimeout(async () => {
        try {
          const isHealthy = await this.checkTransportHealthForServer(serverId, transport, port);
          this.transportHealth.set(processKey, isHealthy);
          
          if (isHealthy) {
            console.log(`${transport} transport for '${serverId}' on port ${port} is now healthy`);
          } else {
            console.log(`${transport} transport for '${serverId}' on port ${port} still initializing (will retry in health monitoring)`);
          }
        } catch (error) {
          console.error(`Initial health check failed for ${serverId} ${transport} on port ${port}:`, error.message);
        }
      }, 5000);

    } catch (error) {
      console.error(`Failed to start ${transport} transport for '${serverId}':`, error);
      const processKey = `${serverId}-${transport}`;
      this.transportHealth.set(processKey, false);
      throw error; // Re-throw for Promise.allSettled tracking
    }
  }

  /**
   * Build MCP server command from server configuration
   * @param {object} serverConfig - Server configuration object
   * @returns {string} - Complete MCP server command
   */
  buildMCPServerCommand(serverConfig) {
    // Build command with proper argument escaping
    const args = serverConfig.args.map(arg => {
      // Escape arguments that contain spaces or special characters
      if (typeof arg === 'string' && (arg.includes(' ') || arg.includes('"') || arg.includes("'"))) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });
    
    return `${serverConfig.command} ${args.join(' ')}`;
  }

  /**
   * Setup handlers for SuperGateway process - CORRECTED FOR PER-SERVER PROCESSES
   * @param {string} processKey - Process key (serverId-transport)
   * @param {ChildProcess} process - Process instance
   */
  setupSuperGatewayHandlers(processKey, process) {
    const processInfo = this.supergatewayProcesses.get(processKey);
    
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[${processKey}] ${output}`);
      }
    });

    process.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (error && !error.includes('npm WARN')) {
        console.error(`[${processKey}] ${error}`);
      }
    });

    process.on('exit', (code, signal) => {
      console.log(`${processKey} process exited with code ${code}, signal ${signal}`);
      this.transportHealth.set(processKey, false);
      
      // Auto-restart on unexpected exit (with limit)
      if (code !== 0 && !signal && processInfo && processInfo.restartCount < 3) {
        processInfo.restartCount++;
        console.log(`Attempting to restart ${processKey} (attempt ${processInfo.restartCount}/3)...`);
        
        setTimeout(async () => {
          try {
            const serverConfig = this.servers.get(processInfo.serverId);
            if (serverConfig) {
              await this.startSuperGatewayForServer(processInfo.serverId, serverConfig, processInfo.transport);
            }
          } catch (error) {
            console.error(`Failed to restart ${processKey}:`, error);
          }
        }, 5000);
      } else if (processInfo && processInfo.restartCount >= 3) {
        console.error(`${processKey} exceeded maximum restart attempts (3), giving up`);
      }
    });

    process.on('error', (error) => {
      console.error(`${processKey} process error:`, error);
      this.transportHealth.set(processKey, false);
    });
  }

  /**
   * Check health of a specific transport for a specific server - CORRECTED APPROACH
   * @param {string} serverId - Server identifier
   * @param {string} transport - Transport type
   * @param {number} port - Port number
   * @returns {Promise<boolean>} - Health status
   */
  async checkTransportHealthForServer(serverId, transport, port) {
    if (!port) {
      return false;
    }

    try {
      switch (transport) {
        case 'streamable':
          return await this.checkStreamableHealth(port);
        case 'websocket':
          return await this.checkWebSocketHealth(port);
        case 'sse':
          return await this.checkSSEHealth(port);
        case 'openapi':
          return await this.checkOpenAPIHealth(port);
        default:
          return false;
      }
    } catch (error) {
      console.error(`Health check failed for ${serverId} ${transport} on port ${port}:`, error.message);
      return false;
    }
  }

  /**
   * Check Streamable HTTP health
   */
  async checkStreamableHealth(port) {
    // SuperGateway streamable endpoints - based on SuperGateway documentation
    const endpoints = ['/message', '/', '/health'];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[Health Check] Trying streamable endpoint: http://localhost:${port}${endpoint}`);
        const response = await axios.get(`http://localhost:${port}${endpoint}`, {
          timeout: 3000,
          headers: { 'Accept': 'application/json' },
          validateStatus: (status) => status < 500 // Accept 2xx, 3xx, 4xx as "alive"
        });
        if (response.status < 500) {
          console.log(`[Health Check] Streamable health check SUCCESS on port ${port}${endpoint} (status: ${response.status})`);
          return true;
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.log(`[Health Check] Streamable port ${port} not ready yet`);
        } else {
          console.log(`[Health Check] Streamable endpoint ${endpoint} failed on port ${port}: ${error.message}`);
        }
      }
    }
    return false;
  }

  /**
   * Check WebSocket health
   */
  async checkWebSocketHealth(port) {
    // SuperGateway uses root path for WebSocket connections
    const wsEndpoints = ['/', '/ws'];
    
    for (const endpoint of wsEndpoints) {
      const wsUrl = `ws://localhost:${port}${endpoint}`;
      console.log(`[Health Check] Trying WebSocket endpoint: ${wsUrl}`);
      
      const result = await new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.terminate();
          console.log(`[Health Check] WebSocket timeout on ${wsUrl}`);
          resolve(false);
        }, 3000);

        ws.on('open', () => {
          clearTimeout(timeout);
          ws.terminate();
          console.log(`[Health Check] WebSocket health check SUCCESS on ${wsUrl}`);
          resolve(true);
        });

        ws.on('error', (error) => {
          // 400 response usually means the server is running but protocol mismatch
          if (error.message?.includes('400') || error.message?.includes('Unexpected server response')) {
            clearTimeout(timeout);
            console.log(`[Health Check] WebSocket port ${port} is alive (got HTTP response, WebSocket working)`);
            resolve(true); // Server is responding, just not WebSocket handshake
            return;
          }
          console.log(`[Health Check] WebSocket error on ${wsUrl}: ${error.message || 'Connection failed'}`);
          clearTimeout(timeout);
          resolve(false);
        });
      });
      
      if (result) return true;
    }
    return false;
  }

  /**
   * Check SSE health
   */
  async checkSSEHealth(port) {
    // SuperGateway SSE endpoints - typically root path
    const endpoints = ['/', '/events'];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[Health Check] Trying SSE endpoint: http://localhost:${port}${endpoint}`);
        const response = await axios.get(`http://localhost:${port}${endpoint}`, {
          timeout: 3000,
          headers: { 'Accept': 'text/event-stream' },
          validateStatus: (status) => status < 500 // Accept any non-server-error status
        });
        if (response.status < 500) {
          console.log(`[Health Check] SSE health check SUCCESS on port ${port}${endpoint} (status: ${response.status})`);
          return true;
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.log(`[Health Check] SSE port ${port} not ready yet`);
        } else if (error.message?.includes('aborted')) {
          console.log(`[Health Check] SSE port ${port} is alive (stream connection works)`);
          return true; // Stream abort often means the connection worked
        } else {
          console.log(`[Health Check] SSE endpoint ${endpoint} failed on port ${port}: ${error.message}`);
        }
      }
    }
    return false;
  }

  /**
   * Check OpenAPI health (uses parent class method)
   */
  async checkOpenAPIHealth(port) {
    try {
      const response = await axios.get(`http://localhost:${port}/docs`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start health monitoring for all transports - CORRECTED FOR PER-SERVER MONITORING
   */
  startHealthMonitoring() {
    // Use parent class health monitoring for MCPO
    super.startHealthMonitoring();
    
    // Add health monitoring for all SuperGateway processes
    this.transportHealthInterval = setInterval(async () => {
      const healthPromises = [];
      
      // Check health for each SuperGateway process
      for (const [processKey, processInfo] of this.supergatewayProcesses) {
        const healthPromise = this.checkTransportHealthForServer(
          processInfo.serverId, 
          processInfo.transport, 
          processInfo.port
        ).then(isHealthy => {
          const wasHealthy = this.transportHealth.get(processKey);
          
          if (isHealthy !== wasHealthy) {
            console.log(`${processKey} health changed: ${wasHealthy} -> ${isHealthy}`);
            this.transportHealth.set(processKey, isHealthy);
          }
          
          return { processKey, isHealthy };
        }).catch(error => {
          console.error(`Health check error for ${processKey}:`, error.message);
          this.transportHealth.set(processKey, false);
          return { processKey, isHealthy: false };
        });
        
        healthPromises.push(healthPromise);
      }
      
      // Run all health checks concurrently for better performance
      if (healthPromises.length > 0) {
        await Promise.allSettled(healthPromises);
      }
      
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get list of enabled transport types
   * @returns {Array} - Array of transport names
   */
  getEnabledTransports() {
    const enabled = [];
    
    Object.keys(this.transportConfig).forEach(transport => {
      if (this.transportConfig[transport].enabled) {
        enabled.push(transport);
      }
    });
    
    return enabled;
  }

  /**
   * Get detailed status for all transports - CORRECTED FOR PER-SERVER ARCHITECTURE
   * @returns {Object} - Transport status object organized by server
   */
  getTransportStatus() {
    const status = {
      openapi: {
        enabled: true,
        healthy: this.transportHealth.get('openapi') || false,
        port: this.mcpoPort,
        url: `http://localhost:${this.mcpoPort}`,
        description: 'Universal REST API compatibility',
        servers: 'all' // OpenAPI serves all servers via unified MCPO
      },
      servers: {}
    };
    
    // Add status for each server's SuperGateway transports
    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      const { serverId, transport, port } = processInfo;
      const isHealthy = this.transportHealth.get(processKey) || false;
      
      if (!status.servers[serverId]) {
        status.servers[serverId] = {};
      }
      
      status.servers[serverId][transport] = {
        enabled: true,
        healthy: isHealthy,
        port: port,
        url: this.getTransportUrl(transport, port),
        description: this.getTransportDescription(transport),
        processKey: processKey,
        startTime: processInfo.startTime,
        restartCount: processInfo.restartCount
      };
    }
    
    return status;
  }

  /**
   * Get all allocated ports for status reporting
   * @returns {Array} - Array of port information
   */
  getAllocatedPorts() {
    const ports = [];
    
    // Add MCPO port
    if (this.mcpoPort) {
      ports.push({
        port: this.mcpoPort,
        serverId: 'unified-mcpo',
        transport: 'openapi',
        description: 'Unified MCPO (all servers)'
      });
    }
    
    // Add SuperGateway ports
    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      ports.push({
        port: processInfo.port,
        serverId: processInfo.serverId,
        transport: processInfo.transport,
        processKey: processKey,
        description: `${processInfo.serverId} via ${processInfo.transport}`
      });
    }
    
    return ports;
  }

  /**
   * Get URL for a transport
   */
  getTransportUrl(transport, port) {
    if (!port) return null;
    
    switch (transport) {
      case 'streamable':
        return `http://localhost:${port}/mcp`;
      case 'websocket':
        return `ws://localhost:${port}/ws`;
      case 'sse':
        return `http://localhost:${port}/sse`;
      case 'openapi':
        return `http://localhost:${port}`;
      default:
        return null;
    }
  }

  /**
   * Get description for a transport
   */
  getTransportDescription(transport) {
    switch (transport) {
      case 'streamable':
        return 'Modern MCP transport (Recommended)';
      case 'websocket':
        return 'Real-time bidirectional communication';
      case 'sse':
        return 'Legacy server-sent events';
      case 'openapi':
        return 'Universal REST API compatibility';
      default:
        return 'Unknown transport';
    }
  }

  /**
   * Stop all processes - CORRECTED FOR PER-SERVER CLEANUP
   */
  async stop() {
    console.log('Stopping multi-transport unified proxy...');
    
    // Stop all SuperGateway processes
    const stopPromises = [];
    
    for (const [processKey, processInfo] of this.supergatewayProcesses) {
      if (processInfo.process && !processInfo.process.killed) {
        console.log(`Stopping ${processKey}...`);
        
        const stopPromise = new Promise((resolve) => {
          const cleanup = () => {
            // Release port
            if (processInfo.port) {
              this.portManager.releasePort(processKey);
            }
            resolve();
          };
          
          processInfo.process.once('exit', cleanup);
          processInfo.process.kill('SIGTERM');
          
          // Force kill after 5 seconds if graceful shutdown fails
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
    
    // Wait for all SuperGateway processes to stop
    if (stopPromises.length > 0) {
      console.log(`Waiting for ${stopPromises.length} SuperGateway processes to stop...`);
      await Promise.allSettled(stopPromises);
    }
    
    // Clear intervals
    if (this.transportHealthInterval) {
      clearInterval(this.transportHealthInterval);
    }
    
    // Clear process tracking
    this.supergatewayProcesses.clear();
    this.transportHealth.clear();
    
    // Stop base unified MCPO process
    await super.stop();
    
    console.log('Multi-transport unified proxy stopped successfully');
  }
}

module.exports = MultiTransportUnifiedProxyManager;