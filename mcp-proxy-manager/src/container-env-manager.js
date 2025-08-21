const fs = require('fs');
const { spawn } = require('child_process'); // Built-in Node.js module

class ContainerEnvironmentManager {
  constructor(environmentManager) {
    this.environmentManager = environmentManager;
    // Use user home directory - we know it's writable and persistent
    this.globalEnvDir = '/home/mcpuser/.mcp-global-env-dir';
    this.globalEnvFile = '/home/mcpuser/.mcp-global-env-dir/.mcp-global-env';
    this.exportScript = '/home/mcpuser/.mcp-global-env-dir/export-env.sh';
    this.currentGlobalVars = new Map(); // Track current global env vars
    
    this.initializeGlobalEnvironment();
  }

  /**
   * Initialize global environment system
   */
  initializeGlobalEnvironment() {
    try {
      // Create directory if it doesn't exist
      if (!fs.existsSync(this.globalEnvDir)) {
        fs.mkdirSync(this.globalEnvDir, { recursive: true, mode: 0o755 });
        console.log(`📁 Created global environment directory: ${this.globalEnvDir}`);
      }
      
      // Create export script that can be sourced
      this.createExportScript();
      
      // Load existing global variables
      this.loadCurrentGlobalVars();
      
      console.log('Container environment manager initialized');
    } catch (error) {
      console.error('Failed to initialize container environment manager:', error.message);
    }
  }

  /**
   * Create export script for sourcing environment variables
   */
  createExportScript() {
    const scriptContent = `#!/bin/bash
# MCP Global Environment Variables Export Script
# This script is automatically generated and sourced by the container

# Source this file to load all MCP environment variables globally
if [ -f "${this.globalEnvFile}" ]; then
  set -a  # Automatically export all variables
  source "${this.globalEnvFile}"
  set +a  # Turn off automatic export
fi
`;
    
    fs.writeFileSync(this.exportScript, scriptContent, { mode: 0o755 });
  }

  /**
   * Load current global environment variables
   */
  loadCurrentGlobalVars() {
    try {
      if (fs.existsSync(this.globalEnvFile)) {
        const envContent = fs.readFileSync(this.globalEnvFile, 'utf8');
        
        envContent.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
            this.currentGlobalVars.set(key.trim(), value);
          }
        });
        
        console.log(`📂 Loaded ${this.currentGlobalVars.size} global environment variables`);
      }
    } catch (error) {
      console.error('Failed to load current global vars:', error.message);
    }
  }

  /**
   * Set a global environment variable (container-wide)
   * @param {string} key - Environment variable key
   * @param {string} value - Environment variable value
   * @returns {Promise<boolean>} - Success status
   */
  async setGlobalEnvironmentVariable(key, value) {
    try {
      // Validate key and value
      if (!key || typeof key !== 'string' || !key.match(/^[A-Z_][A-Z0-9_]*$/)) {
        throw new Error(`Invalid environment variable key: ${key}`);
      }

      if (value === null || value === undefined) {
        return await this.unsetGlobalEnvironmentVariable(key);
      }

      // Update in-memory tracking
      this.currentGlobalVars.set(key, value);
      
      // Write to global env file
      await this.writeGlobalEnvFile();
      
      // Set in current process environment (for immediate use)
      process.env[key] = value;
      
      // Export to container environment using export command
      await this.exportToContainerEnvironment(key, value);
      
      console.log(`Set global environment variable: ${key}`);
      return true;
    } catch (error) {
      console.error(`Failed to set global environment variable ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Unset a global environment variable
   * @param {string} key - Environment variable key
   * @returns {Promise<boolean>} - Success status
   */
  async unsetGlobalEnvironmentVariable(key) {
    try {
      // Remove from in-memory tracking
      this.currentGlobalVars.delete(key);
      
      // Write updated global env file
      await this.writeGlobalEnvFile();
      
      // Remove from current process environment
      delete process.env[key];
      
      // Remove from .bashrc
      await this.removeFromBashrc(key);
      
      console.log(`Unset global environment variable: ${key}`);
      return true;
    } catch (error) {
      console.error(`Failed to unset global environment variable ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Remove environment variable from shell profiles
   * @param {string} key - Environment variable key
   */
  async removeFromBashrc(key) {
    const profiles = [
      '/home/mcpuser/.bashrc',
      '/home/mcpuser/.profile'
    ];
    
    for (const profile of profiles) {
      try {
        if (fs.existsSync(profile)) {
          let content = fs.readFileSync(profile, 'utf8');
          
          // Remove the variable and its comment
          const lines = content.split('\n');
          const filteredLines = lines.filter(line => 
            !line.includes(`export ${key}=`) && 
            !line.includes(`# MCP Environment Variable: ${key}`)
          );
          
          // Write back
          fs.writeFileSync(profile, filteredLines.join('\n'));
          console.log(`Removed ${key} from ${profile}`);
        }
      } catch (error) {
        console.warn(`Could not remove ${key} from ${profile}: ${error.message}`);
      }
    }
  }

  /**
   * Write global environment file
   */
  async writeGlobalEnvFile() {
    const envLines = [];
    
    for (const [key, value] of this.currentGlobalVars) {
      // Properly escape the value
      const escapedValue = value
        .replace(/\\/g, '\\\\')  // Escape backslashes
        .replace(/"/g, '\\"')        // Escape quotes
        .replace(/\n/g, '\\n')       // Escape newlines
        .replace(/\$/g, '\\$');      // Escape dollar signs
      
      envLines.push(`${key}="${escapedValue}"`);
    }
    
    // Write atomically
    const tempFile = `${this.globalEnvFile}.tmp`;
    fs.writeFileSync(tempFile, envLines.join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tempFile, this.globalEnvFile);
  }

  /**
   * Export variable to container environment using various methods
   * @param {string} key - Environment variable key
   * @param {string} value - Environment variable value
   */
  async exportToContainerEnvironment(key, value) {
    try {
      // Method 1: Try to update init process environment (if we have permissions)
      // This is the most direct way but may not work in all container setups
      await this.tryUpdateInitEnvironment(key, value);
      
      // Method 2: Update shell profiles for future shells
      await this.updateShellProfiles(key, value);
      
    } catch (error) {
      console.warn(`Container environment export warning for ${key}: ${error.message}`);
    }
  }

  /**
   * Try to update init process environment
   * @param {string} key - Environment variable key
   * @param {string} value - Environment variable value
   */
  async tryUpdateInitEnvironment(key, value) {
    return new Promise((resolve, reject) => {
      // Use a shell script to attempt setting the environment variable globally
      const script = `
#!/bin/bash
# Try different methods to set global environment variable
export ${key}="${value.replace(/"/g, '\\"')}"

# Method 1: Add to /etc/environment (if writable)
if [ -w /etc/environment ] 2>/dev/null; then
  if ! grep -q "^${key}=" /etc/environment 2>/dev/null; then
    echo "${key}=\\"${value.replace(/"/g, '\\"')}\\"" >> /etc/environment
  else
    sed -i "s/^${key}=.*/${key}=\\"${value.replace(/"/g, '\\"')}\\"/" /etc/environment
  fi
fi

# Method 2: Add to /etc/profile.d/ (if directory exists and writable)
if [ -d /etc/profile.d ] && [ -w /etc/profile.d ] 2>/dev/null; then
  echo "export ${key}=\\"${value.replace(/"/g, '\\"')}\\"" > /etc/profile.d/mcp-${key.toLowerCase()}.sh
  chmod 644 /etc/profile.d/mcp-${key.toLowerCase()}.sh 2>/dev/null || true
fi

echo "Environment variable ${key} exported"
`;

      const child = spawn('bash', ['-c', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `Export failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Update shell profiles for future shell sessions
   * @param {string} key - Environment variable key
   * @param {string} value - Environment variable value
   */
  async updateShellProfiles(key, value) {
    // Update both .bashrc and .profile for maximum compatibility
    const profiles = [
      '/home/mcpuser/.bashrc',
      '/home/mcpuser/.profile'
    ];
    
    const exportLine = `export ${key}="${value.replace(/"/g, '\\"')}"`;
    const commentLine = `# MCP Environment Variable: ${key}`;

    for (const profile of profiles) {
      try {
        if (fs.existsSync(profile)) {
          let content = fs.readFileSync(profile, 'utf8');
          
          // Remove any existing entry for this variable
          const lines = content.split('\n');
          const filteredLines = lines.filter(line => 
            !line.includes(`export ${key}=`) && 
            !line.includes(`# MCP Environment Variable: ${key}`)
          );
          
          // Add new entry at the end
          filteredLines.push('', commentLine, exportLine);
          
          // Write back
          fs.writeFileSync(profile, filteredLines.join('\n'));
          console.log(`Added ${key} to ${profile} for global shell access`);
        }
      } catch (error) {
        console.warn(`Could not update ${profile}: ${error.message}`);
      }
    }
  }

  /**
   * Set multiple global environment variables from a server's environment data
   * @param {string} serverId - Server ID
   * @returns {Promise<boolean>} - Success status
   */
  async setServerGlobalEnvironment(serverId) {
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
      console.error(`Failed to set server global environment for ${serverId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get current global environment variables
   * @returns {Object} - Current global environment variables
   */
  getGlobalEnvironmentVariables() {
    const result = {};
    for (const [key, value] of this.currentGlobalVars) {
      result[key] = {
        value: value,
        masked: this.maskValue(key, value),
        isGlobal: true
      };
    }
    return result;
  }

  /**
   * Mask sensitive values for display
   * @param {string} key - Variable key
   * @param {string} value - Variable value
   * @returns {string} - Masked value
   */
  maskValue(key, value) {
    if (!value) return 'Not Set';
    
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('password')) {
      return '••••••••••••••••';
    }
    
    // For non-sensitive values, show first and last few characters
    if (value.length > 8) {
      return `${value.substring(0, 3)}•••${value.substring(value.length - 3)}`;
    }
    
    return '••••••••';
  }

  /**
   * Test if global environment variables are accessible
   * @returns {Promise<Object>} - Test results
   */
  async testGlobalEnvironment() {
    const testKey = 'MCP_TEST_VAR';
    const testValue = 'test_value_' + Date.now();
    
    try {
      // Set test variable
      await this.setGlobalEnvironmentVariable(testKey, testValue);
      
      // Test accessibility in new bash session
      const result = await new Promise((resolve, reject) => {
        const child = spawn('bash', ['-c', `echo $${testKey}`], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        child.stdout.on('data', (data) => {
          output += data.toString().trim();
        });
        
        child.on('exit', (code) => {
          resolve({
            success: code === 0 && output === testValue,
            output,
            expected: testValue,
            exitCode: code
          });
        });
        
        child.on('error', (error) => {
          reject(error);
        });
      });
      
      // Clean up test variable
      await this.unsetGlobalEnvironmentVariable(testKey);
      
      return {
        containerEnvironmentWorking: result.success,
        testDetails: result
      };
    } catch (error) {
      return {
        containerEnvironmentWorking: false,
        error: error.message
      };
    }
  }

  /**
   * Get statistics about global environment management
   * @returns {Object} - Statistics
   */
  getStats() {
    return {
      globalVariablesCount: this.currentGlobalVars.size,
      globalEnvFile: this.globalEnvFile,
      exportScript: this.exportScript,
      globalVariables: Object.keys(Object.fromEntries(this.currentGlobalVars))
    };
  }
}

module.exports = ContainerEnvironmentManager;