const { exec } = require('child_process'); // Built-in Node.js module
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

class InstallationManager {
  constructor() {
    this.installing = new Set(); // Track ongoing installations
    this.installQueue = []; // Queue for memory-constrained installs
    this.maxConcurrentInstalls = 2; // Limit concurrent installs
    this.memoryThresholdMB = 800; // Alert if over 800MB (out of 1GB)
    this.cacheValidationCache = new Map(); // Cache validation results
  }

  /**
   * Check system memory usage
   * @returns {Object} Memory stats
   */
  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024) // MB
    };
  }

  /**
   * Check if safe to start new installation
   * @returns {boolean} Safe to install
   */
  isSafeToInstall() {
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

  /**
   * Validate NPM cache integrity for a specific package
   * @param {string} packageName - Package to validate
   * @returns {Promise<boolean>} True if cache is corrupted
   */
  async validateNpmCache(packageName) {
    // Check cache first
    if (this.cacheValidationCache.has(packageName)) {
      const cacheEntry = this.cacheValidationCache.get(packageName);
      // Cache validation results for 5 minutes
      if (Date.now() - cacheEntry.timestamp < 300000) {
        return cacheEntry.isCorrupted;
      }
    }

    try {
      const npmCachePath = '/home/mcpuser/.cache/npm';
      const npxCachePath = '/home/mcpuser/.cache/npm/_npx';
      
      let isCorrupted = false;
      
      // Check if NPX cache exists and has reasonable size
      if (fs.existsSync(npxCachePath)) {
        const npxDirs = fs.readdirSync(npxCachePath);
        
        for (const dir of npxDirs) {
          const fullPath = path.join(npxCachePath, dir);
          if (!fs.existsSync(fullPath)) continue;
          
          // Check for truncated files (common corruption symptom)
          await this.checkForTruncatedFiles(fullPath);
        }
      }
      
      // Verify NPM cache integrity
      try {
        await execAsync('npm cache verify', { 
          timeout: 10000,
          env: { 
            ...process.env, 
            NPM_CONFIG_CACHE: npmCachePath 
          }
        });
      } catch (error) {
        console.warn(`NPM cache verification failed: ${error.message}`);
        isCorrupted = true;
      }
      
      // Cache the result
      this.cacheValidationCache.set(packageName, {
        isCorrupted,
        timestamp: Date.now()
      });
      
      return isCorrupted;
    } catch (error) {
      console.error(`Cache validation error for ${packageName}: ${error.message}`);
      return false; // Assume OK if we can't validate
    }
  }

  /**
   * Check for truncated files in a directory
   * @param {string} dirPath - Directory to check
   */
  async checkForTruncatedFiles(dirPath) {
    try {
      const files = await this.findJSFiles(dirPath);
      
      for (const file of files.slice(0, 10)) { // Check first 10 JS files
        try {
          const content = fs.readFileSync(file, 'utf8');
          
          // Check for common corruption patterns
          if (this.detectCorruption(content, file)) {
            throw new Error(`Corrupted file detected: ${file}`);
          }
        } catch (readError) {
          if (readError.message.includes('Corrupted file')) {
            throw readError;
          }
          // Ignore read errors on non-critical files
        }
      }
    } catch (error) {
      if (error.message.includes('Corrupted file')) {
        throw error;
      }
      // Ignore directory traversal errors
    }
  }

  /**
   * Find JavaScript files in directory
   * @param {string} dir - Directory to search
   * @returns {Array} Array of JS file paths
   */
  async findJSFiles(dir) {
    const files = [];
    
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && files.length < 50) {
          // Recursively search but limit depth
          const subFiles = await this.findJSFiles(fullPath);
          files.push(...subFiles.slice(0, 10));
        } else if (item.endsWith('.js')) {
          files.push(fullPath);
        }
        
        if (files.length >= 50) break; // Limit search scope
      }
    } catch (error) {
      // Ignore directory access errors
    }
    
    return files;
  }

  /**
   * Detect file corruption patterns
   * @param {string} content - File content
   * @param {string} filePath - File path for context
   * @returns {boolean} True if corruption detected
   */
  detectCorruption(content, filePath) {
    // Pattern 1: Truncated function calls (like the googleapis issue)
    if (/getCapabilities\(paramsOrCallback,\s*opti\s*$/.test(content)) {
      console.warn(`Detected googleapis truncation pattern in ${filePath}`);
      return true;
    }
    
    // Pattern 2: Incomplete lines at end of file
    if (content.length > 100) {
      const lastLines = content.split('\\n').slice(-3);
      for (const line of lastLines) {
        if (line.trim() && !line.trim().endsWith(';') && !line.trim().endsWith('}') && !line.trim().endsWith(',')) {
          if (line.length > 20 && !line.includes('//') && !line.includes('/*')) {
            console.warn(`Detected incomplete line in ${filePath}: "${line.trim()}"`);
            return true;
          }
        }
      }
    }
    
    // Pattern 3: Binary data in JS files
    if (/[\\x00-\\x08\\x0E-\\x1F\\x7F-\\xFF]/.test(content.slice(0, 1000))) {
      console.warn(`Detected binary data in JS file ${filePath}`);
      return true;
    }
    
    return false;
  }

  /**
   * Clean specific NPM cache
   * @param {string} packageName - Package name to clean
   */
  async cleanNpmCache(packageName = null) {
    console.log(`🧹 Cleaning NPM cache${packageName ? ` for ${packageName}` : ''}...`);
    
    try {
      // Clean NPM cache
      await execAsync('npm cache clean --force', { timeout: 30000 });
      
      // Clean NPX cache directory
      const npxCachePath = '/home/mcpuser/.cache/npm/_npx';
      if (fs.existsSync(npxCachePath)) {
        await execAsync(`rm -rf ${npxCachePath}`, { timeout: 10000 });
        console.log(`🧹 Cleaned NPX cache directory`);
      }
      
      // Clear validation cache
      this.cacheValidationCache.clear();
      
      return true;
    } catch (error) {
      console.error(`Failed to clean NPM cache: ${error.message}`);
      return false;
    }
  }

  /**
   * Safe installation with corruption prevention
   * @param {string} serverId - Server ID
   * @param {Array} packageInfo - Package info {name, command, args}
   * @returns {Promise<boolean>} Success status
   */
  async safeInstall(serverId, packageInfo) {
    const { name, command, args } = packageInfo;
    
    // Check if already installing
    if (this.installing.has(serverId)) {
      console.log(`Installation already in progress for ${serverId}`);
      return false;
    }
    
    // Check memory and concurrent installs
    if (!this.isSafeToInstall()) {
      console.log(`Queuing installation for ${serverId} - resource constraints`);
      return new Promise((resolve) => {
        this.installQueue.push({ serverId, packageInfo, resolve });
        this.processQueue(); // Try to process queue
      });
    }
    
    this.installing.add(serverId);
    const startTime = Date.now();
    const memBefore = this.getMemoryStats();
    
    try {
      console.log(`Starting safe installation for ${serverId} (Memory: ${memBefore.rss}MB)`);
      
      // Step 1: Validate cache
      const isCorrupted = await this.validateNpmCache(name);
      if (isCorrupted) {
        console.log(`🧹 Cache corruption detected for ${serverId}, cleaning...`);
        await this.cleanNpmCache(name);
      }
      
      // Step 2: Pre-installation memory check
      const memPreInstall = this.getMemoryStats();
      if (memPreInstall.rss > this.memoryThresholdMB) {
        throw new Error(`Memory too high before installation: ${memPreInstall.rss}MB`);
      }
      
      // Step 3: Execute installation with monitoring
      const success = await this.executeInstallationWithMonitoring(serverId, command, args);
      
      const memAfter = this.getMemoryStats();
      const duration = Date.now() - startTime;
      
      console.log(`Installation ${success ? 'completed' : 'failed'} for ${serverId} in ${duration}ms (Memory: ${memBefore.rss}MB → ${memAfter.rss}MB)`);
      
      return success;
    } catch (error) {
      console.error(`Installation failed for ${serverId}: ${error.message}`);
      return false;
    } finally {
      this.installing.delete(serverId);
      this.processQueue(); // Process next queued installation
    }
  }

  /**
   * Execute installation with memory monitoring
   * @param {string} serverId - Server ID
   * @param {string} command - Command to execute
   * @param {Array} args - Command arguments
   * @returns {Promise<boolean>} Success status
   */
  async executeInstallationWithMonitoring(serverId, command, args) {
    return new Promise((resolve) => {
      const { spawn } = require('child_process'); // Built-in Node.js module
      
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Use dedicated cache dirs
          NPM_CONFIG_CACHE: '/home/mcpuser/.cache/npm',
          NPM_CONFIG_TMP: '/app/tmp',
          UV_CACHE_DIR: '/home/mcpuser/.cache/uv'
        }
      });
      
      let outputBuffer = '';
      let errorBuffer = '';
      
      // Monitor memory during installation
      const memoryMonitor = setInterval(() => {
        const memStats = this.getMemoryStats();
        if (memStats.rss > this.memoryThresholdMB * 1.2) { // 120% of threshold
          console.warn(`Killing ${serverId} installation due to high memory: ${memStats.rss}MB`);
          child.kill('SIGTERM');
          clearInterval(memoryMonitor);
          resolve(false);
        }
      }, 2000);
      
      child.stdout.on('data', (data) => {
        outputBuffer += data.toString();
      });
      
      child.stderr.on('data', (data) => {
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
            console.error(`Error output: ${errorBuffer.slice(-500)}`); // Last 500 chars
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

  /**
   * Process queued installations
   */
  async processQueue() {
    if (this.installQueue.length === 0) return;
    
    // Find next installable item
    const nextIndex = this.installQueue.findIndex(() => this.isSafeToInstall());
    if (nextIndex === -1) return; // No safe installations available
    
    const next = this.installQueue.splice(nextIndex, 1)[0];
    const success = await this.safeInstall(next.serverId, next.packageInfo);
    next.resolve(success);
  }

  /**
   * Get installation statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      installing: Array.from(this.installing),
      queued: this.installQueue.length,
      memory: this.getMemoryStats(),
      cacheValidations: this.cacheValidationCache.size
    };
  }
}

module.exports = InstallationManager;