import { EventEmitter } from 'events';
import crypto from 'crypto';
import type { AppDatabase } from '@mcp-platform/db';
import { healthAlerts, eq, and, isNull, desc, gte } from '@mcp-platform/db';
import type { HealthService } from './health-service.js';

export type AlertType = 'consecutive_failures' | 'high_failure_rate' | 'slow_response' | 'auth_error' | 'resource_exhaustion' | 'process_crashed';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface HealthAlert {
  id: string;
  serverId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown> | null;
  remediation: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface AlertThresholds {
  consecutiveFailures: number;
  failureRatePercent: number;
  slowResponseMs: number;
  autoRemediateAfterFailures: number;
  autoRemediateFailureRatePercent: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  consecutiveFailures: 3,
  failureRatePercent: 80,
  slowResponseMs: 10_000,
  autoRemediateAfterFailures: 5,
  autoRemediateFailureRatePercent: 90,
};

export class AlertService extends EventEmitter {
  private thresholds: AlertThresholds;
  private consecutiveFailureTracker = new Map<string, number>();

  constructor(
    private db: AppDatabase,
    private healthService: HealthService,
    thresholds?: Partial<AlertThresholds>,
  ) {
    super();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  // Called by health monitoring after each check
  async evaluateHealth(serverId: string, healthy: boolean, responseTime: number | null): Promise<void> {
    if (healthy) {
      const prev = this.consecutiveFailureTracker.get(serverId) ?? 0;
      this.consecutiveFailureTracker.set(serverId, 0);

      // Resolve active alerts for this server if it recovered
      if (prev >= this.thresholds.consecutiveFailures) {
        await this.resolveAlertsForServer(serverId);
      }

      // Check for slow response
      if (responseTime !== null && responseTime > this.thresholds.slowResponseMs) {
        await this.createAlert({
          serverId,
          alertType: 'slow_response',
          severity: 'low',
          message: `Response time ${responseTime}ms exceeds threshold (${this.thresholds.slowResponseMs}ms)`,
          details: { responseTime, threshold: this.thresholds.slowResponseMs },
        });
      }
      return;
    }

    // Unhealthy
    const failures = (this.consecutiveFailureTracker.get(serverId) ?? 0) + 1;
    this.consecutiveFailureTracker.set(serverId, failures);

    if (failures === this.thresholds.consecutiveFailures) {
      await this.createAlert({
        serverId,
        alertType: 'consecutive_failures',
        severity: 'high',
        message: `${failures} consecutive health check failures`,
        details: { consecutiveFailures: failures },
      });
    }

    // Auto-remediation check
    if (failures >= this.thresholds.autoRemediateAfterFailures) {
      this.emit('alert:remediate', { serverId, reason: 'consecutive_failures', failures });
    }
  }

  // Called when auth error is detected
  async reportAuthError(serverId: string): Promise<void> {
    await this.createAlert({
      serverId,
      alertType: 'auth_error',
      severity: 'high',
      message: 'Authentication error detected (401/403) - manual intervention required',
      details: { requiresManualFix: true },
    });
  }

  // Called when a process crashes
  async reportProcessCrash(serverId: string, exitCode: number | null, restartCount: number): Promise<void> {
    const severity: AlertSeverity = restartCount >= 3 ? 'critical' : 'high';
    await this.createAlert({
      serverId,
      alertType: 'process_crashed',
      severity,
      message: `Process crashed (exit code: ${exitCode}, restart ${restartCount})`,
      details: { exitCode, restartCount },
      remediation: restartCount < 3 ? 'restarted' : 'max_restarts_exceeded',
    });
  }

  // --- Query Methods ---

  async getActiveAlerts(): Promise<HealthAlert[]> {
    const rows = await this.db
      .select()
      .from(healthAlerts)
      .where(isNull(healthAlerts.resolvedAt))
      .orderBy(desc(healthAlerts.createdAt));
    return rows.map(this.mapAlert);
  }

  async getAlertsForServer(serverId: string, limit = 50): Promise<HealthAlert[]> {
    const rows = await this.db
      .select()
      .from(healthAlerts)
      .where(eq(healthAlerts.serverId, serverId))
      .orderBy(desc(healthAlerts.createdAt))
      .limit(limit);
    return rows.map(this.mapAlert);
  }

  async getRecentAlerts(hours = 24, limit = 100): Promise<HealthAlert[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await this.db
      .select()
      .from(healthAlerts)
      .where(gte(healthAlerts.createdAt, since))
      .orderBy(desc(healthAlerts.createdAt))
      .limit(limit);
    return rows.map(this.mapAlert);
  }

  async resolveAlert(alertId: string): Promise<void> {
    this.db.update(healthAlerts)
      .set({ resolvedAt: new Date() })
      .where(eq(healthAlerts.id, alertId))
      .run();
  }

  async resolveAlertsForServer(serverId: string): Promise<void> {
    this.db.update(healthAlerts)
      .set({ resolvedAt: new Date() })
      .where(and(
        eq(healthAlerts.serverId, serverId),
        isNull(healthAlerts.resolvedAt),
      ))
      .run();
  }

  // --- Private ---

  private async createAlert(params: {
    serverId: string;
    alertType: AlertType;
    severity: AlertSeverity;
    message: string;
    details?: Record<string, unknown>;
    remediation?: string;
  }): Promise<void> {
    const alert: HealthAlert = {
      id: crypto.randomUUID(),
      serverId: params.serverId,
      alertType: params.alertType,
      severity: params.severity,
      message: params.message,
      details: params.details ?? null,
      remediation: params.remediation ?? null,
      resolvedAt: null,
      createdAt: new Date(),
    };

    this.db.insert(healthAlerts).values({
      id: alert.id,
      serverId: alert.serverId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      details: alert.details,
      remediation: alert.remediation,
    }).run();

    this.emit('alert:created', alert);
  }

  private mapAlert(row: Record<string, unknown>): HealthAlert {
    return {
      id: row.id as string,
      serverId: row.serverId as string,
      alertType: row.alertType as AlertType,
      severity: row.severity as AlertSeverity,
      message: row.message as string,
      details: row.details as Record<string, unknown> | null,
      remediation: row.remediation as string | null,
      resolvedAt: row.resolvedAt as Date | null,
      createdAt: (row.createdAt as Date) ?? new Date(),
    };
  }
}
