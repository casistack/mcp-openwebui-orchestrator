import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MCPClient, type MCPClientConfig } from '../services/mcp-client.js';

describe('MCPClient', () => {
  describe('constructor', () => {
    it('should initialize with correct config', () => {
      const config: MCPClientConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      };
      const client = new MCPClient(config);
      expect(client.config).toEqual(config);
      expect(client.status).toBe('disconnected');
      expect(client.tools).toEqual([]);
      expect(client.info).toBeNull();
    });

    it('should initialize for SSE transport', () => {
      const config: MCPClientConfig = {
        id: 'sse-server',
        transport: 'sse',
        url: 'http://localhost:8080/sse',
      };
      const client = new MCPClient(config);
      expect(client.config.transport).toBe('sse');
      expect(client.status).toBe('disconnected');
    });

    it('should initialize for streamable-http transport', () => {
      const config: MCPClientConfig = {
        id: 'http-server',
        transport: 'streamable-http',
        url: 'http://localhost:8080/mcp',
        headers: { 'Authorization': 'Bearer test' },
      };
      const client = new MCPClient(config);
      expect(client.config.transport).toBe('streamable-http');
      expect(client.config.headers).toEqual({ 'Authorization': 'Bearer test' });
    });
  });

  describe('status management', () => {
    it('should emit status events', () => {
      const client = new MCPClient({ id: 'test', transport: 'stdio', command: 'echo' });
      const statuses: string[] = [];
      client.on('status', (s: string) => statuses.push(s));

      // Trigger disconnect to test event emission
      client.disconnect();
      expect(statuses).toContain('disconnected');
    });
  });

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      const client = new MCPClient({ id: 'test', transport: 'streamable-http', url: 'http://localhost:8080' });
      await client.disconnect();
      expect(client.status).toBe('disconnected');
    });

    it('should emit disconnected event', async () => {
      const client = new MCPClient({ id: 'test', transport: 'streamable-http', url: 'http://localhost:8080' });
      let emitted = false;
      client.on('disconnected', () => { emitted = true; });
      await client.disconnect();
      expect(emitted).toBe(true);
    });
  });

  describe('REQUEST_TIMEOUT', () => {
    it('should have a 30 second timeout', () => {
      expect(MCPClient.REQUEST_TIMEOUT).toBe(30_000);
    });
  });

  describe('connect validation', () => {
    it('should reject stdio without command', async () => {
      const client = new MCPClient({ id: 'test', transport: 'stdio' });
      await expect(client.connect()).rejects.toThrow('command');
    });

    it('should reject SSE without url', async () => {
      const client = new MCPClient({ id: 'test', transport: 'sse' });
      await expect(client.connect()).rejects.toThrow();
    });
  });
});
