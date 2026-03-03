import { spawn } from 'child_process';

export class InstallationManager {
  private installing = new Set<string>();
  private readonly maxConcurrentInstalls: number;
  private readonly memoryThresholdMB: number;

  constructor(maxConcurrent = 2, memoryThresholdMB = 800) {
    this.maxConcurrentInstalls = maxConcurrent;
    this.memoryThresholdMB = memoryThresholdMB;
  }

  getMemoryStats(): { rss: number; heapUsed: number; heapTotal: number; external: number } {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
    };
  }

  isSafeToInstall(): boolean {
    const { rss } = this.getMemoryStats();
    return rss < this.memoryThresholdMB && this.installing.size < this.maxConcurrentInstalls;
  }

  isInstalling(packageName: string): boolean {
    return this.installing.has(packageName);
  }

  markInstalling(packageName: string): void {
    this.installing.add(packageName);
  }

  markDone(packageName: string): void {
    this.installing.delete(packageName);
  }

  get concurrentCount(): number {
    return this.installing.size;
  }

  async cleanNpmCache(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['cache', 'clean', '--force'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm cache clean exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  async validateNpmCache(packageName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['cache', 'verify'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
