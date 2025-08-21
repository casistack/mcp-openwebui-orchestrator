const express = require('express');
const chokidar = require('chokidar');
const path = require('path');
const rateLimit = require('express-rate-limit');

const ConfigParser = require('./config-parser');
const PortManager = require('./port-manager');
const ProxyManager = require('./proxy-manager');
const HealthMonitor = require('./health-monitor');
const EnvironmentManager = require('./environment-manager');
const ContainerEnvironmentManager = require('./container-env-manager');
const ModeDetector = require('./mode-detector');
const UnifiedProxyManager = require('./unified-proxy-manager');
const ConfigValidator = require('./config-validator');
const { Logger, MCPError, ErrorCodes } = require('./error-handler');

class MCPProxyManagerApp {
  constructor() {
    this.app = express();
    this.port = process.env.MANAGER_PORT || 3001;
    
    this.configPath = process.env.CLAUDE_CONFIG_PATH || '/config/claude_desktop_config.json';
    this.proxyType = process.env.MCP_PROXY_TYPE || 'mcpo'; // 'mcpo' or 'supergateway'
    this.portRangeStart = parseInt(process.env.PORT_RANGE_START) || 4000;
    this.portRangeEnd = parseInt(process.env.PORT_RANGE_END) || 4100;
    
    this.modeDetector = new ModeDetector();
    console.log(`MCP Proxy Mode: ${this.modeDetector.getMode()}`);
    console.log(`Mode: ${this.modeDetector.getModeDescription()}`);
    
    this.configParser = new ConfigParser(this.configPath);
    this.portManager = new PortManager(this.portRangeStart, this.portRangeEnd);
    this.environmentManager = new EnvironmentManager();
    this.containerEnvManager = new ContainerEnvironmentManager(this.environmentManager);
    
    // Mode-specific managers
    if (this.modeDetector.isIndividualMode()) {
      // Original individual proxy approach
      this.proxyManager = new ProxyManager(this.portManager, this.proxyType);
      this.healthMonitor = new HealthMonitor(this.proxyManager, this.configParser);
      this.currentServers = new Map();
    } else {
      // New unified MCPO approach
      this.unifiedProxyManager = new UnifiedProxyManager(this.configPath, this.portManager);
    }
    
    this.configWatcher = null;
    
    this.validateSecurityConfiguration();
    this.setupExpress();
    this.setupGracefulShutdown();
  }

  /**
   * Validate security configuration
   */
  validateSecurityConfiguration() {
    const insecureValues = [
      'your-secret-key-here',
      'CHANGE_THIS_TO_SECURE_RANDOM_STRING',
      'default',
      'secret',
      'password',
      '123456'
    ];

    // Check for insecure WEBUI_SECRET_KEY
    const secretKey = process.env.WEBUI_SECRET_KEY;
    if (secretKey && insecureValues.some(insecure => secretKey.toLowerCase().includes(insecure.toLowerCase()))) {
      console.warn('WARNING: WEBUI_SECRET_KEY appears to use a default or insecure value');
      console.warn('   Generate a secure key with: openssl rand -hex 32');
    }

    // Check for missing ALLOWED_ORIGINS in production
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      console.warn('WARNING: ALLOWED_ORIGINS not set in production environment');
      console.warn('   Set specific allowed origins to prevent CSRF attacks');
    }

    // Validate port range
    const portStart = parseInt(process.env.PORT_RANGE_START) || this.portRangeStart;
    const portEnd = parseInt(process.env.PORT_RANGE_END) || this.portRangeEnd;
    
    try {
      ConfigValidator.validatePortRange(portStart, portEnd);
    } catch (error) {
      Logger.error('Port range validation failed', error);
      throw new MCPError('Invalid port range configuration', ErrorCodes.CONFIG_ERROR, { portStart, portEnd });
    }
  }

  /**
   * Setup Express server and routes
   */
  setupExpress() {
    this.app.set('trust proxy', true);
    this.app.use(express.json({ limit: '10mb' }));
    
    // Input validation middleware (security only - no rate limiting)
    this.app.use(this.validateInput.bind(this));
    
    // Rate limiting middleware using express-rate-limit
    this.setupRateLimiting();
    
    // CORS middleware with secure configuration
    this.app.use((req, res, next) => {
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) || [
        'http://localhost:3000',
        'http://localhost:8080',
        'http://localhost:5000'
      ];
      
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else if (!origin) {
        // Allow same-origin requests
        res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
      }
      
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      next();
    });

    // Serve static files for dashboard
    this.app.use('/static', express.static(path.join(__dirname, 'static')));
    
    // Dashboard route
    this.app.get('/dashboard', (req, res) => {
      res.sendFile(path.join(__dirname, 'static', 'dashboard.html'));
    });

    // Routes
    this.app.get('/health', this.handleHealthCheck.bind(this));
    this.app.get('/status', this.handleStatus.bind(this));
    this.app.get('/servers', this.handleGetServers.bind(this));
    this.app.get('/servers/:id/health', this.handleServerHealth.bind(this));
    // Server control routes with rate limiting applied directly to POST routes
    this.app.post('/servers/:id/restart', this.serverControlLimiter, this.handleRestartServer.bind(this));
    this.app.post('/servers/:id/stop', this.serverControlLimiter, this.handleStopServer.bind(this));
    this.app.post('/servers/:id/start', this.serverControlLimiter, this.handleStartServer.bind(this));
    this.app.get('/config', this.handleGetConfig.bind(this));
    this.app.post('/config/reload', this.serverControlLimiter, this.handleReloadConfig.bind(this));
    this.app.get('/openapi-endpoints', this.handleGetOpenAPIEndpoints.bind(this));
    this.app.get('/ports', this.handleGetPorts.bind(this));
    this.app.get('/installation-stats', this.handleGetInstallationStats.bind(this));
    this.app.post('/servers/:id/clean-cache', this.handleCleanServerCache.bind(this));
    this.app.post('/system/clean-cache', this.handleCleanSystemCache.bind(this));
    
    
    // Container-level environment management
    this.app.get('/container-environment', this.handleGetContainerEnvironment.bind(this));
    this.app.post('/container-environment', this.handleSetContainerEnvironment.bind(this));
    this.app.post('/container-environment/:serverId', this.handleSetServerContainerEnvironment.bind(this));
    this.app.get('/container-environment/test', this.handleTestContainerEnvironment.bind(this));
    
    // Default route
    this.app.get('/', (req, res) => {
      res.json({
        name: 'MCP Proxy Manager',
        version: '1.0.0',
        status: 'running',
        proxyType: this.proxyType,
        configPath: this.configPath,
        endpoints: {
          health: '/health',
          status: '/status',
          servers: '/servers',
          config: '/config',
          openapi: '/openapi-endpoints',
          dashboard: '/dashboard'
        },
        dashboard: {
          url: '/dashboard',
          description: 'Web-based status dashboard for monitoring servers and OpenWebUI integration'
        }
      });
    });
  }

  /**
   * Setup rate limiting using express-rate-limit with best practices
   */
  setupRateLimiting() {
    // Create rate limiter ONLY for destructive server operations  
    this.serverControlLimiter = rateLimit({
      windowMs: 2 * 60 * 1000, // 2 minutes
      limit: 5, // 5 operations per 2 minutes per IP
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res, next, options) => {
        res.set('X-RateLimit-Applied', 'server-control-debug');
        return res.status(options.statusCode).json({ 
          error: 'Too many server control operations. Please wait before trying again.' 
        });
      }
    });
    
    console.log('Rate limiting configured: ONLY for destructive server operations via per-route attachment');
  }

  /**
   * Input validation middleware for security only (rate limiting handled separately)
   */
  validateInput(req, res, next) {
    // Validate server ID parameters for security
    if (req.params.id && !this.isValidServerId(req.params.id)) {
      return res.status(400).json({ 
        error: 'Invalid server ID format. Server ID must be alphanumeric with hyphens and underscores only.' 
      });
    }
    
    if (req.params.serverId && !this.isValidServerId(req.params.serverId)) {
      return res.status(400).json({ 
        error: 'Invalid server ID format. Server ID must be alphanumeric with hyphens and underscores only.' 
      });
    }

    // Validate JSON body for POST requests
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
      if (!this.isValidJsonBody(req.body)) {
        return res.status(400).json({ 
          error: 'Invalid request body format or contains potentially dangerous content.' 
        });
      }
    }

    next();
  }

  /**
   * Validate server ID format
   */
  isValidServerId(serverId) {
    // Allow alphanumeric characters, hyphens, underscores, and dots (max 100 chars)
    const serverIdRegex = /^[a-zA-Z0-9_.-]{1,100}$/;
    return serverIdRegex.test(serverId) && !serverId.includes('..') && !serverId.startsWith('.');
  }

  /**
   * Validate JSON request body
   */
  isValidJsonBody(body) {
    if (typeof body !== 'object' || body === null) {
      return false;
    }

    // Check for dangerous content in values
    const dangerousPatterns = [
      /[;&|`$(){}[\]\\]/,  // Command injection characters
      /\.\./,              // Path traversal
      /<script|javascript:|data:/i,  // XSS patterns
      /\x00/               // Null bytes
    ];

    const checkValue = (value) => {
      if (typeof value === 'string') {
        return !dangerousPatterns.some(pattern => pattern.test(value));
      } else if (typeof value === 'object' && value !== null) {
        return Object.values(value).every(checkValue);
      }
      return true;
    };

    return Object.values(body).every(checkValue);
  }


  /**
   * Start the application
   */
  async start() {
    try {
      console.log('Starting MCP Proxy Manager...');
      console.log(`Config path: ${this.configPath}`);
      console.log(`Port range: ${this.portRangeStart}-${this.portRangeEnd}`);

      if (this.modeDetector.isIndividualMode()) {
        console.log(`Proxy type: ${this.proxyType}`);
        
        // Original individual proxy startup
        await this.loadAndStartProxies();
        this.startConfigWatcher();
        this.healthMonitor.startMonitoring();
        
      } else {
        console.log('Using unified MCPO mode');
        
        // New unified proxy startup
        const success = await this.unifiedProxyManager.start();
        if (!success) {
          throw new Error('Failed to start unified MCPO');
        }
        
        // Watch config for unified mode (simpler, just restart on change)
        this.startConfigWatcher();
      }

      // Start Express server
      this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`Management API server running on http://0.0.0.0:${this.port}`);
        console.log('MCP Proxy Manager started successfully');
      });

    } catch (error) {
      console.error('Failed to start MCP Proxy Manager:', error.message);
      process.exit(1);
    }
  }

  /**
   * Load configuration and start proxies
   */
  async loadAndStartProxies() {
    // Only used in individual mode
    if (!this.modeDetector.isIndividualMode()) {
      return;
    }

    try {
      const servers = await this.configParser.getMCPServers();
      console.log(`Found ${servers.length} MCP servers in configuration`);

      // Additional safety check: If we get 0 servers but config file exists,
      // there might be a parsing issue. Wait and retry once.
      if (servers.length === 0 && this.currentServers.size > 0) {
        console.warn('Config parsing returned 0 servers, waiting 2 seconds and retrying...');
        await this.sleep(2000);
        
        const retryServers = await this.configParser.getMCPServers();
        if (retryServers.length === 0) {
          console.warn('Retry also returned 0 servers. Skipping reconciliation to prevent mass shutdown.');
          return;
        }
        
        console.log(`Retry found ${retryServers.length} MCP servers in configuration`);
        await this.reconcileProxies(retryServers);
      } else {
        await this.reconcileProxies(servers);
      }
    } catch (error) {
      console.error('Error loading and starting proxies:', error.message);
      console.warn('Skipping reconciliation due to error to prevent service disruption');
    }
  }

  /**
   * Reconcile current running proxies with desired configuration
   * @param {Array} desiredServers - Array of desired server configurations
   */
  async reconcileProxies(desiredServers) {
    const currentServerIds = new Set(this.currentServers.keys());
    const desiredServerIds = new Set(desiredServers.map(s => s.id));

    // Safety check: If desiredServers is empty but we have many running servers,
    // this likely indicates a config parsing error. Skip mass shutdown.
    if (desiredServers.length === 0 && currentServerIds.size > 2) {
      console.warn(`Skipping reconciliation: Found 0 desired servers but ${currentServerIds.size} running servers. This likely indicates a config parsing error.`);
      return;
    }

    // Stop removed servers with proper delays to prevent port conflicts
    const serversToRemove = Array.from(currentServerIds).filter(id => !desiredServerIds.has(id));
    if (serversToRemove.length > 0) {
      console.log(`Stopping ${serversToRemove.length} removed servers...`);
      
      // Stop servers sequentially with delays to prevent port conflicts
      for (const serverId of serversToRemove) {
        console.log(`Removing server: ${serverId}`);
        await this.proxyManager.stopProxy(serverId);
        this.currentServers.delete(serverId);
        
        // Add delay between stops when removing multiple servers
        if (serversToRemove.length > 1) {
          await this.sleep(2000); // 2 second delay between removals
        }
      }
      
      // Extra delay after mass removals before starting new servers
      if (serversToRemove.length > 3) {
        console.log(`⏳ Waiting additional 5 seconds after stopping ${serversToRemove.length} servers...`);
        await this.sleep(5000);
      }
    }

    // Start new servers or update existing ones
    for (const server of desiredServers) {
      const existingServer = this.currentServers.get(server.id);
      
      // Enhance server config with environment variables
      let enhancedServer = this.environmentManager.updateServerConfigWithEnvFile(server);
      
      // Add global container environment variables
      const globalEnvVars = this.containerEnvManager.getGlobalEnvironmentVariables();
      const globalEnvPlainValues = {};
      for (const [key, data] of Object.entries(globalEnvVars)) {
        globalEnvPlainValues[key] = data.value;
      }
      
      // Merge global environment variables with server-specific ones
      enhancedServer = {
        ...enhancedServer,
        env: {
          ...globalEnvPlainValues, // Global variables first
          ...enhancedServer.env    // Server-specific variables override global
        }
      };
      
      if (!existingServer) {
        // New server
        console.log(`🆕 Adding server: ${server.id}`);
        const started = await this.proxyManager.startProxy(enhancedServer);
        if (started) {
          this.currentServers.set(server.id, enhancedServer);
        }
      } else {
        // Check if server config changed (including env vars)
        const configChanged = JSON.stringify(existingServer) !== JSON.stringify(enhancedServer);
        if (configChanged) {
          console.log(`🔄 Updating server: ${server.id}`);
          await this.proxyManager.stopProxy(server.id);
          const started = await this.proxyManager.startProxy(enhancedServer);
          if (started) {
            this.currentServers.set(server.id, enhancedServer);
          }
        }
      }
    }

    console.log(`Reconciliation complete. Running ${this.currentServers.size} servers`);
  }

  /**
   * Start configuration file watcher
   */
  startConfigWatcher() {
    if (this.configWatcher) {
      this.configWatcher.close();
    }

    this.configWatcher = chokidar.watch(this.configPath, {
      persistent: true,
      usePolling: true, // Better for Docker environments
      interval: 1000
    });

    this.configWatcher.on('change', async () => {
      console.log('📝 Configuration file changed, reloading...');
      
      if (this.modeDetector.isIndividualMode()) {
        // Individual mode: reconcile servers
        await this.loadAndStartProxies();
      } else {
        // Unified mode: restart MCPO (hot-reload should handle this, but restart as backup)
        console.log('🔄 Unified mode: MCPO hot-reload should handle config changes automatically');
        // Note: MCPO --hot-reload should handle this automatically
      }
    });

    this.configWatcher.on('error', (error) => {
      console.error('Configuration watcher error:', error.message);
    });

    console.log(`👀 Watching configuration file: ${this.configPath}`);
  }

  // Express route handlers

  handleHealthCheck(req, res) {
    res.json({ status: 'healthy', timestamp: new Date() });
  }

  async handleStatus(req, res) {
    const portStats = this.portManager.getStats();
    const configStats = await this.configParser.getConfigStats();
    
    if (this.modeDetector.isIndividualMode()) {
      // Individual mode: existing logic
      const proxyStatuses = this.proxyManager.getProxyStatuses();
      const allConfiguredServers = await this.configParser.getMCPServers();
      const fallbackStats = this.proxyManager.getFallbackStats();
      
      // Create comprehensive server list including failed/skipped servers
      const comprehensiveProxies = allConfiguredServers.map(server => {
        const runningProxy = proxyStatuses.find(p => p.serverId === server.id);
        const fallbackInfo = fallbackStats[server.id];
        
        if (runningProxy) {
          // Server is currently running
          return {
            ...runningProxy,
            configured: true,
            serverConfig: server,
            fallbackInfo
          };
        } else {
          // Server is configured but not running (failed or skipped)
          const needsProxy = server.needsProxy !== false;
          
          // Get specific error details if available
          let reason = needsProxy ? 'Proxy startup failed or maximum retries exceeded' : 'Server uses SSE/direct connection, no proxy needed';
          let errorType = 'unknown';
          
          if (needsProxy) {
            const errorDetails = this.proxyManager.getServerError(server.id);
            if (errorDetails) {
              reason = errorDetails.lastError;
              errorType = errorDetails.errorType;
            }
          }
          
          // Determine appropriate proxyType display for different server types
          let displayProxyType;
          if (server.transport === 'sse') {
            displayProxyType = 'SSE (Proxied)';
          } else if (!needsProxy) {
            displayProxyType = 'Direct';
          } else {
            displayProxyType = server.proxyType || this.proxyType;
          }
          
          return {
            serverId: server.id,
            configured: true,
            healthy: false,
            port: null,
            startTime: null,
            restartCount: 0,
            uptime: 0,
            endpoint: null,
            proxyType: displayProxyType,
            fallbackUsed: false,
            authError: errorType === 'auth',
            serverConfig: server,
            needsProxy,
            status: needsProxy ? 'failed' : 'skipped',
            reason,
            errorType,
            fallbackInfo
          };
        }
      });
      
      res.json({
        mode: 'individual',
        status: 'running',
        timestamp: new Date(),
        proxies: comprehensiveProxies,
        summary: {
          total: allConfiguredServers.length,
          running: proxyStatuses.length,
          healthy: proxyStatuses.filter(p => p.healthy).length,
          failed: comprehensiveProxies.filter(p => p.status === 'failed').length,
          skipped: comprehensiveProxies.filter(p => p.status === 'skipped').length
        },
        ports: portStats,
        config: configStats,
        proxyType: this.proxyType,
        fallbackStats
      });
    } else {
      // Unified mode: simplified status
      const unifiedStatus = this.unifiedProxyManager.getStatus();
      const serverRoutes = this.unifiedProxyManager.getServerRoutes();
      
      res.json({
        mode: 'unified',
        status: 'running',
        timestamp: new Date(),
        unifiedProxy: unifiedStatus,
        serverRoutes: serverRoutes,
        summary: {
          total: unifiedStatus.totalServers,
          running: unifiedStatus.healthy ? 1 : 0,
          healthy: unifiedStatus.healthy ? unifiedStatus.totalServers : 0,
          failed: unifiedStatus.healthy ? 0 : unifiedStatus.totalServers,
          skipped: 0
        },
        ports: portStats,
        config: configStats,
        proxyType: 'unified-mcpo'
      });
    }
  }

  handleGetServers(req, res) {
    const servers = Array.from(this.currentServers.values());
    const proxyStatuses = this.proxyManager.getProxyStatuses();

    const serversWithStatus = servers.map(server => {
      const status = proxyStatuses.find(p => p.serverId === server.id);
      return {
        ...server,
        status: status || { healthy: false, port: null }
      };
    });

    res.json(serversWithStatus);
  }

  handleServerHealth(req, res) {
    const serverId = req.params.id;
    const healthStats = this.healthMonitor.getServerHealthStats(serverId);
    
    if (!healthStats) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json(healthStats);
  }

  async handleRestartServer(req, res) {
    const serverId = req.params.id;
    
    if (!this.currentServers.has(serverId)) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const success = await this.proxyManager.restartProxy(serverId);
    res.json({ success, message: success ? 'Server restarted' : 'Failed to restart server' });
  }

  async handleStopServer(req, res) {
    const serverId = req.params.id;
    
    if (!this.currentServers.has(serverId)) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const success = await this.proxyManager.stopProxy(serverId);
    if (success) {
      this.currentServers.delete(serverId);
    }
    
    res.json({ success, message: success ? 'Server stopped' : 'Failed to stop server' });
  }

  async handleStartServer(req, res) {
    const serverId = req.params.id;
    
    const servers = this.configParser.getMCPServers();
    const serverConfig = servers.find(s => s.id === serverId);
    
    if (!serverConfig) {
      return res.status(404).json({ error: 'Server configuration not found' });
    }

    const success = await this.proxyManager.startProxy(serverConfig);
    if (success) {
      this.currentServers.set(serverId, serverConfig);
    }
    
    res.json({ success, message: success ? 'Server started' : 'Failed to start server' });
  }

  async handleGetConfig(req, res) {
    const configStats = await this.configParser.getConfigStats();
    const servers = await this.configParser.getMCPServers();
    
    res.json({
      ...configStats,
      servers: servers
    });
  }

  async handleReloadConfig(req, res) {
    try {
      await this.loadAndStartProxies();
      res.json({ success: true, message: 'Configuration reloaded successfully' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  handleGetOpenAPIEndpoints(req, res) {
    let endpoints = [];

    if (this.modeDetector.isIndividualMode()) {
      // Individual mode: existing logic
      const proxyStatuses = this.proxyManager.getProxyStatuses();
      endpoints = proxyStatuses
        .filter(proxy => proxy.healthy)
        .map(proxy => ({
          name: proxy.serverId,
          url: `http://localhost:${proxy.port}`,
          openapi_url: `http://localhost:${proxy.port}/openapi.json`,
          docs_url: `http://localhost:${proxy.port}/docs`,
          proxyType: proxy.proxyType || 'mcpo'
        }));
    } else {
      // Unified mode: route-based endpoints
      endpoints = this.unifiedProxyManager.getOpenAPIEndpoints();
    }

    res.json({
      mode: this.modeDetector.getMode(),
      endpoints: endpoints,
      count: endpoints.length,
      instructions: {
        openwebui: this.modeDetector.isIndividualMode() 
          ? 'Add these URLs as External OpenAPI servers in OpenWebUI admin panel'
          : 'Add these route-based URLs as External OpenAPI servers in OpenWebUI admin panel',
        format: this.modeDetector.isIndividualMode()
          ? 'Each endpoint provides OpenAPI-compatible REST API for MCP tools'
          : 'Each route provides OpenAPI-compatible REST API for MCP tools via unified MCPO'
      }
    });
  }

  handleGetPorts(req, res) {
    const portStats = this.portManager.getStats();
    const allocatedPorts = this.portManager.getAllocatedPorts();
    
    res.json({
      ...portStats,
      range: {
        start: this.portRangeStart,
        end: this.portRangeEnd
      },
      allocated: allocatedPorts
    });
  }

  handleGetInstallationStats(req, res) {
    const stats = this.proxyManager.getInstallationStats();
    res.json({
      timestamp: new Date(),
      ...stats
    });
  }

  async handleCleanServerCache(req, res) {
    const serverId = req.params.id;
    
    if (!this.currentServers.has(serverId)) {
      return res.status(404).json({ error: 'Server not found' });
    }

    try {
      const success = await this.proxyManager.cleanServerCache(serverId);
      res.json({ 
        success, 
        message: success ? `Cache cleaned for ${serverId}` : `Failed to clean cache for ${serverId}` 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async handleCleanSystemCache(req, res) {
    try {
      const success = await this.proxyManager.installationManager.cleanNpmCache();
      res.json({ 
        success, 
        message: success ? 'System cache cleaned successfully' : 'Failed to clean system cache' 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }



  // Container Environment Management Handlers

  handleGetContainerEnvironment(req, res) {
    try {
      const globalVars = this.containerEnvManager.getGlobalEnvironmentVariables();
      const stats = this.containerEnvManager.getStats();
      
      res.json({
        timestamp: new Date(),
        globalVariables: globalVars,
        stats
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async handleSetContainerEnvironment(req, res) {
    try {
      const { key, value, action } = req.body;
      
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'Environment variable key is required' });
      }

      let success = false;
      let message = '';
      
      if (action === 'unset' || value === null || value === undefined || value === '') {
        // Unset the variable
        success = await this.containerEnvManager.unsetGlobalEnvironmentVariable(key);
        message = success ? `Global environment variable ${key} removed` : `Failed to remove ${key}`;
      } else {
        // Set the variable
        if (typeof value !== 'string') {
          return res.status(400).json({ error: 'Environment variable value must be a string' });
        }
        
        success = await this.containerEnvManager.setGlobalEnvironmentVariable(key, value);
        message = success ? `Global environment variable ${key} set` : `Failed to set ${key}`;
      }
      
      if (success) {
        res.json({ 
          success: true,
          message,
          key,
          action: action === 'unset' || !value ? 'unset' : 'set'
        });
      } else {
        res.status(500).json({ 
          success: false,
          error: message
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async handleSetServerContainerEnvironment(req, res) {
    try {
      const serverId = req.params.serverId;
      
      if (!serverId) {
        return res.status(400).json({ error: 'Server ID is required' });
      }

      const success = await this.containerEnvManager.setServerGlobalEnvironment(serverId);
      
      if (success) {
        res.json({ 
          success: true,
          message: `Global environment variables set for ${serverId}`,
          serverId,
          nextSteps: 'Environment variables are now accessible globally in the container via $VARIABLE_NAME'
        });
      } else {
        res.status(500).json({ 
          success: false,
          error: `Failed to set global environment variables for ${serverId}`
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async handleTestContainerEnvironment(req, res) {
    try {
      const testResult = await this.containerEnvManager.testGlobalEnvironment();
      
      res.json({
        timestamp: new Date(),
        testResult,
        instructions: {
          description: 'Test whether global environment variables are accessible in new shell sessions',
          usage: 'Use this endpoint to verify that container-level environment variables work correctly',
          troubleshooting: testResult.containerEnvironmentWorking 
            ? 'Container environment is working correctly' 
            : 'Container environment may need configuration adjustments'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Utility function to sleep
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after timeout
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Setup graceful shutdown
   */
  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);

      // Stop config watcher
      if (this.configWatcher) {
        this.configWatcher.close();
      }

      if (this.modeDetector.isIndividualMode()) {
        // Individual mode shutdown
        this.healthMonitor.stopMonitoring();
        await this.proxyManager.stopAllProxies();
        this.proxyManager.cleanup();
      } else {
        // Unified mode shutdown
        await this.unifiedProxyManager.stop();
        await this.unifiedProxyManager.cleanup();
      }

      console.log('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }
}

// Start the application
if (require.main === module) {
  const app = new MCPProxyManagerApp();
  app.start().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

module.exports = MCPProxyManagerApp;