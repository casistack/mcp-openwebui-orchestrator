import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { ConnectionManager } from './connection-manager.js';

export interface WSEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * WebSocket server for broadcasting real-time events to frontend clients.
 * Attaches to the existing HTTP server on the /ws path.
 */
export class WSBroadcaster {
  private wss: WebSocketServer | null = null;

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      // Send a welcome event so client knows it's connected
      ws.send(JSON.stringify({
        type: 'connected',
        data: { message: 'Connected to MCP Platform' },
        timestamp: new Date().toISOString(),
      }));
    });
  }

  /**
   * Wire up ConnectionManager events to broadcast to all connected clients.
   */
  wireConnectionManager(cm: ConnectionManager): void {
    const events = [
      'server:connected',
      'server:disconnected',
      'server:error',
      'server:reconnecting',
      'server:reconnected',
      'server:reconnect:exhausted',
      'server:ping',
      'server:ping:failed',
      'server:tools',
    ];

    for (const event of events) {
      cm.on(event, (data: Record<string, unknown>) => {
        this.broadcast({ type: event, data, timestamp: new Date().toISOString() });
      });
    }
  }

  /**
   * Broadcast an event to all connected WebSocket clients.
   */
  broadcast(event: WSEvent): void {
    if (!this.wss) return;

    const message = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Get the count of connected WebSocket clients.
   */
  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  close(): void {
    this.wss?.close();
  }
}
