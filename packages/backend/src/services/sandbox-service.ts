import crypto from 'crypto';

/**
 * Container sandbox configuration for an MCP server.
 */
export interface SandboxConfig {
  serverId: string;
  serverName: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  resourceLimits?: ResourceLimits;
  networkPolicy?: NetworkPolicy;
  runtime?: 'runc' | 'runsc';
}

export interface ResourceLimits {
  cpuShares?: number;
  memoryMB?: number;
  pidsLimit?: number;
  readOnlyRootfs?: boolean;
  noNewPrivileges?: boolean;
}

export interface NetworkPolicy {
  networkName?: string;
  isolate?: boolean;
  allowedHosts?: string[];
}

export interface ContainerInfo {
  containerId: string;
  serverName: string;
  status: 'created' | 'running' | 'stopped' | 'error';
  port?: number;
  networkName?: string;
  createdAt: Date;
  error?: string;
}

const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = {
  cpuShares: 256,
  memoryMB: 512,
  pidsLimit: 100,
  readOnlyRootfs: false,
  noNewPrivileges: true,
};

/**
 * SandboxService manages Docker container isolation for MCP servers.
 * Each server can run in its own container with resource limits,
 * network segmentation, and optional gVisor runtime.
 *
 * This is a foundation service that generates container configurations
 * and docker-compose fragments. Actual container lifecycle management
 * uses Docker CLI or Docker API via child_process.
 */
export class SandboxService {
  private containers = new Map<string, ContainerInfo>();
  private basePort: number;
  private portCounter: number;

  constructor(basePort = 5000) {
    this.basePort = basePort;
    this.portCounter = 0;
  }

  private allocatePort(): number {
    return this.basePort + this.portCounter++;
  }

  /**
   * Generate a Docker run command for sandboxing an MCP server.
   */
  generateDockerRunCommand(config: SandboxConfig): string {
    const limits = { ...DEFAULT_RESOURCE_LIMITS, ...config.resourceLimits };
    const containerName = `mcp-${config.serverName}-${crypto.randomUUID().slice(0, 8)}`;
    const port = this.allocatePort();

    const parts: string[] = ['docker', 'run', '-d', '--name', containerName];

    // Resource limits
    parts.push(`--cpu-shares=${limits.cpuShares}`);
    parts.push(`--memory=${limits.memoryMB}m`);
    parts.push(`--pids-limit=${limits.pidsLimit}`);

    if (limits.readOnlyRootfs) {
      parts.push('--read-only');
      parts.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
    }

    if (limits.noNewPrivileges) {
      parts.push('--security-opt=no-new-privileges:true');
    }

    // Runtime (gVisor support)
    if (config.runtime === 'runsc') {
      parts.push('--runtime=runsc');
    }

    // Network isolation
    const network = config.networkPolicy;
    if (network?.networkName) {
      parts.push(`--network=${network.networkName}`);
    } else if (network?.isolate) {
      parts.push('--network=none');
    }

    // Environment variables
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        parts.push('-e', `${key}=${value}`);
      }
    }

    // Port mapping for network-accessible servers
    if (config.transport !== 'stdio') {
      parts.push('-p', `${port}:${port}`);
    }

    // Drop all capabilities and add back only what's needed
    parts.push('--cap-drop=ALL');

    // Health check
    parts.push(
      '--health-cmd', 'curl -f http://localhost:${port}/health || exit 1',
      '--health-interval', '30s',
      '--health-timeout', '5s',
      '--health-retries', '3',
    );

    // Base image and command
    parts.push('node:22-slim');

    if (config.command) {
      parts.push(config.command);
      if (config.args?.length) {
        parts.push(...config.args);
      }
    }

    const info: ContainerInfo = {
      containerId: containerName,
      serverName: config.serverName,
      status: 'created',
      port,
      networkName: network?.networkName,
      createdAt: new Date(),
    };
    this.containers.set(config.serverId, info);

    return parts.join(' ');
  }

  /**
   * Generate a docker-compose service fragment for a sandboxed MCP server.
   */
  generateComposeService(config: SandboxConfig): Record<string, unknown> {
    const limits = { ...DEFAULT_RESOURCE_LIMITS, ...config.resourceLimits };
    const port = this.allocatePort();

    const service: Record<string, unknown> = {
      image: 'node:22-slim',
      container_name: `mcp-${config.serverName}`,
      restart: 'unless-stopped',
      deploy: {
        resources: {
          limits: {
            cpus: String(limits.cpuShares / 1024),
            memory: `${limits.memoryMB}M`,
            pids: limits.pidsLimit,
          },
        },
      },
      security_opt: limits.noNewPrivileges ? ['no-new-privileges:true'] : [],
      cap_drop: ['ALL'],
      healthcheck: {
        test: ['CMD', 'curl', '-f', `http://localhost:${port}/health`],
        interval: '30s',
        timeout: '5s',
        retries: 3,
      },
    };

    if (config.runtime === 'runsc') {
      service.runtime = 'runsc';
    }

    if (limits.readOnlyRootfs) {
      service.read_only = true;
      service.tmpfs = ['/tmp:size=64m'];
    }

    if (config.env && Object.keys(config.env).length > 0) {
      service.environment = config.env;
    }

    if (config.transport !== 'stdio') {
      service.ports = [`${port}:${port}`];
    }

    if (config.networkPolicy?.networkName) {
      service.networks = [config.networkPolicy.networkName];
    }

    if (config.command) {
      service.command = config.args?.length
        ? `${config.command} ${config.args.join(' ')}`
        : config.command;
    }

    const info: ContainerInfo = {
      containerId: `mcp-${config.serverName}`,
      serverName: config.serverName,
      status: 'created',
      port,
      networkName: config.networkPolicy?.networkName,
      createdAt: new Date(),
    };
    this.containers.set(config.serverId, info);

    return service;
  }

  /**
   * Generate a Docker network create command for namespace isolation.
   */
  generateNetworkCommand(namespaceName: string): string {
    const networkName = `mcp-ns-${namespaceName}`;
    return `docker network create --driver bridge --internal ${networkName}`;
  }

  /**
   * Get container info for a server.
   */
  getContainerInfo(serverId: string): ContainerInfo | null {
    return this.containers.get(serverId) ?? null;
  }

  /**
   * List all tracked containers.
   */
  listContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Update container status (called after docker inspect or health check).
   */
  updateContainerStatus(serverId: string, status: ContainerInfo['status'], error?: string) {
    const info = this.containers.get(serverId);
    if (info) {
      info.status = status;
      if (error) info.error = error;
    }
  }

  /**
   * Remove container tracking for a server.
   */
  removeContainer(serverId: string): boolean {
    return this.containers.delete(serverId);
  }

  /**
   * Generate a full docker-compose.yml for all servers in a namespace.
   */
  generateNamespaceCompose(
    namespaceName: string,
    configs: SandboxConfig[],
  ): Record<string, unknown> {
    const networkName = `mcp-ns-${namespaceName}`;
    const services: Record<string, unknown> = {};

    for (const config of configs) {
      const configWithNetwork: SandboxConfig = {
        ...config,
        networkPolicy: {
          ...config.networkPolicy,
          networkName,
        },
      };
      services[config.serverName] = this.generateComposeService(configWithNetwork);
    }

    return {
      version: '3.8',
      services,
      networks: {
        [networkName]: {
          driver: 'bridge',
          internal: true,
        },
      },
    };
  }
}
