import { SandboxService, type SandboxConfig } from '../services/sandbox-service.js';

describe('SandboxService', () => {
  let service: SandboxService;

  beforeEach(() => {
    service = new SandboxService(6000);
  });

  const baseConfig: SandboxConfig = {
    serverId: 'srv-1',
    serverName: 'test-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  };

  describe('generateDockerRunCommand', () => {
    it('should generate a valid docker run command', () => {
      const cmd = service.generateDockerRunCommand(baseConfig);
      expect(cmd).toContain('docker run -d');
      expect(cmd).toContain('--cpu-shares=256');
      expect(cmd).toContain('--memory=512m');
      expect(cmd).toContain('--pids-limit=100');
      expect(cmd).toContain('--security-opt=no-new-privileges:true');
      expect(cmd).toContain('--cap-drop=ALL');
      expect(cmd).toContain('node:22-slim');
      expect(cmd).toContain('npx');
      expect(cmd).toContain('-y');
    });

    it('should apply custom resource limits', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        resourceLimits: { cpuShares: 512, memoryMB: 1024, pidsLimit: 200 },
      });
      expect(cmd).toContain('--cpu-shares=512');
      expect(cmd).toContain('--memory=1024m');
      expect(cmd).toContain('--pids-limit=200');
    });

    it('should add read-only rootfs with tmpfs', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        resourceLimits: { readOnlyRootfs: true },
      });
      expect(cmd).toContain('--read-only');
      expect(cmd).toContain('--tmpfs');
    });

    it('should use gVisor runtime when specified', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        runtime: 'runsc',
      });
      expect(cmd).toContain('--runtime=runsc');
    });

    it('should not include port mapping for stdio transport', () => {
      const cmd = service.generateDockerRunCommand(baseConfig);
      expect(cmd).not.toMatch(/-p \d+:\d+/);
    });

    it('should include port mapping for non-stdio transport', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        transport: 'sse',
      });
      expect(cmd).toMatch(/-p \d+:\d+/);
    });

    it('should set network isolation', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        networkPolicy: { isolate: true },
      });
      expect(cmd).toContain('--network=none');
    });

    it('should set named network', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        networkPolicy: { networkName: 'mcp-ns-prod' },
      });
      expect(cmd).toContain('--network=mcp-ns-prod');
    });

    it('should include environment variables', () => {
      const cmd = service.generateDockerRunCommand({
        ...baseConfig,
        env: { API_KEY: 'secret123', LOG_LEVEL: 'debug' },
      });
      expect(cmd).toContain('-e API_KEY=secret123');
      expect(cmd).toContain('-e LOG_LEVEL=debug');
    });

    it('should track container info after generation', () => {
      service.generateDockerRunCommand(baseConfig);
      const info = service.getContainerInfo('srv-1');
      expect(info).not.toBeNull();
      expect(info!.serverName).toBe('test-server');
      expect(info!.status).toBe('created');
    });
  });

  describe('generateComposeService', () => {
    it('should generate valid compose service config', () => {
      const svc = service.generateComposeService(baseConfig);
      expect(svc.image).toBe('node:22-slim');
      expect(svc.container_name).toBe('mcp-test-server');
      expect(svc.restart).toBe('unless-stopped');
      expect(svc.cap_drop).toEqual(['ALL']);
      expect(svc.deploy).toBeDefined();
    });

    it('should include runtime for gVisor', () => {
      const svc = service.generateComposeService({ ...baseConfig, runtime: 'runsc' });
      expect(svc.runtime).toBe('runsc');
    });

    it('should include environment variables', () => {
      const svc = service.generateComposeService({
        ...baseConfig,
        env: { KEY: 'value' },
      });
      expect(svc.environment).toEqual({ KEY: 'value' });
    });
  });

  describe('generateNetworkCommand', () => {
    it('should generate docker network create command', () => {
      const cmd = service.generateNetworkCommand('production');
      expect(cmd).toBe('docker network create --driver bridge --internal mcp-ns-production');
    });
  });

  describe('generateNamespaceCompose', () => {
    it('should generate a full compose file for namespace', () => {
      const compose = service.generateNamespaceCompose('test-ns', [
        baseConfig,
        { ...baseConfig, serverId: 'srv-2', serverName: 'other-server' },
      ]);
      expect(compose.version).toBe('3.8');
      expect(compose.services).toBeDefined();
      const services = compose.services as Record<string, unknown>;
      expect(Object.keys(services)).toEqual(['test-server', 'other-server']);
      expect(compose.networks).toBeDefined();
      const networks = compose.networks as Record<string, unknown>;
      expect(networks['mcp-ns-test-ns']).toBeDefined();
    });
  });

  describe('container tracking', () => {
    it('should list all containers', () => {
      service.generateDockerRunCommand(baseConfig);
      service.generateDockerRunCommand({ ...baseConfig, serverId: 'srv-2', serverName: 'other' });
      expect(service.listContainers()).toHaveLength(2);
    });

    it('should update container status', () => {
      service.generateDockerRunCommand(baseConfig);
      service.updateContainerStatus('srv-1', 'running');
      expect(service.getContainerInfo('srv-1')!.status).toBe('running');
    });

    it('should update status with error', () => {
      service.generateDockerRunCommand(baseConfig);
      service.updateContainerStatus('srv-1', 'error', 'OOM killed');
      const info = service.getContainerInfo('srv-1')!;
      expect(info.status).toBe('error');
      expect(info.error).toBe('OOM killed');
    });

    it('should remove container', () => {
      service.generateDockerRunCommand(baseConfig);
      expect(service.removeContainer('srv-1')).toBe(true);
      expect(service.getContainerInfo('srv-1')).toBeNull();
    });

    it('should return false when removing non-existent container', () => {
      expect(service.removeContainer('ghost')).toBe(false);
    });

    it('should return null for non-existent container info', () => {
      expect(service.getContainerInfo('ghost')).toBeNull();
    });
  });

  describe('port allocation', () => {
    it('should allocate sequential ports', () => {
      service.generateDockerRunCommand({ ...baseConfig, serverId: 's1', transport: 'sse' });
      service.generateDockerRunCommand({ ...baseConfig, serverId: 's2', serverName: 's2', transport: 'sse' });
      const c1 = service.getContainerInfo('s1')!;
      const c2 = service.getContainerInfo('s2')!;
      expect(c2.port! - c1.port!).toBe(1);
    });
  });
});
