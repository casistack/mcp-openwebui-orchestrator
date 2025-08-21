const fs = require("fs");
const path = require("path");
const ConfigValidator = require('./config-validator');
const { Logger, MCPError, ErrorCodes } = require('./error-handler');

class ConfigParser {
  constructor(configPath = "/config/claude_desktop_config.json") {
    this.configPath = configPath;
    this.lastModified = null;
    this.parsedConfig = null;
  }

  async loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        Logger.error(`Config file not found: ${this.configPath}`);
        return null;
      }

      const stats = await fs.promises.stat(this.configPath);

      // Only parse if file has been modified
      if (this.lastModified && stats.mtime.getTime() === this.lastModified) {
        return this.parsedConfig;
      }

      const configContent = await fs.promises.readFile(this.configPath, "utf8");
      const config = JSON.parse(configContent);
      
      // Validate configuration structure
      ConfigValidator.validateClaudeConfig(config);
      
      this.parsedConfig = config;
      this.lastModified = stats.mtime.getTime();

      Logger.success(`Configuration loaded and validated: ${this.configPath}`);
      return this.parsedConfig;
    } catch (error) {
      Logger.error(`Config loading failed: ${error.message}`, error);
      return null;
    }
  }

  async getMCPServers() {
    const config = await this.loadConfig();
    if (!config || !config.mcpServers) {
      return [];
    }

    const servers = [];

    for (const [serverName, serverConfig] of Object.entries(
      config.mcpServers
    )) {
      const mcpServer = this.parseMCPServer(serverName, serverConfig);
      if (mcpServer) {
        servers.push(mcpServer);
      }
    }

    return servers;
  }

  parseMCPServer(name, config) {
    try {
      // Handle SSE transport (can be proxied for OpenWebUI compatibility)
      if (config.transport === "sse" && config.url) {
        return {
          id: name,
          name: name,
          type: "sse",
          url: config.url,
          headers: config.headers || {},
          transport: "sse",
          needsProxy: true, // Enable proxying for OpenWebUI compatibility
        };
      }

      // Handle streamable-http transport (MCP spec 2025-03-26)
      if (config.transport === "streamable-http" && config.url) {
        return {
          id: name,
          name: name,
          type: "streamable-http",
          url: config.url,
          headers: config.headers || {},
          transport: "streamable-http",
          needsProxy: true, // Enable proxying for OpenWebUI compatibility
        };
      }

      // Handle stdio transport (needs proxy)
      if (config.command) {
        const serverConfig = {
          id: name,
          name: name,
          type: "stdio",
          command: config.command,
          args: config.args || [],
          env: config.env || {},
          envFile: config.envFile,
          cwd: config.cwd,
          transport: "stdio",
          needsProxy: config.needsProxy !== false, // Allow user to override with needsProxy: false
          alwaysAllow: config.alwaysAllow || [],
        };

        // Only set proxyType if explicitly provided by user config.
        // Default proxyType comes from the ProxyManager, not here.
        if (Object.prototype.hasOwnProperty.call(config, "proxyType")) {
          serverConfig.proxyType = config.proxyType;
        }

        // Validate command
        if (!this.isValidCommand(serverConfig)) {
          console.warn(`Skipping invalid server config: ${name}`);
          return null;
        }

        return serverConfig;
      }

      console.warn(`Unknown server configuration format for: ${name}`);
      return null;
    } catch (error) {
      console.error(`Error parsing server ${name}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate server command configuration
   * @param {Object} serverConfig - Server configuration
   * @returns {boolean} - True if valid
   */
  isValidCommand(serverConfig) {
    if (!serverConfig.command) {
      return false;
    }

    // Check for common command types
    const validCommands = ["npx", "uvx", "uv", "python", "node", "docker"];
    const isValidCommand = validCommands.some(
      (cmd) =>
        serverConfig.command.includes(cmd) || serverConfig.command === cmd
    );

    if (!isValidCommand) {
      console.warn(`Potentially unsupported command: ${serverConfig.command}`);
    }

    return true;
  }

  /**
   * Get configuration file stats
   * @returns {Object} - File stats
   */
  async getConfigStats() {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { exists: false };
      }

      const stats = await fs.promises.stat(this.configPath);
      const servers = await this.getMCPServers();

      return {
        exists: true,
        path: this.configPath,
        size: stats.size,
        modified: stats.mtime,
        serverCount: servers.length,
        stdioServers: servers.filter((s) => s.type === "stdio").length,
        sseServers: servers.filter((s) => s.type === "sse").length,
        streamableHttpServers: servers.filter((s) => s.type === "streamable-http").length,
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }

  /**
   * Watch configuration file for changes
   * @param {Function} callback - Callback function on change
   * @returns {Object} - File watcher instance
   */
  watchConfig(callback) {
    if (!fs.existsSync(this.configPath)) {
      console.error(
        `Cannot watch non-existent config file: ${this.configPath}`
      );
      return null;
    }

    const watcher = fs.watchFile(
      this.configPath,
      { interval: 1000 },
      (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log("Configuration file changed, reloading...");
          callback(this.getMCPServers());
        }
      }
    );

    console.log(`Watching config file: ${this.configPath}`);
    return watcher;
  }

  /**
   * Generate example configuration
   * @returns {Object} - Example configuration
   */
  generateExampleConfig() {
    return {
      mcpServers: {
        memory: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
        },
        filesystem: {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "/path/to/files",
          ],
        },
        "brave-search": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-brave-search"],
          env: {
            BRAVE_API_KEY: "your-api-key",
          },
        },
        "hosted-sse-server": {
          transport: "sse",
          url: "https://your-sse-server.com/sse",
        },
        "hosted-streamable-http-server": {
          transport: "streamable-http",
          url: "https://your-streamable-http-server.com/mcp",
        },
        "server-with-supergateway": {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "/path/to/files",
          ],
          proxyType: "supergateway",
        },
      },
    };
  }
}

module.exports = ConfigParser;
