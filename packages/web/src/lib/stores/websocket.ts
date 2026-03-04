import { writable, derived, type Readable } from 'svelte/store';

export interface WSEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface WSState {
  connected: boolean;
  events: WSEvent[];
  lastEvent: WSEvent | null;
}

const MAX_EVENTS = 200;

function createWebSocketStore() {
  const { subscribe, update, set } = writable<WSState>({
    connected: false,
    events: [],
    lastEvent: null,
  });

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectDelay = 1000;
        update(s => ({ ...s, connected: true }));
      };

      ws.onmessage = (event) => {
        try {
          const parsed: WSEvent = JSON.parse(event.data);
          update(s => ({
            ...s,
            lastEvent: parsed,
            events: [...s.events.slice(-(MAX_EVENTS - 1)), parsed],
          }));
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        update(s => ({ ...s, connected: false }));
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
    set({ connected: false, events: [], lastEvent: null });
  }

  return {
    subscribe,
    connect,
    disconnect,
  };
}

export const websocketStore = createWebSocketStore();

// Derived stores for specific event types
export const alerts: Readable<WSEvent[]> = derived(websocketStore, ($ws) =>
  $ws.events.filter(e => e.type.startsWith('alert:'))
);

export const runtimeEvents: Readable<WSEvent[]> = derived(websocketStore, ($ws) =>
  $ws.events.filter(e =>
    e.type.startsWith('process:') ||
    e.type.startsWith('unified:') ||
    e.type.startsWith('transport:')
  )
);

// Server connection status map (serverId -> latest status)
export const serverStatuses: Readable<Map<string, { status: string; toolCount?: number; lastPingMs?: number | null; lastError?: string | null; timestamp: string }>> = derived(websocketStore, ($ws) => {
  const map = new Map<string, { status: string; toolCount?: number; lastPingMs?: number | null; lastError?: string | null; timestamp: string }>();
  for (const e of $ws.events) {
    const serverId = e.data.serverId as string | undefined;
    if (!serverId) continue;

    if (e.type === 'server:connected' || e.type === 'server:reconnected') {
      map.set(serverId, { status: 'connected', toolCount: e.data.toolCount as number, timestamp: e.timestamp });
    } else if (e.type === 'server:disconnected') {
      map.set(serverId, { status: 'disconnected', timestamp: e.timestamp });
    } else if (e.type === 'server:error') {
      map.set(serverId, { status: 'error', lastError: e.data.error as string ?? null, timestamp: e.timestamp });
    } else if (e.type === 'server:reconnecting') {
      map.set(serverId, { status: 'reconnecting', timestamp: e.timestamp });
    } else if (e.type === 'server:ping') {
      const existing = map.get(serverId);
      if (existing) {
        existing.lastPingMs = e.data.latencyMs as number | null;
        existing.timestamp = e.timestamp;
      }
    } else if (e.type === 'server:tools') {
      const existing = map.get(serverId);
      if (existing) {
        existing.toolCount = (e.data.tools as unknown[])?.length ?? 0;
      }
    }
  }
  return map;
});

// Connected state as a simple boolean store
export const wsConnected: Readable<boolean> = derived(websocketStore, ($ws) => $ws.connected);
