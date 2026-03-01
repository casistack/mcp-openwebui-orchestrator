import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WSBroadcaster, type WSEvent } from '../services/ws-server.js';

describe('WSBroadcaster', () => {
  let broadcaster: WSBroadcaster;

  beforeEach(() => {
    broadcaster = new WSBroadcaster();
  });

  describe('constructor', () => {
    it('should initialize without errors', () => {
      expect(broadcaster).toBeDefined();
    });

    it('should have 0 clients initially', () => {
      expect(broadcaster.clientCount).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('should not throw when no WebSocket server attached', () => {
      const event: WSEvent = {
        type: 'test',
        data: { foo: 'bar' },
        timestamp: new Date().toISOString(),
      };
      expect(() => broadcaster.broadcast(event)).not.toThrow();
    });
  });

  describe('wireConnectionManager', () => {
    it('should register event listeners on connection manager', () => {
      const mockCM = {
        on: jest.fn(),
      } as any;

      broadcaster.wireConnectionManager(mockCM);

      // Should register handlers for all connection manager events
      const eventNames = (mockCM.on as jest.Mock).mock.calls.map((c: any) => c[0]);
      expect(eventNames).toContain('server:connected');
      expect(eventNames).toContain('server:disconnected');
      expect(eventNames).toContain('server:error');
      expect(eventNames).toContain('server:ping');
      expect(eventNames).toContain('server:tools');
      expect(eventNames.length).toBe(9);
    });
  });

  describe('close', () => {
    it('should not throw when no server attached', () => {
      expect(() => broadcaster.close()).not.toThrow();
    });
  });
});
