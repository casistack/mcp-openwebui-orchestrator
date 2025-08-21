class PortManager {
  constructor(startPort = 4000, endPort = 4100) {
    this.startPort = startPort;
    this.endPort = endPort;
    this.allocatedPorts = new Set();
    this.serverPorts = new Map(); // serverId -> port mapping
  }

  allocatePort(serverId) {
    // If server already has a port, return it
    if (this.serverPorts.has(serverId)) {
      return this.serverPorts.get(serverId);
    }

    // Find next available port
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

  deallocatePort(serverId) {
    const port = this.serverPorts.get(serverId);
    if (port) {
      this.allocatedPorts.delete(port);
      this.serverPorts.delete(serverId);
      console.log(`Deallocated port ${port} for server ${serverId}`);
    }
  }

  getPort(serverId) {
    return this.serverPorts.get(serverId) || null;
  }

  getAllocatedPorts() {
    return Array.from(this.serverPorts.entries()).map(([serverId, port]) => ({
      serverId,
      port
    }));
  }

  isPortAvailable(port) {
    return port >= this.startPort && port <= this.endPort && !this.allocatedPorts.has(port);
  }

  /**
   * Get usage statistics
   * @returns {Object} - Usage stats
   */
  getStats() {
    const totalPorts = this.endPort - this.startPort + 1;
    const allocatedCount = this.allocatedPorts.size;
    const availableCount = totalPorts - allocatedCount;

    return {
      totalPorts,
      allocatedCount,
      availableCount,
      utilizationPercent: Math.round((allocatedCount / totalPorts) * 100)
    };
  }
}

module.exports = PortManager;