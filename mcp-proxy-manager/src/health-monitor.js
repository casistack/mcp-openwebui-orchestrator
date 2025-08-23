const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class HealthMonitor {
  constructor(proxyManager, configParser = null) {
    this.proxyManager = proxyManager;
    this.configParser = configParser;
    this.healthHistory = new Map(); // serverId -> health history array
    this.maxHistorySize = 100; // Keep last 100 health checks
    this.alertThresholds = {
      consecutiveFailures: 3,
      failureRate: 0.8, // 80% failure rate in last 10 checks
      responseTime: 10000 // 10 seconds
    };
    this.cronJob = null;
  }

  /**
   * Start health monitoring with cron schedule
   * @param {string} schedule - Cron schedule (default: every 30 seconds)
   */
  startMonitoring(schedule = '*/30 * * * * *') {
    if (this.cronJob) {
      console.log('Health monitoring already running');
      return;
    }

    this.cronJob = cron.schedule(schedule, async () => {
      await this.performHealthChecks();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    console.log(`Health monitoring started with schedule: ${schedule}`);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('Health monitoring stopped');
    }
  }

  /**
   * Perform health checks on all running proxies
   */
  async performHealthChecks() {
    const proxies = this.proxyManager.getProxyStatuses();
    const timestamp = new Date();

    console.log(`Performing health checks for ${proxies.length} proxies`);

    for (const proxy of proxies) {
      await this.checkProxyHealth(proxy.serverId, proxy.port, timestamp);
    }

    // Generate health report
    this.generateHealthReport();
  }

  /**
   * Check health of a specific proxy
   * @param {string} serverId - Server ID
   * @param {number} port - Proxy port
   * @param {Date} timestamp - Check timestamp
   */
  async checkProxyHealth(serverId, port, timestamp) {
    const startTime = Date.now();
    let healthStatus = {
      timestamp,
      serverId,
      port,
      healthy: false,
      responseTime: null,
      error: null,
      statusCode: null
    };

    try {
      // Check MCPO-specific endpoints in order of reliability
      const endpoints = [
        {
          url: `http://localhost:${port}/openapi.json`,
          name: 'openapi',
          expectedStatus: 200
        },
        {
          url: `http://localhost:${port}/docs`,
          name: 'docs',
          expectedStatus: 200
        },
        {
          url: `http://localhost:${port}/`,
          name: 'root',
          expectedStatus: 200
        }
      ];

      let success = false;
      let lastError = null;
      let hasAuthError = false;
      
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint.url, {
            timeout: this.alertThresholds.responseTime,
            validateStatus: (status) => status === endpoint.expectedStatus
          });

          healthStatus.healthy = true;
          healthStatus.responseTime = Date.now() - startTime;
          healthStatus.statusCode = response.status;
          healthStatus.endpoint = endpoint.name;
          success = true;
          break;
        } catch (endpointError) {
          lastError = endpointError;
          
          // Check for authentication errors
          if (endpointError.response?.status === 401) {
            hasAuthError = true;
            healthStatus.statusCode = 401;
            healthStatus.authError = true;
          }
          
          // Continue to next endpoint
          continue;
        }
      }

      if (!success) {
        // Don't throw error for auth issues - they're expected for some external services
        if (hasAuthError) {
          healthStatus.healthy = false;
          healthStatus.authError = true;
          healthStatus.error = 'Authentication required for external service';
        } else {
          throw lastError || new Error('All endpoints failed');
        }
      }
    } catch (error) {
      healthStatus.healthy = false;
      healthStatus.responseTime = Date.now() - startTime;
      healthStatus.error = error.message;
      healthStatus.statusCode = error.response?.status || null;
    }

    // Store health history
    this.storeHealthHistory(serverId, healthStatus);

    // Check for alerts
    await this.checkAlerts(serverId);
  }

  /**
   * Store health check result in history
   * @param {string} serverId - Server ID
   * @param {Object} healthStatus - Health status object
   */
  storeHealthHistory(serverId, healthStatus) {
    if (!this.healthHistory.has(serverId)) {
      this.healthHistory.set(serverId, []);
    }

    const history = this.healthHistory.get(serverId);
    history.push(healthStatus);

    // Trim history if it exceeds max size
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  /**
   * Check for alert conditions
   * @param {string} serverId - Server ID
   */
  async checkAlerts(serverId) {
    const history = this.healthHistory.get(serverId) || [];
    if (history.length === 0) return;

    const recentChecks = history.slice(-10); // Last 10 checks
    const latestCheck = history[history.length - 1];

    // Check consecutive failures
    const consecutiveFailures = this.getConsecutiveFailures(history);
    if (consecutiveFailures >= this.alertThresholds.consecutiveFailures) {
      await this.handleAlert('consecutive_failures', serverId, {
        consecutiveFailures,
        threshold: this.alertThresholds.consecutiveFailures
      });
    }

    // Check failure rate
    const failureCount = recentChecks.filter(check => !check.healthy).length;
    const failureRate = failureCount / recentChecks.length;
    if (failureRate >= this.alertThresholds.failureRate) {
      await this.handleAlert('high_failure_rate', serverId, {
        failureRate: Math.round(failureRate * 100),
        threshold: Math.round(this.alertThresholds.failureRate * 100),
        recentChecks: recentChecks.length
      });
    }

    // Check response time
    if (latestCheck.healthy && latestCheck.responseTime > this.alertThresholds.responseTime) {
      await this.handleAlert('slow_response', serverId, {
        responseTime: latestCheck.responseTime,
        threshold: this.alertThresholds.responseTime
      });
    }
  }

  /**
   * Get consecutive failures count
   * @param {Array} history - Health history
   * @returns {number} - Number of consecutive failures from the end
   */
  getConsecutiveFailures(history) {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].healthy) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Handle alert condition
   * @param {string} alertType - Type of alert
   * @param {string} serverId - Server ID
   * @param {Object} details - Alert details
   */
  async handleAlert(alertType, serverId, details) {
    const alert = {
      timestamp: new Date(),
      type: alertType,
      serverId,
      details,
      severity: this.getAlertSeverity(alertType)
    };

    console.warn(`ALERT [${alert.severity}]: ${alertType} for ${serverId}`, details);

    // Log alert to file
    this.logAlert(alert);

    // Auto-remediation
    await this.attemptRemediation(alertType, serverId, details);
  }

  /**
   * Get alert severity
   * @param {string} alertType - Alert type
   * @returns {string} - Severity level
   */
  getAlertSeverity(alertType) {
    const severityMap = {
      'consecutive_failures': 'HIGH',
      'high_failure_rate': 'MEDIUM',
      'slow_response': 'LOW'
    };
    return severityMap[alertType] || 'MEDIUM';
  }

  /**
   * Attempt automatic remediation
   * @param {string} alertType - Alert type
   * @param {string} serverId - Server ID
   * @param {Object} details - Alert details
   */
  async attemptRemediation(alertType, serverId, details) {
    // Check if this server has authentication errors - don't restart those
    const history = this.healthHistory.get(serverId) || [];
    const latestCheck = history[history.length - 1];
    
    if (latestCheck?.authError) {
      console.log(`Skipping remediation for ${serverId} - server has authentication errors`);
      return;
    }

    switch (alertType) {
      case 'consecutive_failures':
        if (details.consecutiveFailures >= 5) {
          console.log(`Attempting restart for ${serverId} due to consecutive failures`);
          await this.proxyManager.restartProxy(serverId);
        }
        break;
      
      case 'high_failure_rate':
        if (details.failureRate >= 90) {
          console.log(`Attempting restart for ${serverId} due to high failure rate`);
          await this.proxyManager.restartProxy(serverId);
        }
        break;
      
      default:
        // No automatic remediation for other alert types
        break;
    }
  }

  /**
   * Log alert to file
   * @param {Object} alert - Alert object
   */
  logAlert(alert) {
    try {
      const logFile = '/var/log/mcp-proxy-manager/alerts.log';
      const logDir = path.dirname(logFile);
      
      // Create log directory if it doesn't exist
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logEntry = `${alert.timestamp.toISOString()} [${alert.severity}] ${alert.type} - ${alert.serverId}: ${JSON.stringify(alert.details)}\n`;
      fs.appendFileSync(logFile, logEntry);
    } catch (error) {
      console.error('Failed to log alert:', error.message);
    }
  }

  /**
   * Generate comprehensive health report
   */
  generateHealthReport() {
    const report = {
      timestamp: new Date(),
      totalProxies: this.healthHistory.size,
      healthyProxies: 0,
      unhealthyProxies: 0,
      averageResponseTime: 0,
      servers: {}
    };

    let totalResponseTime = 0;
    let responsiveServers = 0;

    // Generate report for actively monitored servers
    for (const [serverId, history] of this.healthHistory) {
      const latestCheck = history[history.length - 1];
      const recentChecks = history.slice(-10);
      
      const serverReport = {
        serverId,
        healthy: latestCheck?.healthy || false,
        lastCheck: latestCheck?.timestamp,
        responseTime: latestCheck?.responseTime,
        uptime: this.calculateUptime(history),
        failureRate: this.calculateFailureRate(recentChecks),
        consecutiveFailures: this.getConsecutiveFailures(history),
        authError: latestCheck?.authError || false
      };

      report.servers[serverId] = serverReport;

      if (serverReport.healthy) {
        report.healthyProxies++;
        if (serverReport.responseTime) {
          totalResponseTime += serverReport.responseTime;
          responsiveServers++;
        }
      } else {
        report.unhealthyProxies++;
      }
    }

    if (responsiveServers > 0) {
      report.averageResponseTime = Math.round(totalResponseTime / responsiveServers);
    }

    // Get comprehensive status if config parser is available (includes all configured servers)
    if (this.configParser) {
      const allConfiguredServers = this.configParser.getMCPServers();
      const proxyStatuses = this.proxyManager.getProxyStatuses();
      
      // Create comprehensive server list (similar to status endpoint logic)
      const comprehensiveProxies = allConfiguredServers.map(server => {
        const runningProxy = proxyStatuses.find(p => p.serverId === server.id);
        
        if (runningProxy) {
          return runningProxy;
        } else {
          const needsProxy = server.needsProxy !== false;
          return {
            serverId: server.id,
            healthy: false,
            status: needsProxy ? 'failed' : 'skipped'
          };
        }
      });

      // Calculate comprehensive counts
      const healthyCount = comprehensiveProxies.filter(p => 
        p.healthy && p.status !== 'failed' && p.status !== 'skipped'
      ).length;
      const totalCount = comprehensiveProxies.length;
      const failedCount = comprehensiveProxies.filter(p => p.status === 'failed').length;
      const skippedCount = comprehensiveProxies.filter(p => p.status === 'skipped').length;

      // Log comprehensive summary
      console.log(`Health Report: ${healthyCount}/${totalCount} configured (${healthyCount} healthy, ${failedCount} failed, ${skippedCount} skipped), avg response: ${report.averageResponseTime}ms`);
    } else {
      // Fallback to old format if config parser not available
      console.log(`Health Report: ${report.healthyProxies}/${report.totalProxies} healthy, avg response: ${report.averageResponseTime}ms`);
    }

    return report;
  }

  /**
   * Calculate uptime percentage
   * @param {Array} history - Health history
   * @returns {number} - Uptime percentage
   */
  calculateUptime(history) {
    if (history.length === 0) return 0;
    const healthyChecks = history.filter(check => check.healthy).length;
    return Math.round((healthyChecks / history.length) * 100);
  }

  /**
   * Calculate failure rate for recent checks
   * @param {Array} recentChecks - Recent health checks
   * @returns {number} - Failure rate percentage
   */
  calculateFailureRate(recentChecks) {
    if (recentChecks.length === 0) return 0;
    const failureCount = recentChecks.filter(check => !check.healthy).length;
    return Math.round((failureCount / recentChecks.length) * 100);
  }

  /**
   * Get health statistics for a specific server
   * @param {string} serverId - Server ID
   * @returns {Object|null} - Server health stats or null if not found
   */
  getServerHealthStats(serverId) {
    const history = this.healthHistory.get(serverId);
    if (!history || history.length === 0) return null;

    const latestCheck = history[history.length - 1];
    const recentChecks = history.slice(-10);

    return {
      serverId,
      healthy: latestCheck.healthy,
      lastCheck: latestCheck.timestamp,
      responseTime: latestCheck.responseTime,
      uptime: this.calculateUptime(history),
      failureRate: this.calculateFailureRate(recentChecks),
      consecutiveFailures: this.getConsecutiveFailures(history),
      totalChecks: history.length,
      averageResponseTime: this.calculateAverageResponseTime(history),
      authError: latestCheck.authError || false
    };
  }

  /**
   * Calculate average response time
   * @param {Array} history - Health history
   * @returns {number} - Average response time in ms
   */
  calculateAverageResponseTime(history) {
    const healthyChecks = history.filter(check => check.healthy && check.responseTime);
    if (healthyChecks.length === 0) return 0;
    
    const totalTime = healthyChecks.reduce((sum, check) => sum + check.responseTime, 0);
    return Math.round(totalTime / healthyChecks.length);
  }
}

module.exports = HealthMonitor;