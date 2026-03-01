import fs from 'fs';
import { spawn } from 'child_process';
import { EnvironmentManager } from './environment-manager.js';

const DEFAULT_GLOBAL_ENV_DIR = '/home/mcpuser/.mcp-global-env-dir';

export class ContainerEnvironmentManager {
  private readonly environmentManager: EnvironmentManager;
  private readonly globalEnvDir: string;
  private readonly globalEnvFile: string;
  private readonly exportScript: string;
  private readonly currentGlobalVars: Map<string, string>;

  constructor(environmentManager: EnvironmentManager) {
    this.environmentManager = environmentManager;
    this.globalEnvDir = DEFAULT_GLOBAL_ENV_DIR;
    this.globalEnvFile = `${DEFAULT_GLOBAL_ENV_DIR}/.mcp-global-env`;
    this.exportScript = `${DEFAULT_GLOBAL_ENV_DIR}/export-env.sh`;
    this.currentGlobalVars = new Map();

    this.initializeGlobalEnvironment();
  }

  private initializeGlobalEnvironment(): void {
    try {
      if (!fs.existsSync(this.globalEnvDir)) {
        fs.mkdirSync(this.globalEnvDir, { recursive: true, mode: 0o755 });
        console.log(`Created global environment directory: ${this.globalEnvDir}`);
      }

      this.createExportScript();
      this.loadCurrentGlobalVars();

      console.log('Container environment manager initialized');
    } catch (error) {
      console.error('Failed to initialize container environment manager:', (error as Error).message);
    }
  }

  private createExportScript(): void {
    const scriptContent = `#!/bin/bash
# MCP Global Environment Variables Export Script
# This script is automatically generated and sourced by the container

if [ -f "${this.globalEnvFile}" ]; then
  set -a
  source "${this.globalEnvFile}"
  set +a
fi
`;

    fs.writeFileSync(this.exportScript, scriptContent, { mode: 0o755 });
  }

  private loadCurrentGlobalVars(): void {
    try {
      if (fs.existsSync(this.globalEnvFile)) {
        const envContent = fs.readFileSync(this.globalEnvFile, 'utf8');

        envContent.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            this.currentGlobalVars.set(key.trim(), value);
          }
        });

        console.log(`Loaded ${this.currentGlobalVars.size} global environment variables`);
      }
    } catch (error) {
      console.error('Failed to load current global vars:', (error as Error).message);
    }
  }

  async setGlobalEnvironmentVariable(key: string, value: string | null): Promise<boolean> {
    try {
      if (!key || typeof key !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable key: ${key}`);
      }

      if (value === null || value === undefined) {
        return await this.unsetGlobalEnvironmentVariable(key);
      }

      this.currentGlobalVars.set(key, value);
      await this.writeGlobalEnvFile();
      process.env[key] = value;
      await this.exportToContainerEnvironment(key, value);

      console.log(`Set global environment variable: ${key}`);
      return true;
    } catch (error) {
      console.error(`Failed to set global environment variable ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async unsetGlobalEnvironmentVariable(key: string): Promise<boolean> {
    try {
      this.currentGlobalVars.delete(key);
      await this.writeGlobalEnvFile();
      delete process.env[key];
      await this.removeFromBashrc(key);

      console.log(`Unset global environment variable: ${key}`);
      return true;
    } catch (error) {
      console.error(`Failed to unset global environment variable ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  private async removeFromBashrc(key: string): Promise<void> {
    const profiles = ['/home/mcpuser/.bashrc', '/home/mcpuser/.profile'];

    for (const profile of profiles) {
      try {
        if (fs.existsSync(profile)) {
          const content = fs.readFileSync(profile, 'utf8');
          const lines = content.split('\n');
          const filteredLines = lines.filter(line =>
            !line.includes(`export ${key}=`) &&
            !line.includes(`# MCP Environment Variable: ${key}`),
          );
          fs.writeFileSync(profile, filteredLines.join('\n'));
          console.log(`Removed ${key} from ${profile}`);
        }
      } catch (error) {
        console.warn(`Could not remove ${key} from ${profile}: ${(error as Error).message}`);
      }
    }
  }

  private async writeGlobalEnvFile(): Promise<void> {
    const envLines: string[] = [];

    for (const [key, value] of this.currentGlobalVars) {
      const escapedValue = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\$/g, '\\$');

      envLines.push(`${key}="${escapedValue}"`);
    }

    const tempFile = `${this.globalEnvFile}.tmp`;
    fs.writeFileSync(tempFile, envLines.join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tempFile, this.globalEnvFile);
  }

  private async exportToContainerEnvironment(key: string, value: string): Promise<void> {
    try {
      await this.tryUpdateInitEnvironment(key, value);
      await this.updateShellProfiles(key, value);
    } catch (error) {
      console.warn(`Container environment export warning for ${key}: ${(error as Error).message}`);
    }
  }

  private async tryUpdateInitEnvironment(key: string, value: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const escapedValue = value.replace(/"/g, '\\"');
      const script = `
#!/bin/bash
export ${key}="${escapedValue}"

if [ -w /etc/environment ] 2>/dev/null; then
  if ! grep -q "^${key}=" /etc/environment 2>/dev/null; then
    echo "${key}=\\"${escapedValue}\\"" >> /etc/environment
  else
    sed -i "s/^${key}=.*/${key}=\\"${escapedValue}\\"/" /etc/environment
  fi
fi

if [ -d /etc/profile.d ] && [ -w /etc/profile.d ] 2>/dev/null; then
  echo "export ${key}=\\"${escapedValue}\\"" > /etc/profile.d/mcp-${key.toLowerCase()}.sh
  chmod 644 /etc/profile.d/mcp-${key.toLowerCase()}.sh 2>/dev/null || true
fi

echo "Environment variable ${key} exported"
`;

      const child = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { errorOutput += data.toString(); });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `Export failed with code ${code}`));
        }
      });

      child.on('error', (error) => { reject(error); });
    });
  }

  private async updateShellProfiles(key: string, value: string): Promise<void> {
    const profiles = ['/home/mcpuser/.bashrc', '/home/mcpuser/.profile'];
    const exportLine = `export ${key}="${value.replace(/"/g, '\\"')}"`;
    const commentLine = `# MCP Environment Variable: ${key}`;

    for (const profile of profiles) {
      try {
        if (fs.existsSync(profile)) {
          const content = fs.readFileSync(profile, 'utf8');
          const lines = content.split('\n');
          const filteredLines = lines.filter(line =>
            !line.includes(`export ${key}=`) &&
            !line.includes(`# MCP Environment Variable: ${key}`),
          );
          filteredLines.push('', commentLine, exportLine);
          fs.writeFileSync(profile, filteredLines.join('\n'));
          console.log(`Added ${key} to ${profile} for global shell access`);
        }
      } catch (error) {
        console.warn(`Could not update ${profile}: ${(error as Error).message}`);
      }
    }
  }

  async setServerGlobalEnvironment(serverId: string): Promise<boolean> {
    try {
      const envVars = this.environmentManager.loadEnvironmentVariables(serverId);

      let successCount = 0;
      for (const [key, value] of Object.entries(envVars)) {
        const success = await this.setGlobalEnvironmentVariable(key, value);
        if (success) successCount++;
      }

      console.log(`Set ${successCount}/${Object.keys(envVars).length} global environment variables for ${serverId}`);
      return successCount === Object.keys(envVars).length;
    } catch (error) {
      console.error(`Failed to set server global environment for ${serverId}: ${(error as Error).message}`);
      return false;
    }
  }

  getGlobalEnvironmentVariables(): Record<string, { value: string; masked: string; isGlobal: boolean }> {
    const result: Record<string, { value: string; masked: string; isGlobal: boolean }> = {};
    for (const [key, value] of this.currentGlobalVars) {
      result[key] = {
        value,
        masked: this.maskValue(key, value),
        isGlobal: true,
      };
    }
    return result;
  }

  maskValue(key: string, value: string): string {
    if (!value) return 'Not Set';

    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('password')) {
      return '\u2022'.repeat(16);
    }

    if (value.length > 8) {
      return `${value.substring(0, 3)}\u2022\u2022\u2022${value.substring(value.length - 3)}`;
    }

    return '\u2022'.repeat(8);
  }

  async testGlobalEnvironment(): Promise<{ containerEnvironmentWorking: boolean; testDetails?: unknown; error?: string }> {
    const testKey = 'MCP_TEST_VAR';
    const testValue = `test_value_${Date.now()}`;

    try {
      await this.setGlobalEnvironmentVariable(testKey, testValue);

      const result = await new Promise<{ success: boolean; output: string; expected: string; exitCode: number | null }>((resolve, reject) => {
        const child = spawn('bash', ['-c', `echo $${testKey}`], { stdio: ['ignore', 'pipe', 'pipe'] });

        let output = '';
        child.stdout.on('data', (data: Buffer) => { output += data.toString().trim(); });

        child.on('exit', (code) => {
          resolve({ success: code === 0 && output === testValue, output, expected: testValue, exitCode: code });
        });

        child.on('error', (error) => { reject(error); });
      });

      await this.unsetGlobalEnvironmentVariable(testKey);

      return { containerEnvironmentWorking: result.success, testDetails: result };
    } catch (error) {
      return { containerEnvironmentWorking: false, error: (error as Error).message };
    }
  }

  getStats() {
    return {
      globalVariablesCount: this.currentGlobalVars.size,
      globalEnvFile: this.globalEnvFile,
      exportScript: this.exportScript,
      globalVariables: Array.from(this.currentGlobalVars.keys()),
    };
  }
}
