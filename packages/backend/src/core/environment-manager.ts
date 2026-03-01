import fs from 'fs';
import path from 'path';
import { EncryptionManager } from './encryption-manager.js';
import { secureLogger } from './secure-logger.js';

interface CacheEntry {
  data: Record<string, string>;
  timestamp: number;
}

interface ApiKeyPattern {
  required: string[];
  optional: string[];
}

interface EnvironmentSummary {
  exists: boolean;
  variables: Record<string, { set: boolean; masked: string; type: string; required: boolean }>;
  lastUpdated: string | null;
  keyCount?: number;
  requiredKeys: string[];
  optionalKeys: string[];
  error?: string;
}

interface EnvironmentStats {
  envDirectory: string | null;
  totalServers: number;
  servers: string[];
  cacheSize: number;
  encryptionStats: ReturnType<EncryptionManager['getStats']>;
}

const DEFAULT_ENV_DIR = '/home/mcpuser/.mcp-env';
const CACHE_TIMEOUT_MS = 300_000; // 5 minutes

export class EnvironmentManager {
  private envDirectory: string | null;
  private readonly encryptionManager: EncryptionManager;
  private readonly environmentCache: Map<string, CacheEntry>;
  private readonly cacheTimeout: number;
  private readonly apiKeyPatterns: Record<string, ApiKeyPattern>;

  constructor(envDirectory = DEFAULT_ENV_DIR) {
    this.envDirectory = envDirectory;
    this.encryptionManager = new EncryptionManager();
    this.environmentCache = new Map();
    this.cacheTimeout = CACHE_TIMEOUT_MS;

    this.initializeEnvironmentDirectory();

    this.apiKeyPatterns = {
      'desktop-commander': { required: ['SMITHERY_API_KEY'], optional: [] },
      'youtube': { required: ['YOUTUBE_API_KEY'], optional: ['YOUTUBE_TRANSCRIPT_LANG'] },
      'openbb': { required: [], optional: ['OPENBB_API_KEY', 'OPENBB_PAT'] },
      'brave-search': { required: ['BRAVE_API_KEY'], optional: [] },
      'mcp-server-firecrawl': { required: ['FIRE_CRAWL_API_KEY'], optional: ['FIRE_CRAWL_API_URL'] },
    };
  }

  private initializeEnvironmentDirectory(): void {
    try {
      if (this.envDirectory && !fs.existsSync(this.envDirectory)) {
        fs.mkdirSync(this.envDirectory, { recursive: true, mode: 0o700 });
        console.log(`Created environment directory: ${this.envDirectory}`);
      }
    } catch (error) {
      console.error(`Failed to create environment directory: ${(error as Error).message}`);
      this.envDirectory = '/app/tmp/env';
      try {
        if (!fs.existsSync(this.envDirectory)) {
          fs.mkdirSync(this.envDirectory, { recursive: true });
        }
        console.warn(`Using temporary env directory: ${this.envDirectory}`);
      } catch {
        console.error('Failed to create fallback env directory');
        this.envDirectory = null;
        console.warn('Environment variables will not persist - using memory only');
      }
    }
  }

  getEnvFilePath(serverId: string): string | null {
    if (!this.envDirectory) {
      return null;
    }
    return path.join(this.envDirectory, `${serverId}.env.json`);
  }

  loadEnvironmentVariables(serverId: string): Record<string, string> {
    const cacheKey = `env:${serverId}`;

    if (this.environmentCache.has(cacheKey)) {
      const cached = this.environmentCache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
      this.environmentCache.delete(cacheKey);
    }

    try {
      const envFilePath = this.getEnvFilePath(serverId);

      if (!envFilePath || !fs.existsSync(envFilePath)) {
        return {};
      }

      const encryptedData = JSON.parse(fs.readFileSync(envFilePath, 'utf8'));
      const decryptedVars: Record<string, string> = {};

      for (const [key, encryptedValue] of Object.entries(encryptedData.variables || {})) {
        try {
          if (this.encryptionManager.isValidEncryptedData(encryptedValue)) {
            decryptedVars[key] = this.encryptionManager.decrypt(encryptedValue);
          } else {
            console.warn(`Invalid encrypted data for ${serverId}.${key}`);
          }
        } catch (error) {
          console.error(`Failed to decrypt ${serverId}.${key}: ${(error as Error).message}`);
        }
      }

      this.environmentCache.set(cacheKey, { data: decryptedVars, timestamp: Date.now() });
      return decryptedVars;
    } catch (error) {
      console.error(`Failed to load environment for ${serverId}: ${(error as Error).message}`);
      return {};
    }
  }

  async saveEnvironmentVariables(serverId: string, variables: Record<string, string>): Promise<boolean> {
    try {
      const envFilePath = this.getEnvFilePath(serverId);

      if (!envFilePath) {
        const cacheKey = `env:${serverId}`;
        this.environmentCache.set(cacheKey, { data: variables, timestamp: Date.now() });
        secureLogger.log(`Cached ${Object.keys(variables).length} environment variables for ${serverId} (memory only)`);
        return true;
      }

      const encryptedVars: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(variables)) {
        if (value && typeof value === 'string') {
          encryptedVars[key] = this.encryptionManager.encrypt(value);
        }
      }

      const envFileData = {
        serverId,
        lastUpdated: new Date().toISOString(),
        variables: encryptedVars,
        metadata: {
          version: '1.0',
          keyCount: Object.keys(encryptedVars).length,
        },
      };

      const tempPath = `${envFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(envFileData, null, 2), { mode: 0o600 });
      fs.renameSync(tempPath, envFilePath);

      this.environmentCache.delete(`env:${serverId}`);
      secureLogger.log(`Saved ${Object.keys(variables).length} environment variables for ${serverId}`);
      return true;
    } catch (error) {
      console.error(`Failed to save environment for ${serverId}: ${(error as Error).message}`);
      return false;
    }
  }

  getEnvironmentSummary(serverId: string): EnvironmentSummary {
    try {
      const envFilePath = this.getEnvFilePath(serverId);

      if (!envFilePath || !fs.existsSync(envFilePath)) {
        return {
          exists: false,
          variables: {},
          lastUpdated: null,
          requiredKeys: this.getRequiredKeysForServer(serverId),
          optionalKeys: this.getOptionalKeysForServer(serverId),
        };
      }

      const encryptedData = JSON.parse(fs.readFileSync(envFilePath, 'utf8'));
      const variableSummary: EnvironmentSummary['variables'] = {};

      for (const key of Object.keys(encryptedData.variables || {})) {
        variableSummary[key] = {
          set: true,
          masked: this.maskValue(key),
          type: this.inferVariableType(key),
          required: this.isRequiredKey(serverId, key),
        };
      }

      return {
        exists: true,
        variables: variableSummary,
        lastUpdated: encryptedData.lastUpdated,
        keyCount: encryptedData.metadata?.keyCount || 0,
        requiredKeys: this.getRequiredKeysForServer(serverId),
        optionalKeys: this.getOptionalKeysForServer(serverId),
      };
    } catch (error) {
      console.error(`Failed to get environment summary for ${serverId}: ${(error as Error).message}`);
      return {
        exists: false,
        variables: {},
        lastUpdated: null,
        error: (error as Error).message,
        requiredKeys: [],
        optionalKeys: [],
      };
    }
  }

  deleteEnvironmentVariables(serverId: string): boolean {
    try {
      const envFilePath = this.getEnvFilePath(serverId);

      if (envFilePath && fs.existsSync(envFilePath)) {
        fs.unlinkSync(envFilePath);
        this.environmentCache.delete(`env:${serverId}`);
        console.log(`Deleted environment variables for ${serverId}`);
        return true;
      }

      return true;
    } catch (error) {
      console.error(`Failed to delete environment for ${serverId}: ${(error as Error).message}`);
      return false;
    }
  }

  updateServerConfigWithEnvFile(serverConfig: { id: string; env?: Record<string, string>; [key: string]: unknown }): typeof serverConfig & { envFile?: string } {
    const envFilePath = this.getEnvFilePath(serverConfig.id);

    if (envFilePath && fs.existsSync(envFilePath)) {
      return {
        ...serverConfig,
        envFile: envFilePath,
        env: {
          ...serverConfig.env,
          ...this.loadEnvironmentVariables(serverConfig.id),
        },
      };
    }

    return serverConfig;
  }

  getRequiredKeysForServer(serverId: string): string[] {
    return this.apiKeyPatterns[serverId]?.required || [];
  }

  getOptionalKeysForServer(serverId: string): string[] {
    return this.apiKeyPatterns[serverId]?.optional || [];
  }

  isRequiredKey(serverId: string, key: string): boolean {
    return this.getRequiredKeysForServer(serverId).includes(key);
  }

  maskValue(key: string): string {
    if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
      return '\u2022'.repeat(16);
    }
    return '\u2022'.repeat(8);
  }

  inferVariableType(key: string): string {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('key')) return 'api_key';
    if (lowerKey.includes('token')) return 'token';
    if (lowerKey.includes('password')) return 'password';
    if (lowerKey.includes('secret')) return 'secret';
    if (lowerKey.includes('url')) return 'url';

    return 'string';
  }

  getServersWithEnvironmentFiles(): string[] {
    try {
      if (!this.envDirectory || !fs.existsSync(this.envDirectory)) {
        return [];
      }

      return fs.readdirSync(this.envDirectory)
        .filter(file => file.endsWith('.env.json'))
        .map(file => file.replace('.env.json', ''));
    } catch (error) {
      console.error(`Failed to list environment files: ${(error as Error).message}`);
      return [];
    }
  }

  getStats(): EnvironmentStats {
    const serversWithEnv = this.getServersWithEnvironmentFiles();

    return {
      envDirectory: this.envDirectory,
      totalServers: serversWithEnv.length,
      servers: serversWithEnv,
      cacheSize: this.environmentCache.size,
      encryptionStats: this.encryptionManager.getStats(),
    };
  }

  clearCache(): void {
    this.environmentCache.clear();
    console.log('Cleared environment variable cache');
  }
}
