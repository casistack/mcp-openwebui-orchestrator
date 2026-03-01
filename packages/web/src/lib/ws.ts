/**
 * WebSocket client for receiving real-time events from the MCP Platform backend.
 * Auto-reconnects with exponential backoff.
 */

export interface WSEvent {
	type: string;
	data: Record<string, unknown>;
	timestamp: string;
}

type EventHandler = (event: WSEvent) => void;

class WSClient {
	private ws: WebSocket | null = null;
	private handlers = new Map<string, Set<EventHandler>>();
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private maxReconnectAttempts = 10;
	private baseDelay = 1000;

	connect(): void {
		if (this.ws?.readyState === WebSocket.OPEN) return;

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${protocol}//${window.location.host}/ws`;

		try {
			this.ws = new WebSocket(url);

			this.ws.onopen = () => {
				this.reconnectAttempts = 0;
			};

			this.ws.onmessage = (msg) => {
				try {
					const event = JSON.parse(msg.data) as WSEvent;
					this.dispatch(event);
				} catch {
					// ignore malformed messages
				}
			};

			this.ws.onclose = () => {
				this.scheduleReconnect();
			};

			this.ws.onerror = () => {
				// onclose will fire after this
			};
		} catch {
			this.scheduleReconnect();
		}
	}

	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.ws?.close();
		this.ws = null;
	}

	on(type: string, handler: EventHandler): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);

		return () => {
			set?.delete(handler);
		};
	}

	private dispatch(event: WSEvent): void {
		// Fire specific handlers
		this.handlers.get(event.type)?.forEach((h) => h(event));
		// Fire wildcard handlers
		this.handlers.get('*')?.forEach((h) => h(event));
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

		this.reconnectAttempts++;
		const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts - 1);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, Math.min(delay, 30000));
	}
}

// Singleton instance
export const wsClient = new WSClient();
