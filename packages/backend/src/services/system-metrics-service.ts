import os from 'os';
import type { AppDatabase } from '@mcp-platform/db';
import { healthRecords, serverRuntimeLogs, auditLogs } from '@mcp-platform/db';
import type { ConnectionManager } from './connection-manager.js';
import type { ServerRuntimeService } from './server-runtime-service.js';

export interface SystemMetrics {
  system: {
    uptime: number;
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuCount: number;
    cpuUsage: NodeJS.CpuUsage;
    memoryUsage: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
      freeSystem: number;
      totalSystem: number;
      usedPercent: number;
    };
    loadAverage: number[];
  };
  database: {
    healthRecordCount: number;
    runtimeLogCount: number;
    auditLogCount: number;
  };
  connections: {
    total: number;
    connected: number;
    errored: number;
  };
  runtime: {
    enabled: boolean;
    runningProcesses: number;
    healthyProcesses: number;
  };
  timestamp: string;
}

export class SystemMetricsService {
  private startTime = Date.now();

  constructor(
    private db: AppDatabase,
    private connectionManager?: ConnectionManager | null,
    private serverRuntimeService?: ServerRuntimeService | null,
  ) {}

  async getMetrics(): Promise<SystemMetrics> {
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();

    // DB counts — use raw count queries for efficiency
    let healthRecordCount = 0;
    let runtimeLogCount = 0;
    let auditLogCount = 0;

    try {
      const hr = await this.db.select().from(healthRecords);
      healthRecordCount = hr.length;
    } catch { /* table may not exist yet */ }

    try {
      const rl = await this.db.select().from(serverRuntimeLogs);
      runtimeLogCount = rl.length;
    } catch { /* table may not exist yet */ }

    try {
      const al = await this.db.select().from(auditLogs);
      auditLogCount = al.length;
    } catch { /* table may not exist yet */ }

    // Connection stats
    const connections = this.connectionManager?.listConnections() ?? [];
    const connectedCount = connections.filter(c => c.status === 'connected').length;
    const erroredCount = connections.filter(c => c.status === 'error').length;

    // Runtime stats
    const runtimeEnabled = !!this.serverRuntimeService;
    let runningProcesses = 0;
    let healthyProcesses = 0;
    if (this.serverRuntimeService) {
      const procs = this.serverRuntimeService.listRunningProcesses();
      runningProcesses = procs.length;
      healthyProcesses = procs.filter(p => p.healthy).length;
    }

    return {
      system: {
        uptime: Math.round((Date.now() - this.startTime) / 1000),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
        cpuUsage: process.cpuUsage(),
        memoryUsage: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          freeSystem: freeMem,
          totalSystem: totalMem,
          usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        },
        loadAverage: os.loadavg(),
      },
      database: {
        healthRecordCount,
        runtimeLogCount,
        auditLogCount,
      },
      connections: {
        total: connections.length,
        connected: connectedCount,
        errored: erroredCount,
      },
      runtime: {
        enabled: runtimeEnabled,
        runningProcesses,
        healthyProcesses,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
