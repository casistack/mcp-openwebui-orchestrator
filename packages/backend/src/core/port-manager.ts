export interface PortAllocation {
  serverId: string;
  port: number;
}

export interface PortStats {
  totalPorts: number;
  allocatedCount: number;
  availableCount: number;
  utilizationPercent: number;
}

export class PortManager {
  private readonly startPort: number;
  private readonly endPort: number;
  private readonly allocatedPorts: Set<number>;
  private readonly serverPorts: Map<string, number>;

  constructor(startPort = 4000, endPort = 4100) {
    this.startPort = startPort;
    this.endPort = endPort;
    this.allocatedPorts = new Set();
    this.serverPorts = new Map();
  }

  allocatePort(serverId: string): number | null {
    if (this.serverPorts.has(serverId)) {
      return this.serverPorts.get(serverId)!;
    }

    for (let port = this.startPort; port <= this.endPort; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        this.serverPorts.set(serverId, port);
        console.log(`Allocated port ${port} for server ${serverId}`);
        return port;
      }
    }

    console.error(`No available ports in range ${this.startPort}-${this.endPort}`);
    return null;
  }

  deallocatePort(serverId: string): void {
    const port = this.serverPorts.get(serverId);
    if (port) {
      this.allocatedPorts.delete(port);
      this.serverPorts.delete(serverId);
      console.log(`Deallocated port ${port} for server ${serverId}`);
    }
  }

  getPort(serverId: string): number | null {
    return this.serverPorts.get(serverId) ?? null;
  }

  getAllocatedPorts(): PortAllocation[] {
    return Array.from(this.serverPorts.entries()).map(([serverId, port]) => ({
      serverId,
      port,
    }));
  }

  isPortAvailable(port: number): boolean {
    return port >= this.startPort && port <= this.endPort && !this.allocatedPorts.has(port);
  }

  getStats(): PortStats {
    const totalPorts = this.endPort - this.startPort + 1;
    const allocatedCount = this.allocatedPorts.size;
    const availableCount = totalPorts - allocatedCount;

    return {
      totalPorts,
      allocatedCount,
      availableCount,
      utilizationPercent: Math.round((allocatedCount / totalPorts) * 100),
    };
  }
}
