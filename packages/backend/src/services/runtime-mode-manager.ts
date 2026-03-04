import { EventEmitter } from 'events';
import type { ServerRuntimeService } from './server-runtime-service.js';
import type { UnifiedRuntimeService } from './unified-runtime-service.js';
import type { MultiTransportService, TransportConfig } from './multi-transport-service.js';
import type { AppDatabase } from '@mcp-platform/db';
import { runtimeConfig, eq } from '@mcp-platform/db';

export type RuntimeMode = 'individual' | 'unified' | 'multi-transport';

export interface RuntimeModeStatus {
  mode: RuntimeMode;
  individual?: {
    running: number;
    total: number;
  };
  unified?: {
    running: boolean;
    healthy: boolean;
    port: number | null;
  };
  multiTransport?: {
    transports: TransportConfig;
    processes: number;
    healthy: number;
  };
}

export class RuntimeModeManager extends EventEmitter {
  private currentMode: RuntimeMode = 'individual';

  constructor(
    private individualService: ServerRuntimeService,
    private unifiedService: UnifiedRuntimeService,
    private multiTransportService: MultiTransportService,
    private db: AppDatabase,
  ) {
    super();
  }

  async initialize(): Promise<void> {
    // Load persisted mode from DB
    const config = this.loadConfig();
    if (config) {
      this.currentMode = config.mode as RuntimeMode;
      if (config.enabledTransports) {
        try {
          const transports = JSON.parse(config.enabledTransports);
          this.multiTransportService.setTransportConfig(transports);
        } catch { /* use defaults */ }
      }
    }
  }

  getMode(): RuntimeMode {
    return this.currentMode;
  }

  async switchMode(newMode: RuntimeMode): Promise<void> {
    if (newMode === this.currentMode) return;

    console.log(`[mode-manager] Switching from ${this.currentMode} to ${newMode}`);

    // Stop current mode
    await this.stopCurrentMode();

    // Update state
    const previousMode = this.currentMode;
    this.currentMode = newMode;
    this.persistConfig();

    // Start new mode
    await this.startCurrentMode();

    this.emit('mode:switched', { from: previousMode, to: newMode });
    console.log(`[mode-manager] Mode switched to ${newMode}`);
  }

  async start(): Promise<void> {
    await this.startCurrentMode();
  }

  async stop(): Promise<void> {
    await this.stopCurrentMode();
  }

  async startAll(): Promise<{ started: number; failed: number }> {
    switch (this.currentMode) {
      case 'individual':
        return this.individualService.startAll();
      case 'unified': {
        const ok = await this.unifiedService.start();
        return { started: ok ? 1 : 0, failed: ok ? 0 : 1 };
      }
      case 'multi-transport':
        return this.multiTransportService.start();
    }
  }

  async stopAll(): Promise<void> {
    switch (this.currentMode) {
      case 'individual':
        await this.individualService.stopAll();
        break;
      case 'unified':
        await this.unifiedService.stop();
        break;
      case 'multi-transport':
        await this.multiTransportService.stop();
        break;
    }
  }

  startHealthMonitoring(): void {
    switch (this.currentMode) {
      case 'individual':
        this.individualService.startHealthMonitoring();
        break;
      case 'unified':
        this.unifiedService.startHealthMonitoring();
        break;
      case 'multi-transport':
        this.multiTransportService.startHealthMonitoring();
        break;
    }
  }

  async shutdown(): Promise<void> {
    switch (this.currentMode) {
      case 'individual':
        await this.individualService.shutdown();
        break;
      case 'unified':
        await this.unifiedService.shutdown();
        break;
      case 'multi-transport':
        await this.multiTransportService.shutdown();
        break;
    }
  }

  getStatus(): RuntimeModeStatus {
    const status: RuntimeModeStatus = { mode: this.currentMode };

    switch (this.currentMode) {
      case 'individual':
        status.individual = {
          running: this.individualService.listRunningProcesses().length,
          total: this.individualService.listRunningProcesses().length,
        };
        break;
      case 'unified':
        status.unified = this.unifiedService.getStatus();
        break;
      case 'multi-transport': {
        const transports = this.multiTransportService.getTransportStatus();
        status.multiTransport = {
          transports: this.multiTransportService.getTransportConfig(),
          processes: transports.length,
          healthy: transports.filter(t => t.healthy).length,
        };
        break;
      }
    }

    return status;
  }

  getTransportConfig(): TransportConfig {
    return this.multiTransportService.getTransportConfig();
  }

  async updateTransportConfig(config: Partial<TransportConfig>): Promise<void> {
    this.multiTransportService.setTransportConfig(config);
    this.persistConfig();

    // If in multi-transport mode, restart to apply changes
    if (this.currentMode === 'multi-transport') {
      await this.multiTransportService.stop();
      await this.multiTransportService.start();
    }
  }

  // Access to individual services when needed
  getIndividualService(): ServerRuntimeService {
    return this.individualService;
  }

  getUnifiedService(): UnifiedRuntimeService {
    return this.unifiedService;
  }

  getMultiTransportService(): MultiTransportService {
    return this.multiTransportService;
  }

  // --- Private ---

  private async startCurrentMode(): Promise<void> {
    switch (this.currentMode) {
      case 'individual':
        this.individualService.startHealthMonitoring();
        await this.individualService.startAll();
        break;
      case 'unified':
        await this.unifiedService.start();
        this.unifiedService.startHealthMonitoring();
        break;
      case 'multi-transport':
        await this.multiTransportService.start();
        this.multiTransportService.startHealthMonitoring();
        break;
    }
  }

  private async stopCurrentMode(): Promise<void> {
    switch (this.currentMode) {
      case 'individual':
        await this.individualService.shutdown();
        break;
      case 'unified':
        await this.unifiedService.shutdown();
        break;
      case 'multi-transport':
        await this.multiTransportService.shutdown();
        break;
    }
  }

  private loadConfig(): { mode: string; unifiedPort: number | null; enabledTransports: string | null } | null {
    try {
      const rows = this.db.select().from(runtimeConfig).all();
      if (rows.length === 0) return null;
      return rows[0] as { mode: string; unifiedPort: number | null; enabledTransports: string | null };
    } catch {
      return null;
    }
  }

  private persistConfig(): void {
    try {
      const transportsJson = JSON.stringify(this.multiTransportService.getTransportConfig());
      const existing = this.db.select().from(runtimeConfig).all();

      if (existing.length > 0) {
        this.db.update(runtimeConfig).set({
          mode: this.currentMode,
          enabledTransports: transportsJson,
          updatedAt: new Date(),
        }).where(eq(runtimeConfig.id, (existing[0] as { id: string }).id)).run();
      } else {
        this.db.insert(runtimeConfig).values({
          id: 'default',
          mode: this.currentMode,
          enabledTransports: transportsJson,
        }).run();
      }
    } catch (err) {
      console.error(`[mode-manager] Failed to persist config: ${(err as Error).message}`);
    }
  }
}
