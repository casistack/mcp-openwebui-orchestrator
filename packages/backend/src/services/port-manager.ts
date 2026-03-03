export class PortManager {
  private allocatedPorts = new Set<number>();
  private serverPorts = new Map<string, number>();
  private readonly startPort: number;
  private readonly endPort: number;

  constructor(
    startPort?: number,
    endPort?: number,
  ) {
    this.startPort = startPort ?? parseInt(process.env.PORT_RANGE_START ?? '4200', 10);
    this.endPort = endPort ?? parseInt(process.env.PORT_RANGE_END ?? '4300', 10);
  }

  allocatePort(serverId: string): number | null {
    const existing = this.serverPorts.get(serverId);
    if (existing !== undefined) return existing;

    for (let port = this.startPort; port <= this.endPort; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        this.serverPorts.set(serverId, port);
        return port;
      }
    }
    return null;
  }

  deallocatePort(serverId: string): void {
    const port = this.serverPorts.get(serverId);
    if (port !== undefined) {
      this.allocatedPorts.delete(port);
      this.serverPorts.delete(serverId);
    }
  }

  getPort(serverId: string): number | null {
    return this.serverPorts.get(serverId) ?? null;
  }

  getAllocatedPorts(): Array<{ serverId: string; port: number }> {
    return Array.from(this.serverPorts.entries()).map(([serverId, port]) => ({ serverId, port }));
  }

  isPortAvailable(port: number): boolean {
    return port >= this.startPort && port <= this.endPort && !this.allocatedPorts.has(port);
  }

  getStats(): { totalPorts: number; allocatedCount: number; availableCount: number; utilization: number } {
    const totalPorts = this.endPort - this.startPort + 1;
    const allocatedCount = this.allocatedPorts.size;
    return {
      totalPorts,
      allocatedCount,
      availableCount: totalPorts - allocatedCount,
      utilization: totalPorts > 0 ? Math.round((allocatedCount / totalPorts) * 100) : 0,
    };
  }
}
