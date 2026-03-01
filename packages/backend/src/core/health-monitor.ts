import cron from 'node-cron';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface HealthStatus {
  timestamp: Date;
  serverId: string;
  port: number;
  healthy: boolean;
  responseTime: number | null;
  error: string | null;
  statusCode: number | null;
  endpoint?: string;
  authError?: boolean;
}

interface AlertThresholds {
  consecutiveFailures: number;
  failureRate: number;
  responseTime: number;
}

interface Alert {
  timestamp: Date;
  type: string;
  serverId: string;
  details: Record<string, unknown>;
  severity: string;
}

interface ServerReport {
  serverId: string;
  healthy: boolean;
  lastCheck: Date | undefined;
  responseTime: number | null | undefined;
  uptime: number;
  failureRate: number;
  consecutiveFailures: number;
  authError: boolean;
}

interface HealthReport {
  timestamp: Date;
  totalProxies: number;
  healthyProxies: number;
  unhealthyProxies: number;
  averageResponseTime: number;
  servers: Record<string, ServerReport>;
}

interface ProxyStatus {
  serverId: string;
  port: number;
  healthy?: boolean;
  status?: string;
}

interface ProxyManagerLike {
  getProxyStatuses(): ProxyStatus[];
  restartProxy(serverId: string): Promise<boolean>;
}

interface ConfigParserLike {
  getMCPServers(): Promise<Array<{ id: string; needsProxy?: boolean }>>;
}

const ALERT_LOG_PATH = '/var/log/mcp-proxy-manager/alerts.log';
const MAX_HISTORY_SIZE = 100;

const SEVERITY_MAP: Record<string, string> = {
  'consecutive_failures': 'HIGH',
  'high_failure_rate': 'MEDIUM',
  'slow_response': 'LOW',
};

export class HealthMonitor {
  private readonly proxyManager: ProxyManagerLike;
  private readonly configParser: ConfigParserLike | null;
  private readonly healthHistory: Map<string, HealthStatus[]>;
  private readonly maxHistorySize: number;
  private readonly alertThresholds: AlertThresholds;
  private cronJob: ReturnType<typeof cron.schedule> | null;

  constructor(proxyManager: ProxyManagerLike, configParser: ConfigParserLike | null = null) {
    this.proxyManager = proxyManager;
    this.configParser = configParser;
    this.healthHistory = new Map();
    this.maxHistorySize = MAX_HISTORY_SIZE;
    this.alertThresholds = {
      consecutiveFailures: 3,
      failureRate: 0.8,
      responseTime: 10000,
    };
    this.cronJob = null;
  }

  startMonitoring(schedule = '*/30 * * * * *'): void {
    if (this.cronJob) {
      console.log('Health monitoring already running');
      return;
    }

    this.cronJob = cron.schedule(schedule, async () => {
      await this.performHealthChecks();
    }, { timezone: 'UTC' });

    console.log(`Health monitoring started with schedule: ${schedule}`);
  }

  stopMonitoring(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('Health monitoring stopped');
    }
  }

  async performHealthChecks(): Promise<void> {
    const proxies = this.proxyManager.getProxyStatuses();
    const timestamp = new Date();

    console.log(`Performing health checks for ${proxies.length} proxies`);

    for (const proxy of proxies) {
      await this.checkProxyHealth(proxy.serverId, proxy.port, timestamp);
    }

    this.generateHealthReport();
  }

  async checkProxyHealth(serverId: string, port: number, timestamp: Date): Promise<void> {
    const startTime = Date.now();
    const healthStatus: HealthStatus = {
      timestamp,
      serverId,
      port,
      healthy: false,
      responseTime: null,
      error: null,
      statusCode: null,
    };

    try {
      const endpoints = [
        { url: `http://localhost:${port}/openapi.json`, name: 'openapi', expectedStatus: 200 },
        { url: `http://localhost:${port}/docs`, name: 'docs', expectedStatus: 200 },
        { url: `http://localhost:${port}/`, name: 'root', expectedStatus: 200 },
      ];

      let success = false;
      let lastError: Error | null = null;
      let hasAuthError = false;

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint.url, {
            timeout: this.alertThresholds.responseTime,
            validateStatus: (status: number) => status === endpoint.expectedStatus,
          });

          healthStatus.healthy = true;
          healthStatus.responseTime = Date.now() - startTime;
          healthStatus.statusCode = response.status;
          healthStatus.endpoint = endpoint.name;
          success = true;
          break;
        } catch (endpointError: unknown) {
          lastError = endpointError as Error;
          const axiosErr = endpointError as { response?: { status?: number } };
          if (axiosErr.response?.status === 401) {
            hasAuthError = true;
            healthStatus.statusCode = 401;
            healthStatus.authError = true;
          }
        }
      }

      if (!success) {
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
      healthStatus.error = (error as Error).message;
      const axiosErr = error as { response?: { status?: number } };
      healthStatus.statusCode = axiosErr.response?.status ?? null;
    }

    this.storeHealthHistory(serverId, healthStatus);
    await this.checkAlerts(serverId);
  }

  private storeHealthHistory(serverId: string, healthStatus: HealthStatus): void {
    if (!this.healthHistory.has(serverId)) {
      this.healthHistory.set(serverId, []);
    }

    const history = this.healthHistory.get(serverId)!;
    history.push(healthStatus);

    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  private async checkAlerts(serverId: string): Promise<void> {
    const history = this.healthHistory.get(serverId) || [];
    if (history.length === 0) return;

    const recentChecks = history.slice(-10);
    const latestCheck = history[history.length - 1];

    const consecutiveFailures = this.getConsecutiveFailures(history);
    if (consecutiveFailures >= this.alertThresholds.consecutiveFailures) {
      await this.handleAlert('consecutive_failures', serverId, {
        consecutiveFailures,
        threshold: this.alertThresholds.consecutiveFailures,
      });
    }

    const failureCount = recentChecks.filter(check => !check.healthy).length;
    const failureRate = failureCount / recentChecks.length;
    if (failureRate >= this.alertThresholds.failureRate) {
      await this.handleAlert('high_failure_rate', serverId, {
        failureRate: Math.round(failureRate * 100),
        threshold: Math.round(this.alertThresholds.failureRate * 100),
        recentChecks: recentChecks.length,
      });
    }

    if (latestCheck.healthy && latestCheck.responseTime && latestCheck.responseTime > this.alertThresholds.responseTime) {
      await this.handleAlert('slow_response', serverId, {
        responseTime: latestCheck.responseTime,
        threshold: this.alertThresholds.responseTime,
      });
    }
  }

  getConsecutiveFailures(history: HealthStatus[]): number {
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

  private async handleAlert(alertType: string, serverId: string, details: Record<string, unknown>): Promise<void> {
    const alert: Alert = {
      timestamp: new Date(),
      type: alertType,
      serverId,
      details,
      severity: this.getAlertSeverity(alertType),
    };

    console.warn(`ALERT [${alert.severity}]: ${alertType} for ${serverId}`, details);
    this.logAlert(alert);
    await this.attemptRemediation(alertType, serverId, details);
  }

  getAlertSeverity(alertType: string): string {
    return SEVERITY_MAP[alertType] || 'MEDIUM';
  }

  private async attemptRemediation(alertType: string, serverId: string, details: Record<string, unknown>): Promise<void> {
    const history = this.healthHistory.get(serverId) || [];
    const latestCheck = history[history.length - 1];

    if (latestCheck?.authError) {
      console.log(`Skipping remediation for ${serverId} - server has authentication errors`);
      return;
    }

    switch (alertType) {
      case 'consecutive_failures':
        if ((details.consecutiveFailures as number) >= 5) {
          console.log(`Attempting restart for ${serverId} due to consecutive failures`);
          await this.proxyManager.restartProxy(serverId);
        }
        break;

      case 'high_failure_rate':
        if ((details.failureRate as number) >= 90) {
          console.log(`Attempting restart for ${serverId} due to high failure rate`);
          await this.proxyManager.restartProxy(serverId);
        }
        break;
    }
  }

  private logAlert(alert: Alert): void {
    try {
      const logDir = path.dirname(ALERT_LOG_PATH);

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logEntry = `${alert.timestamp.toISOString()} [${alert.severity}] ${alert.type} - ${alert.serverId}: ${JSON.stringify(alert.details)}\n`;
      fs.appendFileSync(ALERT_LOG_PATH, logEntry);
    } catch (error) {
      console.error('Failed to log alert:', (error as Error).message);
    }
  }

  generateHealthReport(): HealthReport {
    const report: HealthReport = {
      timestamp: new Date(),
      totalProxies: this.healthHistory.size,
      healthyProxies: 0,
      unhealthyProxies: 0,
      averageResponseTime: 0,
      servers: {},
    };

    let totalResponseTime = 0;
    let responsiveServers = 0;

    for (const [serverId, history] of this.healthHistory) {
      const latestCheck = history[history.length - 1];
      const recentChecks = history.slice(-10);

      const serverReport: ServerReport = {
        serverId,
        healthy: latestCheck?.healthy || false,
        lastCheck: latestCheck?.timestamp,
        responseTime: latestCheck?.responseTime,
        uptime: this.calculateUptime(history),
        failureRate: this.calculateFailureRate(recentChecks),
        consecutiveFailures: this.getConsecutiveFailures(history),
        authError: latestCheck?.authError || false,
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

    console.log(`Health Report: ${report.healthyProxies}/${report.totalProxies} healthy, avg response: ${report.averageResponseTime}ms`);

    return report;
  }

  calculateUptime(history: HealthStatus[]): number {
    if (history.length === 0) return 0;
    const healthyChecks = history.filter(check => check.healthy).length;
    return Math.round((healthyChecks / history.length) * 100);
  }

  calculateFailureRate(recentChecks: HealthStatus[]): number {
    if (recentChecks.length === 0) return 0;
    const failureCount = recentChecks.filter(check => !check.healthy).length;
    return Math.round((failureCount / recentChecks.length) * 100);
  }

  getServerHealthStats(serverId: string) {
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
      authError: latestCheck.authError || false,
    };
  }

  calculateAverageResponseTime(history: HealthStatus[]): number {
    const healthyChecks = history.filter(check => check.healthy && check.responseTime);
    if (healthyChecks.length === 0) return 0;

    const totalTime = healthyChecks.reduce((sum, check) => sum + (check.responseTime || 0), 0);
    return Math.round(totalTime / healthyChecks.length);
  }
}
