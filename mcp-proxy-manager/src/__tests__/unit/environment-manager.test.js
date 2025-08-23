/**
 * Unit tests for EnvironmentManager class
 */
const fs = require('fs');
const path = require('path');
const EnvironmentManager = require('../../environment-manager');

// Mock dependencies
jest.mock('fs');
jest.mock('../../encryption-manager');
jest.mock('../../secure-logger');

const EncryptionManager = require('../../encryption-manager');
const secureLogger = require('../../secure-logger');

describe('EnvironmentManager', () => {
  let envManager;
  let consoleSpy;
  let mockEncryptionManager;

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Reset all mocks
    jest.clearAllMocks();

    // Mock file system operations
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{"variables": {}}');
    fs.renameSync.mockReturnValue(undefined);
    fs.unlinkSync.mockReturnValue(undefined);
    fs.readdirSync.mockReturnValue([]);

    // Mock encryption manager
    mockEncryptionManager = {
      encrypt: jest.fn().mockReturnValue('encrypted-value'),
      decrypt: jest.fn().mockReturnValue('decrypted-value'),
      isValidEncryptedData: jest.fn().mockReturnValue(true),
      getStats: jest.fn().mockReturnValue({ operations: 10 })
    };
    EncryptionManager.mockImplementation(() => mockEncryptionManager);

    // Mock secure logger
    secureLogger.log.mockImplementation(() => {});

    // Create environment manager
    envManager = new EnvironmentManager();
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with default directory path', () => {
      expect(envManager.envDirectory).toBe('/home/mcpuser/.mcp-env');
      expect(envManager.encryptionManager).toBeDefined();
      expect(envManager.environmentCache).toBeInstanceOf(Map);
      expect(envManager.cacheTimeout).toBe(300000);
    });

    test('should have predefined API key patterns', () => {
      expect(envManager.apiKeyPatterns).toHaveProperty('brave-search');
      expect(envManager.apiKeyPatterns).toHaveProperty('mcp-server-firecrawl');
      expect(envManager.apiKeyPatterns).toHaveProperty('youtube');
      expect(envManager.apiKeyPatterns['brave-search'].required).toContain('BRAVE_API_KEY');
    });
  });

  describe('initializeEnvironmentDirectory', () => {
    test('should create directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const newEnvManager = new EnvironmentManager();
      
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/home/mcpuser/.mcp-env',
        { recursive: true, mode: 0o700 }
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        'Created environment directory: /home/mcpuser/.mcp-env'
      );
    });

    test('should use fallback directory on creation failure', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementationOnce(() => {
        throw new Error('Permission denied');
      }).mockImplementationOnce(() => {}); // Second call succeeds for fallback
      
      const newEnvManager = new EnvironmentManager();
      
      expect(newEnvManager.envDirectory).toBe('/app/tmp/env');
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to create environment directory: Permission denied'
      );
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        'Using temporary env directory: /app/tmp/env'
      );
    });

    test('should set directory to null if all creation attempts fail', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Cannot create directory');
      });
      
      const newEnvManager = new EnvironmentManager();
      
      expect(newEnvManager.envDirectory).toBe(null);
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        'Environment variables will not persist - using memory only'
      );
    });
  });

  describe('getEnvFilePath', () => {
    test('should return correct file path for server', () => {
      const filePath = envManager.getEnvFilePath('test-server');
      
      expect(filePath).toBe('/home/mcpuser/.mcp-env/test-server.env.json');
    });

    test('should return null when no environment directory is available', () => {
      envManager.envDirectory = null;
      
      const filePath = envManager.getEnvFilePath('test-server');
      
      expect(filePath).toBe(null);
    });
  });

  describe('loadEnvironmentVariables', () => {
    test('should return empty object if no env file exists', () => {
      fs.existsSync.mockReturnValue(false);
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual({});
    });

    test('should return cached variables if cache is valid', () => {
      const cachedData = { API_KEY: 'cached-value' };
      envManager.environmentCache.set('env:test-server', {
        data: cachedData,
        timestamp: Date.now()
      });
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual(cachedData);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    test('should load and decrypt variables from file', () => {
      const mockFileData = {
        variables: {
          API_KEY: 'encrypted-api-key',
          TOKEN: 'encrypted-token'
        }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(mockFileData));
      mockEncryptionManager.decrypt.mockReturnValueOnce('decrypted-api-key')
                                   .mockReturnValueOnce('decrypted-token');
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual({
        API_KEY: 'decrypted-api-key',
        TOKEN: 'decrypted-token'
      });
      expect(mockEncryptionManager.decrypt).toHaveBeenCalledTimes(2);
    });

    test('should handle invalid encrypted data gracefully', () => {
      const mockFileData = {
        variables: {
          VALID_KEY: 'valid-encrypted-data',
          INVALID_KEY: 'invalid-encrypted-data'
        }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(mockFileData));
      mockEncryptionManager.isValidEncryptedData.mockReturnValueOnce(true)
                                                .mockReturnValueOnce(false);
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual({
        VALID_KEY: 'decrypted-value'
      });
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        'Invalid encrypted data for test-server.INVALID_KEY'
      );
    });

    test('should handle decryption errors gracefully', () => {
      const mockFileData = {
        variables: {
          API_KEY: 'encrypted-data'
        }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(mockFileData));
      mockEncryptionManager.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed');
      });
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual({});
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to decrypt test-server.API_KEY: Decryption failed'
      );
    });

    test('should handle file reading errors', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });
      
      const vars = envManager.loadEnvironmentVariables('test-server');
      
      expect(vars).toEqual({});
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to load environment for test-server: File read error'
      );
    });
  });

  describe('saveEnvironmentVariables', () => {
    test('should save variables to memory only when no persistence available', async () => {
      envManager.envDirectory = null;
      const variables = { API_KEY: 'test-key' };
      
      const result = await envManager.saveEnvironmentVariables('test-server', variables);
      
      expect(result).toBe(true);
      expect(envManager.environmentCache.has('env:test-server')).toBe(true);
      expect(secureLogger.log).toHaveBeenCalledWith(
        '💾 Cached 1 environment variables for test-server (memory only)'
      );
    });

    test('should encrypt and save variables to file', async () => {
      const variables = { API_KEY: 'test-key', TOKEN: 'test-token' };
      mockEncryptionManager.encrypt.mockReturnValueOnce('encrypted-key')
                                   .mockReturnValueOnce('encrypted-token');
      
      const result = await envManager.saveEnvironmentVariables('test-server', variables);
      
      expect(result).toBe(true);
      expect(mockEncryptionManager.encrypt).toHaveBeenCalledWith('test-key');
      expect(mockEncryptionManager.encrypt).toHaveBeenCalledWith('test-token');
      
      // Verify file write
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/home/mcpuser/.mcp-env/test-server.env.json.tmp',
        expect.stringContaining('encrypted-key'),
        { mode: 0o600 }
      );
      expect(fs.renameSync).toHaveBeenCalled();
      expect(secureLogger.log).toHaveBeenCalledWith(
        '💾 Saved 2 environment variables for test-server'
      );
    });

    test('should skip non-string values during encryption', async () => {
      const variables = { 
        API_KEY: 'string-value',
        NUMBER: 123,
        BOOLEAN: true,
        NULL_VALUE: null,
        EMPTY_STRING: ''
      };
      
      const result = await envManager.saveEnvironmentVariables('test-server', variables);
      
      expect(result).toBe(true);
      expect(mockEncryptionManager.encrypt).toHaveBeenCalledTimes(1);
      expect(mockEncryptionManager.encrypt).toHaveBeenCalledWith('string-value');
    });

    test('should handle save errors gracefully', async () => {
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });
      
      const result = await envManager.saveEnvironmentVariables('test-server', {});
      
      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to save environment for test-server: Write error'
      );
    });
  });

  describe('getEnvironmentSummary', () => {
    test('should return summary for non-existent file', () => {
      fs.existsSync.mockReturnValue(false);
      
      const summary = envManager.getEnvironmentSummary('brave-search');
      
      expect(summary).toEqual({
        exists: false,
        variables: {},
        lastUpdated: null,
        requiredKeys: ['BRAVE_API_KEY'],
        optionalKeys: []
      });
    });

    test('should return masked summary for existing file', () => {
      const mockFileData = {
        variables: {
          BRAVE_API_KEY: 'encrypted-key',
          TOKEN: 'encrypted-token'
        },
        lastUpdated: '2024-01-01T00:00:00.000Z',
        metadata: { keyCount: 2 }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(mockFileData));
      
      const summary = envManager.getEnvironmentSummary('brave-search');
      
      expect(summary.exists).toBe(true);
      expect(summary.variables.BRAVE_API_KEY).toEqual({
        set: true,
        masked: '••••••••••••••••',
        type: 'api_key',
        required: true
      });
      expect(summary.variables.TOKEN).toEqual({
        set: true,
        masked: '••••••••••••••••',
        type: 'token',
        required: false
      });
      expect(summary.lastUpdated).toBe('2024-01-01T00:00:00.000Z');
      expect(summary.keyCount).toBe(2);
    });

    test('should handle file reading errors in summary', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });
      
      const summary = envManager.getEnvironmentSummary('test-server');
      
      expect(summary).toEqual({
        exists: false,
        variables: {},
        lastUpdated: null,
        error: 'Read error'
      });
    });
  });

  describe('deleteEnvironmentVariables', () => {
    test('should delete existing file and clear cache', () => {
      const result = envManager.deleteEnvironmentVariables('test-server');
      
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/home/mcpuser/.mcp-env/test-server.env.json');
      expect(consoleSpy.log).toHaveBeenCalledWith('Deleted environment variables for test-server');
    });

    test('should return true for non-existent file', () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = envManager.deleteEnvironmentVariables('test-server');
      
      expect(result).toBe(true);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    test('should handle deletion errors', () => {
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Delete error');
      });
      
      const result = envManager.deleteEnvironmentVariables('test-server');
      
      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to delete environment for test-server: Delete error'
      );
    });
  });

  describe('updateServerConfigWithEnvFile', () => {
    test('should update config with environment variables', () => {
      const serverConfig = {
        id: 'test-server',
        command: 'npx',
        env: { EXISTING: 'value' }
      };
      
      jest.spyOn(envManager, 'loadEnvironmentVariables')
          .mockReturnValue({ API_KEY: 'loaded-key' });
      
      const updated = envManager.updateServerConfigWithEnvFile(serverConfig);
      
      expect(updated).toEqual({
        id: 'test-server',
        command: 'npx',
        envFile: '/home/mcpuser/.mcp-env/test-server.env.json',
        env: {
          EXISTING: 'value',
          API_KEY: 'loaded-key'
        }
      });
    });

    test('should return original config if no env file exists', () => {
      fs.existsSync.mockReturnValue(false);
      const serverConfig = { id: 'test-server', command: 'npx' };
      
      const updated = envManager.updateServerConfigWithEnvFile(serverConfig);
      
      expect(updated).toBe(serverConfig);
    });
  });

  describe('helper methods', () => {
    test('getRequiredKeysForServer should return required keys', () => {
      const required = envManager.getRequiredKeysForServer('brave-search');
      expect(required).toEqual(['BRAVE_API_KEY']);
      
      const unknownRequired = envManager.getRequiredKeysForServer('unknown-server');
      expect(unknownRequired).toEqual([]);
    });

    test('getOptionalKeysForServer should return optional keys', () => {
      const optional = envManager.getOptionalKeysForServer('openbb');
      expect(optional).toEqual(['OPENBB_API_KEY', 'OPENBB_PAT']);
    });

    test('isRequiredKey should check if key is required', () => {
      expect(envManager.isRequiredKey('brave-search', 'BRAVE_API_KEY')).toBe(true);
      expect(envManager.isRequiredKey('brave-search', 'OPTIONAL_KEY')).toBe(false);
    });

    test('maskValue should mask sensitive values appropriately', () => {
      expect(envManager.maskValue('API_KEY')).toBe('••••••••••••••••');
      expect(envManager.maskValue('TOKEN')).toBe('••••••••••••••••');
      expect(envManager.maskValue('REGULAR_VAR')).toBe('••••••••');
    });

    test('inferVariableType should infer correct types', () => {
      expect(envManager.inferVariableType('API_KEY')).toBe('api_key');
      expect(envManager.inferVariableType('ACCESS_TOKEN')).toBe('token');
      expect(envManager.inferVariableType('PASSWORD')).toBe('password');
      expect(envManager.inferVariableType('SECRET_KEY')).toBe('api_key'); // 'key' takes precedence over 'secret'
      expect(envManager.inferVariableType('SECRET_VALUE')).toBe('secret'); // Only 'secret' without 'key'
      expect(envManager.inferVariableType('BASE_URL')).toBe('url');
      expect(envManager.inferVariableType('REGULAR_VAR')).toBe('string');
    });
  });

  describe('getServersWithEnvironmentFiles', () => {
    test('should return list of servers with env files', () => {
      fs.readdirSync.mockReturnValue([
        'server1.env.json',
        'server2.env.json',
        'other-file.txt'
      ]);
      
      const servers = envManager.getServersWithEnvironmentFiles();
      
      expect(servers).toEqual(['server1', 'server2']);
    });

    test('should return empty array if directory does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const servers = envManager.getServersWithEnvironmentFiles();
      
      expect(servers).toEqual([]);
    });

    test('should handle read directory errors', () => {
      fs.readdirSync.mockImplementation(() => {
        throw new Error('Read directory error');
      });
      
      const servers = envManager.getServersWithEnvironmentFiles();
      
      expect(servers).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Failed to list environment files: Read directory error'
      );
    });
  });

  describe('getStats', () => {
    test('should return comprehensive statistics', () => {
      jest.spyOn(envManager, 'getServersWithEnvironmentFiles')
          .mockReturnValue(['server1', 'server2']);
      envManager.environmentCache.set('cache-key', 'cache-value');
      
      const stats = envManager.getStats();
      
      expect(stats).toEqual({
        envDirectory: '/home/mcpuser/.mcp-env',
        totalServers: 2,
        servers: ['server1', 'server2'],
        cacheSize: 1,
        encryptionStats: { operations: 10 }
      });
    });
  });

  describe('clearCache', () => {
    test('should clear environment cache', () => {
      envManager.environmentCache.set('test-key', 'test-value');
      
      envManager.clearCache();
      
      expect(envManager.environmentCache.size).toBe(0);
      expect(consoleSpy.log).toHaveBeenCalledWith('🧹 Cleared environment variable cache');
    });
  });
});