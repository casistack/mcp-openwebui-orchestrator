import crypto from 'crypto';
import { healthRecords, auditLogs, type AppDatabase, eq, desc, and, gte, sql, count } from '@mcp-platform/db';

export interface HealthRecord {
  id: string;
  serverId: string;
  healthy: boolean;
  responseTime: number | null;
  error: string | null;
  checkedAt: Date;
}

export interface HealthStats {
  serverId: string;
  totalChecks: number;
  healthyChecks: number;
  uptimePercent: number;
  avgResponseTime: number | null;
  maxResponseTime: number | null;
  minResponseTime: number | null;
  lastCheckedAt: Date | null;
}

/**
 * Persists health check results and provides aggregation queries.
 */
export class HealthService {
  constructor(private db: AppDatabase) {}

  /**
   * Record a health check result.
   */
  async recordHealth(entry: {
    serverId: string;
    healthy: boolean;
    responseTime?: number | null;
    error?: string | null;
  }): Promise<void> {
    await this.db.insert(healthRecords).values({
      id: crypto.randomUUID(),
      serverId: entry.serverId,
      healthy: entry.healthy,
      responseTime: entry.responseTime ?? null,
      error: entry.error ?? null,
    });
  }

  /**
   * Get recent health records for a server.
   */
  async getRecentHealth(serverId: string, limit = 50): Promise<HealthRecord[]> {
    const rows = await this.db
      .select()
      .from(healthRecords)
      .where(eq(healthRecords.serverId, serverId))
      .orderBy(desc(healthRecords.checkedAt))
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      serverId: r.serverId,
      healthy: r.healthy,
      responseTime: r.responseTime,
      error: r.error,
      checkedAt: r.checkedAt ?? new Date(),
    }));
  }

  /**
   * Get aggregated health stats for a server over a time window.
   */
  async getHealthStats(serverId: string, hours = 24): Promise<HealthStats> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        totalChecks: count(),
        healthyChecks: sql<number>`SUM(CASE WHEN ${healthRecords.healthy} = 1 THEN 1 ELSE 0 END)`,
        avgResponseTime: sql<number>`AVG(${healthRecords.responseTime})`,
        maxResponseTime: sql<number>`MAX(${healthRecords.responseTime})`,
        minResponseTime: sql<number>`MIN(${healthRecords.responseTime})`,
        lastCheckedAt: sql<Date>`MAX(${healthRecords.checkedAt})`,
      })
      .from(healthRecords)
      .where(and(
        eq(healthRecords.serverId, serverId),
        gte(healthRecords.checkedAt, since),
      ));

    const row = rows[0];
    const total = row?.totalChecks ?? 0;
    const healthy = row?.healthyChecks ?? 0;

    return {
      serverId,
      totalChecks: total,
      healthyChecks: healthy,
      uptimePercent: total > 0 ? Math.round((healthy / total) * 10000) / 100 : 0,
      avgResponseTime: row?.avgResponseTime ? Math.round(row.avgResponseTime) : null,
      maxResponseTime: row?.maxResponseTime ?? null,
      minResponseTime: row?.minResponseTime ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
    };
  }

  /**
   * Get health stats for all servers that have records.
   */
  async getAllHealthStats(hours = 24): Promise<HealthStats[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        serverId: healthRecords.serverId,
        totalChecks: count(),
        healthyChecks: sql<number>`SUM(CASE WHEN ${healthRecords.healthy} = 1 THEN 1 ELSE 0 END)`,
        avgResponseTime: sql<number>`AVG(${healthRecords.responseTime})`,
        maxResponseTime: sql<number>`MAX(${healthRecords.responseTime})`,
        minResponseTime: sql<number>`MIN(${healthRecords.responseTime})`,
        lastCheckedAt: sql<Date>`MAX(${healthRecords.checkedAt})`,
      })
      .from(healthRecords)
      .where(gte(healthRecords.checkedAt, since))
      .groupBy(healthRecords.serverId);

    return rows.map(row => ({
      serverId: row.serverId,
      totalChecks: row.totalChecks ?? 0,
      healthyChecks: row.healthyChecks ?? 0,
      uptimePercent: row.totalChecks
        ? Math.round(((row.healthyChecks ?? 0) / row.totalChecks) * 10000) / 100
        : 0,
      avgResponseTime: row.avgResponseTime ? Math.round(row.avgResponseTime) : null,
      maxResponseTime: row.maxResponseTime ?? null,
      minResponseTime: row.minResponseTime ?? null,
      lastCheckedAt: row.lastCheckedAt ?? null,
    }));
  }

  /**
   * Get health time-series data for a server (for charts).
   * Returns records ordered chronologically.
   */
  async getHealthTimeSeries(serverId: string, hours = 24, limit = 100): Promise<HealthRecord[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.db
      .select()
      .from(healthRecords)
      .where(and(
        eq(healthRecords.serverId, serverId),
        gte(healthRecords.checkedAt, since),
      ))
      .orderBy(healthRecords.checkedAt)
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      serverId: r.serverId,
      healthy: r.healthy,
      responseTime: r.responseTime,
      error: r.error,
      checkedAt: r.checkedAt ?? new Date(),
    }));
  }

  /**
   * Clean up old health records (retention policy).
   */
  async cleanupOldRecords(daysToKeep = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const result = await this.db
      .delete(healthRecords)
      .where(sql`${healthRecords.checkedAt} < ${cutoff}`);
    return result.changes ?? 0;
  }
}
