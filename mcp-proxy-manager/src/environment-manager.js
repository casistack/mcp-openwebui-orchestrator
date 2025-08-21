const fs = require('fs');
const path = require('path');
const EncryptionManager = require('./encryption-manager');
const secureLogger = require('./secure-logger');

class EnvironmentManager {
  constructor() {
    this.envDirectory = '/home/mcpuser/.mcp-env'; // Use persistent writable directory
    this.encryptionManager = new EncryptionManager();
    this.environmentCache = new Map(); // Cache for frequently accessed vars
    this.cacheTimeout = 300000; // 5 minutes cache timeout
    
    this.initializeEnvironmentDirectory();
    
    // Known API key patterns for different services
    this.apiKeyPatterns = {
      'desktop-commander': {
        required: ['SMITHERY_API_KEY'],
        optional: []
      },
      'youtube': {
        required: ['YOUTUBE_API_KEY'],
        optional: ['YOUTUBE_TRANSCRIPT_LANG']
      },
      'openbb': {
        required: [],
        optional: ['OPENBB_API_KEY', 'OPENBB_PAT'] // Personal Access Token
      },
      'brave-search': {
        required: ['BRAVE_API_KEY'],
        optional: []
      },
      'mcp-server-firecrawl': {
        required: ['FIRE_CRAWL_API_KEY'],
        optional: ['FIRE_CRAWL_API_URL']
      }
    };
  }

  /**
   * Initialize environment directory
   */
  initializeEnvironmentDirectory() {
    try {
      if (!fs.existsSync(this.envDirectory)) {
        fs.mkdirSync(this.envDirectory, { recursive: true, mode: 0o700 });
        console.log(`📁 Created environment directory: ${this.envDirectory}`);
      }
    } catch (error) {
      console.error(`Failed to create environment directory: ${error.message}`);
      // Fallback to temporary directory (tmpfs mount)
      this.envDirectory = '/app/tmp/env';
      try {
        if (!fs.existsSync(this.envDirectory)) {
          fs.mkdirSync(this.envDirectory, { recursive: true });
        }
        console.warn(`Using temporary env directory: ${this.envDirectory}`);
      } catch (fallbackError) {
        console.error(`Failed to create fallback env directory: ${fallbackError.message}`);
        // Use in-memory only (no persistence)
        this.envDirectory = null;
        console.warn(`Environment variables will not persist - using memory only`);
      }
    }
  }

  /**
   * Get environment file path for a server
   * @param {string} serverId - Server ID
   * @returns {string} - Path to env file
   */
  getEnvFilePath(serverId) {
    if (!this.envDirectory) {
      return null; // No persistence - memory only
    }
    return path.join(this.envDirectory, `${serverId}.env.json`);
  }

  /**
   * Load environment variables for a server
   * @param {string} serverId - Server ID
   * @returns {Object} - Environment variables (decrypted)
   */
  loadEnvironmentVariables(serverId) {
    const cacheKey = `env:${serverId}`;
    
    // Check cache first
    if (this.environmentCache.has(cacheKey)) {
      const cached = this.environmentCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      this.environmentCache.delete(cacheKey);
    }

    try {
      const envFilePath = this.getEnvFilePath(serverId);
      
      if (!envFilePath || !fs.existsSync(envFilePath)) {
        return {}; // No env file exists or no persistence available
      }

      const encryptedData = JSON.parse(fs.readFileSync(envFilePath, 'utf8'));
      const decryptedVars = {};

      // Decrypt each variable
      for (const [key, encryptedValue] of Object.entries(encryptedData.variables || {})) {
        try {
          if (this.encryptionManager.isValidEncryptedData(encryptedValue)) {
            decryptedVars[key] = this.encryptionManager.decrypt(encryptedValue);
          } else {
            console.warn(`Invalid encrypted data for ${serverId}.${key}`);
          }
        } catch (error) {
          console.error(`Failed to decrypt ${serverId}.${key}: ${error.message}`);
        }
      }

      // Cache the result
      this.environmentCache.set(cacheKey, {
        data: decryptedVars,
        timestamp: Date.now()
      });

      return decryptedVars;
    } catch (error) {
      console.error(`Failed to load environment for ${serverId}: ${error.message}`);
      return {};
    }
  }

  /**
   * Save environment variables for a server
   * @param {string} serverId - Server ID
   * @param {Object} variables - Environment variables to save
   * @returns {Promise<boolean>} - Success status
   */
  async saveEnvironmentVariables(serverId, variables) {
    try {
      const envFilePath = this.getEnvFilePath(serverId);
      
      // If no persistence available, only cache in memory
      if (!envFilePath) {
        // Store in memory cache only
        const cacheKey = `env:${serverId}`;
        this.environmentCache.set(cacheKey, {
          data: variables,
          timestamp: Date.now()
        });
        secureLogger.log(`💾 Cached ${Object.keys(variables).length} environment variables for ${serverId} (memory only)`);
        return true;
      }
      
      const encryptedVars = {};

      // Encrypt each variable
      for (const [key, value] of Object.entries(variables)) {
        if (value && typeof value === 'string') {
          encryptedVars[key] = this.encryptionManager.encrypt(value);
        }
      }

      // Prepare file structure
      const envFileData = {
        serverId,
        lastUpdated: new Date().toISOString(),
        variables: encryptedVars,
        metadata: {
          version: '1.0',
          keyCount: Object.keys(encryptedVars).length
        }
      };

      // Write to file atomically
      const tempPath = `${envFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(envFileData, null, 2), { mode: 0o600 });
      fs.renameSync(tempPath, envFilePath);

      // Clear cache for this server
      this.environmentCache.delete(`env:${serverId}`);

      secureLogger.log(`💾 Saved ${Object.keys(variables).length} environment variables for ${serverId}`);
      return true;
    } catch (error) {
      console.error(`Failed to save environment for ${serverId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get environment variable summary (masked values for API)
   * @param {string} serverId - Server ID
   * @returns {Object} - Environment summary
   */
  getEnvironmentSummary(serverId) {
    try {
      const envFilePath = this.getEnvFilePath(serverId);
      
      if (!fs.existsSync(envFilePath)) {
        return {
          exists: false,
          variables: {},
          lastUpdated: null,
          requiredKeys: this.getRequiredKeysForServer(serverId),
          optionalKeys: this.getOptionalKeysForServer(serverId)
        };
      }

      const encryptedData = JSON.parse(fs.readFileSync(envFilePath, 'utf8'));
      const variableSummary = {};

      // Create masked summary
      for (const key of Object.keys(encryptedData.variables || {})) {
        variableSummary[key] = {
          set: true,
          masked: this.maskValue(key),
          type: this.inferVariableType(key),
          required: this.isRequiredKey(serverId, key)
        };
      }

      return {
        exists: true,
        variables: variableSummary,
        lastUpdated: encryptedData.lastUpdated,
        keyCount: encryptedData.metadata?.keyCount || 0,
        requiredKeys: this.getRequiredKeysForServer(serverId),
        optionalKeys: this.getOptionalKeysForServer(serverId)
      };
    } catch (error) {
      console.error(`Failed to get environment summary for ${serverId}: ${error.message}`);
      return {
        exists: false,
        variables: {},
        lastUpdated: null,
        error: error.message
      };
    }
  }

  /**
   * Delete environment variables for a server
   * @param {string} serverId - Server ID
   * @returns {boolean} - Success status
   */
  deleteEnvironmentVariables(serverId) {
    try {
      const envFilePath = this.getEnvFilePath(serverId);
      
      if (fs.existsSync(envFilePath)) {
        fs.unlinkSync(envFilePath);
        this.environmentCache.delete(`env:${serverId}`);
        console.log(`Deleted environment variables for ${serverId}`);
        return true;
      }
      
      return true; // Already doesn't exist
    } catch (error) {
      console.error(`Failed to delete environment for ${serverId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Update server configuration to use environment file
   * @param {Object} serverConfig - Server configuration
   * @returns {Object} - Updated configuration
   */
  updateServerConfigWithEnvFile(serverConfig) {
    const envFilePath = this.getEnvFilePath(serverConfig.id);
    
    if (fs.existsSync(envFilePath)) {
      // Add envFile reference to config
      return {
        ...serverConfig,
        envFile: envFilePath,
        env: {
          ...serverConfig.env,
          // Load and merge environment variables
          ...this.loadEnvironmentVariables(serverConfig.id)
        }
      };
    }
    
    return serverConfig;
  }

  /**
   * Get required API keys for a server
   * @param {string} serverId - Server ID
   * @returns {Array} - Required keys
   */
  getRequiredKeysForServer(serverId) {
    return this.apiKeyPatterns[serverId]?.required || [];
  }

  /**
   * Get optional API keys for a server
   * @param {string} serverId - Server ID
   * @returns {Array} - Optional keys
   */
  getOptionalKeysForServer(serverId) {
    return this.apiKeyPatterns[serverId]?.optional || [];
  }

  /**
   * Check if a key is required for a server
   * @param {string} serverId - Server ID
   * @param {string} key - Environment variable key
   * @returns {boolean} - True if required
   */
  isRequiredKey(serverId, key) {
    return this.getRequiredKeysForServer(serverId).includes(key);
  }

  /**
   * Mask a value for display
   * @param {string} key - Variable key
   * @returns {string} - Masked value
   */
  maskValue(key) {
    if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
      return '••••••••••••••••';
    }
    return '••••••••';
  }

  /**
   * Infer variable type from key name
   * @param {string} key - Variable key
   * @returns {string} - Inferred type
   */
  inferVariableType(key) {
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('key')) return 'api_key';
    if (lowerKey.includes('token')) return 'token';
    if (lowerKey.includes('password')) return 'password';
    if (lowerKey.includes('secret')) return 'secret';
    if (lowerKey.includes('url')) return 'url';
    
    return 'string';
  }

  /**
   * Get all servers with environment files
   * @returns {Array} - Server IDs with env files
   */
  getServersWithEnvironmentFiles() {
    try {
      if (!fs.existsSync(this.envDirectory)) {
        return [];
      }

      return fs.readdirSync(this.envDirectory)
        .filter(file => file.endsWith('.env.json'))
        .map(file => file.replace('.env.json', ''));
    } catch (error) {
      console.error(`Failed to list environment files: ${error.message}`);
      return [];
    }
  }

  /**
   * Get environment management statistics
   * @returns {Object} - Statistics
   */
  getStats() {
    const serversWithEnv = this.getServersWithEnvironmentFiles();
    
    return {
      envDirectory: this.envDirectory,
      totalServers: serversWithEnv.length,
      servers: serversWithEnv,
      cacheSize: this.environmentCache.size,
      encryptionStats: this.encryptionManager.getStats()
    };
  }

  /**
   * Clear environment cache
   */
  clearCache() {
    this.environmentCache.clear();
    console.log('🧹 Cleared environment variable cache');
  }
}

module.exports = EnvironmentManager;