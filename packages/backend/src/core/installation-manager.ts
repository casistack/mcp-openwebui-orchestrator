import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PackageInfo {
  name: string;
  command: string;
  args: string[];
}

interface QueueItem {
  serverId: string;
  packageInfo: PackageInfo;
  resolve: (value: boolean) => void;
}

export interface MemoryStats {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

interface CacheValidationEntry {
  isCorrupted: boolean;
  timestamp: number;
}

const MEMORY_THRESHOLD_MB = 800;
const MAX_CONCURRENT_INSTALLS = 2;
const CACHE_VALIDATION_TTL_MS = 300_000;

export class InstallationManager {
  private readonly installing: Set<string>;
  private readonly installQueue: QueueItem[];
  private readonly maxConcurrentInstalls: number;
  private readonly memoryThresholdMB: number;
  private readonly cacheValidationCache: Map<string, CacheValidationEntry>;

  constructor() {
    this.installing = new Set();
    this.installQueue = [];
    this.maxConcurrentInstalls = MAX_CONCURRENT_INSTALLS;
    this.memoryThresholdMB = MEMORY_THRESHOLD_MB;
    this.cacheValidationCache = new Map();
  }

  getMemoryStats(): MemoryStats {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
    };
  }

  isSafeToInstall(): boolean {
    const memStats = this.getMemoryStats();
    const concurrentInstalls = this.installing.size;

    if (memStats.rss > this.memoryThresholdMB) {
      console.warn(`High memory usage: ${memStats.rss}MB (threshold: ${this.memoryThresholdMB}MB)`);
      return false;
    }

    if (concurrentInstalls >= this.maxConcurrentInstalls) {
      console.warn(`Too many concurrent installations: ${concurrentInstalls}/${this.maxConcurrentInstalls}`);
      return false;
    }

    return true;
  }

  async validateNpmCache(packageName: string): Promise<boolean> {
    if (this.cacheValidationCache.has(packageName)) {
      const cacheEntry = this.cacheValidationCache.get(packageName)!;
      if (Date.now() - cacheEntry.timestamp < CACHE_VALIDATION_TTL_MS) {
        return cacheEntry.isCorrupted;
      }
    }

    try {
      const npmCachePath = '/home/mcpuser/.cache/npm';
      const npxCachePath = '/home/mcpuser/.cache/npm/_npx';

      let isCorrupted = false;

      if (fs.existsSync(npxCachePath)) {
        const npxDirs = fs.readdirSync(npxCachePath);

        for (const dir of npxDirs) {
          const fullPath = path.join(npxCachePath, dir);
          if (!fs.existsSync(fullPath)) continue;
          await this.checkForTruncatedFiles(fullPath);
        }
      }

      try {
        await execAsync('npm cache verify', {
          timeout: 10000,
          env: { ...process.env, NPM_CONFIG_CACHE: npmCachePath },
        });
      } catch {
        console.warn('NPM cache verification failed');
        isCorrupted = true;
      }

      this.cacheValidationCache.set(packageName, { isCorrupted, timestamp: Date.now() });
      return isCorrupted;
    } catch (error) {
      console.error(`Cache validation error for ${packageName}: ${(error as Error).message}`);
      return false;
    }
  }

  async checkForTruncatedFiles(dirPath: string): Promise<void> {
    try {
      const files = await this.findJSFiles(dirPath);

      for (const file of files.slice(0, 10)) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (this.detectCorruption(content, file)) {
            throw new Error(`Corrupted file detected: ${file}`);
          }
        } catch (readError) {
          if ((readError as Error).message.includes('Corrupted file')) {
            throw readError;
          }
        }
      }
    } catch (error) {
      if ((error as Error).message.includes('Corrupted file')) {
        throw error;
      }
    }
  }

  async findJSFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && files.length < 50) {
          const subFiles = await this.findJSFiles(fullPath);
          files.push(...subFiles.slice(0, 10));
        } else if (item.endsWith('.js')) {
          files.push(fullPath);
        }

        if (files.length >= 50) break;
      }
    } catch {
      // Ignore directory access errors
    }

    return files;
  }

  detectCorruption(content: string, filePath: string): boolean {
    if (/getCapabilities\(paramsOrCallback,\s*opti\s*$/.test(content)) {
      console.warn(`Detected googleapis truncation pattern in ${filePath}`);
      return true;
    }

    if (content.length > 100) {
      const lastLines = content.split('\n').slice(-3);
      for (const line of lastLines) {
        if (line.trim() && !line.trim().endsWith(';') && !line.trim().endsWith('}') && !line.trim().endsWith(',')) {
          if (line.length > 20 && !line.includes('//') && !line.includes('/*')) {
            console.warn(`Detected incomplete line in ${filePath}: "${line.trim()}"`);
            return true;
          }
        }
      }
    }

    if (/[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(content.slice(0, 1000))) {
      console.warn(`Detected binary data in JS file ${filePath}`);
      return true;
    }

    return false;
  }

  async cleanNpmCache(_packageName: string | null = null): Promise<boolean> {
    console.log('Cleaning NPM cache...');

    try {
      await execAsync('npm cache clean --force', { timeout: 30000 });

      const npxCachePath = '/home/mcpuser/.cache/npm/_npx';
      if (fs.existsSync(npxCachePath)) {
        await execAsync(`rm -rf ${npxCachePath}`, { timeout: 10000 });
        console.log('Cleaned NPX cache directory');
      }

      this.cacheValidationCache.clear();
      return true;
    } catch (error) {
      console.error(`Failed to clean NPM cache: ${(error as Error).message}`);
      return false;
    }
  }

  async safeInstall(serverId: string, packageInfo: PackageInfo): Promise<boolean> {
    const { name, command, args } = packageInfo;

    if (this.installing.has(serverId)) {
      console.log(`Installation already in progress for ${serverId}`);
      return false;
    }

    if (!this.isSafeToInstall()) {
      console.log(`Queuing installation for ${serverId} - resource constraints`);
      return new Promise<boolean>((resolve) => {
        this.installQueue.push({ serverId, packageInfo, resolve });
        this.processQueue();
      });
    }

    this.installing.add(serverId);
    const startTime = Date.now();
    const memBefore = this.getMemoryStats();

    try {
      console.log(`Starting safe installation for ${serverId} (Memory: ${memBefore.rss}MB)`);

      const isCorrupted = await this.validateNpmCache(name);
      if (isCorrupted) {
        console.log(`Cache corruption detected for ${serverId}, cleaning...`);
        await this.cleanNpmCache(name);
      }

      const memPreInstall = this.getMemoryStats();
      if (memPreInstall.rss > this.memoryThresholdMB) {
        throw new Error(`Memory too high before installation: ${memPreInstall.rss}MB`);
      }

      const success = await this.executeInstallationWithMonitoring(serverId, command, args);

      const memAfter = this.getMemoryStats();
      const duration = Date.now() - startTime;

      console.log(`Installation ${success ? 'completed' : 'failed'} for ${serverId} in ${duration}ms (Memory: ${memBefore.rss}MB -> ${memAfter.rss}MB)`);

      return success;
    } catch (error) {
      console.error(`Installation failed for ${serverId}: ${(error as Error).message}`);
      return false;
    } finally {
      this.installing.delete(serverId);
      this.processQueue();
    }
  }

  async executeInstallationWithMonitoring(serverId: string, command: string, args: string[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
          NPM_CONFIG_TMP: '/app/tmp',
          UV_CACHE_DIR: '/home/mcpuser/.cache/uv',
        },
      });

      let errorBuffer = '';

      const memoryMonitor = setInterval(() => {
        const memStats = this.getMemoryStats();
        if (memStats.rss > this.memoryThresholdMB * 1.2) {
          console.warn(`Killing ${serverId} installation due to high memory: ${memStats.rss}MB`);
          child.kill('SIGTERM');
          clearInterval(memoryMonitor);
          resolve(false);
        }
      }, 2000);

      child.stderr?.on('data', (data: Buffer) => {
        errorBuffer += data.toString();
      });

      child.on('exit', (code) => {
        clearInterval(memoryMonitor);

        if (code === 0) {
          console.log(`Installation completed for ${serverId}`);
          resolve(true);
        } else {
          console.error(`Installation failed for ${serverId} with code ${code}`);
          if (errorBuffer) {
            console.error(`Error output: ${errorBuffer.slice(-500)}`);
          }
          resolve(false);
        }
      });

      child.on('error', (error) => {
        clearInterval(memoryMonitor);
        console.error(`Installation error for ${serverId}: ${error.message}`);
        resolve(false);
      });
    });
  }

  async processQueue(): Promise<void> {
    if (this.installQueue.length === 0) return;

    const nextIndex = this.installQueue.findIndex(() => this.isSafeToInstall());
    if (nextIndex === -1) return;

    const next = this.installQueue.splice(nextIndex, 1)[0];
    const success = await this.safeInstall(next.serverId, next.packageInfo);
    next.resolve(success);
  }

  getStats() {
    return {
      installing: Array.from(this.installing),
      queued: this.installQueue.length,
      memory: this.getMemoryStats(),
      cacheValidations: this.cacheValidationCache.size,
    };
  }
}
