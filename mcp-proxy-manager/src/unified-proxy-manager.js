const { spawn } = require('child_process'); // Built-in Node.js module
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Unified Proxy Manager - Single MCPO process with config file
 * Alternative to individual proxy approach, uses MCPO's native config support
 */
class UnifiedProxyManager {
  constructor(configPath, portManager) {
    this.configPath = configPath;
    this.portManager = portManager;
    this.mcpoProcess = null;
    this.mcpoPort = null;
    this.startTime = null;
    this.restartCount = 0;
    this.isHealthy = false;
    this.servers = new Map(); // serverId -> server config
    this.healthCheckInterval = null;
  }

  /**
   * Start the unified MCPO process
   * @returns {Promise<boolean>} - Success status
   */
  async start() {
    try {
      if (this.mcpoProcess) {
        console.log('🔄 Unified MCPO already running');
        return true;
      }

      // Allocate port for unified MCPO
      this.mcpoPort = this.portManager.allocatePort('unified-mcpo');
      if (!this.mcpoPort) {
        console.error('Failed to allocate port for unified MCPO');
        return false;
      }

      console.log(`Starting unified MCPO on port ${this.mcpoPort}`);
      console.log(`📁 Config: ${this.configPath}`);

      // Spawn unified MCPO process
      this.mcpoProcess = spawn('uvx', [
        'mcpo',
        '--config', this.configPath,
        '--port', this.mcpoPort.toString(),
        '--host', '0.0.0.0',
        '--hot-reload'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'production'
        }
      });

      this.startTime = new Date();

      // Setup process event handlers
      this.setupProcessHandlers();

      // Wait for startup
      await this.waitForStartup();

      // Start health monitoring
      this.startHealthMonitoring();

      // Load server configs for dashboard
      await this.loadServerConfigs();

      console.log('Unified MCPO started successfully');
      return true;

    } catch (error) {
      console.error('Failed to start unified MCPO:', error.message);
      await this.cleanup();
      return false;
    }
  }

  /**
   * Stop the unified MCPO process
   * @returns {Promise<boolean>} - Success status
   */
  async stop() {
    try {
      console.log('Stopping unified MCPO...');

      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Graceful shutdown
      if (this.mcpoProcess && !this.mcpoProcess.killed) {
        this.mcpoProcess.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await this.sleep(3000);
        
        // Force kill if still running
        if (!this.mcpoProcess.killed) {
          this.mcpoProcess.kill('SIGKILL');
        }
      }

      await this.cleanup();
      console.log('Unified MCPO stopped successfully');
      return true;

    } catch (error) {
      console.error('Error stopping unified MCPO:', error.message);
      return false;
    }
  }

  /**
   * Restart the unified MCPO process
   * @returns {Promise<boolean>} - Success status
   */
  async restart() {
    console.log('🔄 Restarting unified MCPO...');
    this.restartCount++;
    
    await this.stop();
    await this.sleep(2000);
    return await this.start();
  }

  /**
   * Check if unified MCPO is healthy
   * @returns {Promise<boolean>} - Health status
   */
  async checkHealth() {
    if (!this.mcpoProcess || !this.mcpoPort) {
      return false;
    }

    try {
      // Check the docs endpoint which should exist when MCPO is ready
      const response = await axios.get(`http://localhost:${this.mcpoPort}/docs`, {
        timeout: 5000,
        validateStatus: (status) => status === 200
      });

      this.isHealthy = response.status === 200;
      return this.isHealthy;

    } catch (error) {
      // Try checking if the server is at least listening by checking any known route
      try {
        await axios.get(`http://localhost:${this.mcpoPort}/openapi.json`, {
          timeout: 2000,
          validateStatus: (status) => status === 200
        });
        this.isHealthy = true;
        return true;
      } catch (fallbackError) {
        this.isHealthy = false;
        return false;
      }
    }
  }

  /**
   * Get status information
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      mode: 'unified',
      healthy: this.isHealthy,
      port: this.mcpoPort,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      restartCount: this.restartCount,
      endpoint: this.mcpoPort ? `http://localhost:${this.mcpoPort}` : null,
      servers: Array.from(this.servers.values()),
      totalServers: this.servers.size
    };
  }

  /**
   * Get server routes for dashboard
   * @returns {Array} - Array of server route objects
   */
  getServerRoutes() {
    return Array.from(this.servers.values()).map(server => ({
      id: server.id,
      name: server.name,
      route: `/${server.id}`,
      docsUrl: `http://localhost:${this.mcpoPort}/${server.id}/docs`,
      baseUrl: `http://localhost:${this.mcpoPort}/${server.id}`,
      type: server.type || server.transport || 'stdio',
      configured: true
    }));
  }

  /**
   * Get OpenAPI endpoints for OpenWebUI integration
   * @returns {Array} - Array of endpoint objects
   */
  getOpenAPIEndpoints() {
    if (!this.mcpoPort || !this.isHealthy) {
      return [];
    }

    return Array.from(this.servers.values()).map(server => ({
      name: server.id,
      url: `http://localhost:${this.mcpoPort}/${server.id}`,
      openapi_url: `http://localhost:${this.mcpoPort}/${server.id}/openapi.json`,
      docs_url: `http://localhost:${this.mcpoPort}/${server.id}/docs`,
      proxyType: 'unified-mcpo'
    }));
  }

  // Private methods

  setupProcessHandlers() {
    if (!this.mcpoProcess) return;

    this.mcpoProcess.stdout.on('data', (data) => {
      console.log(`[unified-mcpo:stdout] ${data.toString().trim()}`);
    });

    this.mcpoProcess.stderr.on('data', (data) => {
      console.log(`[unified-mcpo:stderr] ${data.toString().trim()}`);
    });

    this.mcpoProcess.on('exit', (code, signal) => {
      console.log(`[unified-mcpo] Process exited with code ${code}, signal ${signal}`);
      this.isHealthy = false;
      
      if (code !== 0 && !signal) {
        console.log('🔄 Unified MCPO crashed, attempting restart...');
        setTimeout(() => this.restart(), 5000);
      }
    });

    this.mcpoProcess.on('error', (error) => {
      console.error('Unified MCPO process error:', error.message);
      this.isHealthy = false;
    });
  }

  async waitForStartup() {
    const maxWait = 30000; // 30 seconds
    const checkInterval = 1000; // 1 second
    let waited = 0;

    console.log('⏳ Waiting for unified MCPO to start...');

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

  startHealthMonitoring() {
    // Clear existing interval if any
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(async () => {
      await this.checkHealth();
    }, 30000); // Check every 30 seconds
  }

  async loadServerConfigs() {
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
          name: name,
          ...serverConfig
        });
      }

      console.log(`Loaded ${this.servers.size} server configs for unified mode`);

    } catch (error) {
      console.error('Error loading server configs:', error.message);
    }
  }

  async cleanup() {
    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    this.mcpoProcess = null;
    this.isHealthy = false;
    
    if (this.mcpoPort) {
      this.portManager.deallocatePort(this.mcpoPort);
      this.mcpoPort = null;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = UnifiedProxyManager;