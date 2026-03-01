<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { trpc } from '$lib/trpc';
	import { wsClient, type WSEvent } from '$lib/ws';

	interface Stats {
		servers: number;
		namespaces: number;
		endpoints: number;
		connectedServers?: number;
	}

	interface Connection {
		serverId: string;
		status: string;
		toolCount: number;
		lastPingMs: number | null;
		lastError: string | null;
		connectTime: string | null;
		reconnectAttempts: number;
	}

	interface ToolCallStats {
		totalCalls: number;
		successCalls: number;
		failedCalls: number;
		avgDurationMs: number;
	}

	let stats = $state<Stats | null>(null);
	let connections = $state<Connection[]>([]);
	let toolCallStats = $state<ToolCallStats>({ totalCalls: 0, successCalls: 0, failedCalls: 0, avgDurationMs: 0 });
	let error = $state<string | null>(null);
	let wsConnected = $state(false);

	let cleanups: (() => void)[] = [];

	onMount(async () => {
		try {
			const [s, c, t] = await Promise.all([
				trpc.stats.query(),
				trpc.connections.list.query().catch(() => []),
				trpc.audit.toolCallStats.query().catch(() => ({ totalCalls: 0, successCalls: 0, failedCalls: 0, avgDurationMs: 0 })),
			]);
			stats = s;
			connections = c as Connection[];
			toolCallStats = t;
		} catch {
			error = 'Backend not reachable';
		}

		// Connect WebSocket for live updates
		wsClient.connect();

		cleanups.push(wsClient.on('connected', () => {
			wsConnected = true;
		}));

		cleanups.push(wsClient.on('server:connected', (evt: WSEvent) => {
			refreshConnections();
		}));

		cleanups.push(wsClient.on('server:disconnected', () => {
			refreshConnections();
		}));

		cleanups.push(wsClient.on('server:ping', (evt: WSEvent) => {
			const { serverId, latencyMs } = evt.data;
			connections = connections.map((c) =>
				c.serverId === serverId ? { ...c, lastPingMs: latencyMs as number, lastError: null } : c
			);
		}));

		cleanups.push(wsClient.on('tool:called', () => {
			trpc.audit.toolCallStats.query().then((t) => {
				toolCallStats = t;
			}).catch(() => {});
		}));
	});

	onDestroy(() => {
		cleanups.forEach((fn) => fn());
		wsClient.disconnect();
	});

	async function refreshConnections() {
		try {
			connections = (await trpc.connections.list.query()) as Connection[];
		} catch {}
	}

	function statusColor(status: string): string {
		if (status === 'connected') return 'var(--color-success)';
		if (status === 'connecting' || status === 'reconnecting') return 'var(--color-warning)';
		return 'var(--color-error)';
	}

	function formatMs(ms: number | null): string {
		if (ms === null) return '-';
		return `${ms}ms`;
	}

	function errorRate(): string {
		if (toolCallStats.totalCalls === 0) return '0%';
		return `${Math.round((toolCallStats.failedCalls / toolCallStats.totalCalls) * 100)}%`;
	}
</script>

<div>
	<div class="flex items-center justify-between mb-6">
		<h2 class="text-2xl font-bold">Dashboard</h2>
		{#if wsConnected}
			<span class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
				<span class="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse"></span>
				Live
			</span>
		{/if}
	</div>

	{#if error}
		<div class="rounded-lg p-4 border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">
			{error}
		</div>
	{:else if stats}
		<!-- Top stats row -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
			<div class="bg-[var(--color-surface)] rounded-lg p-5 border border-[var(--color-border)]">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Servers</p>
				<p class="text-3xl font-bold mt-1">{stats.servers}</p>
				{#if stats.connectedServers !== undefined}
					<p class="text-xs text-[var(--color-text-muted)] mt-1">{stats.connectedServers} connected</p>
				{/if}
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-5 border border-[var(--color-border)]">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Namespaces</p>
				<p class="text-3xl font-bold mt-1">{stats.namespaces}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-5 border border-[var(--color-border)]">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Endpoints</p>
				<p class="text-3xl font-bold mt-1">{stats.endpoints}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-5 border border-[var(--color-border)]">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Tool Calls (24h)</p>
				<p class="text-3xl font-bold mt-1">{toolCallStats.totalCalls}</p>
				<p class="text-xs text-[var(--color-text-muted)] mt-1">
					Avg {toolCallStats.avgDurationMs}ms | Err {errorRate()}
				</p>
			</div>
		</div>

		<!-- Connection status -->
		{#if connections.length > 0}
			<h3 class="text-lg font-semibold mb-3">Server Connections</h3>
			<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden mb-6">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
							<th class="text-left px-4 py-2.5 font-medium">Server</th>
							<th class="text-left px-4 py-2.5 font-medium">Status</th>
							<th class="text-left px-4 py-2.5 font-medium">Tools</th>
							<th class="text-left px-4 py-2.5 font-medium">Latency</th>
							<th class="text-left px-4 py-2.5 font-medium">Error</th>
						</tr>
					</thead>
					<tbody>
						{#each connections as conn}
							<tr class="border-b border-[var(--color-border)] last:border-0">
								<td class="px-4 py-2.5 font-mono text-xs">{conn.serverId}</td>
								<td class="px-4 py-2.5">
									<span class="inline-flex items-center gap-1.5">
										<span class="w-2 h-2 rounded-full" style="background: {statusColor(conn.status)};"></span>
										{conn.status}
									</span>
								</td>
								<td class="px-4 py-2.5">{conn.toolCount}</td>
								<td class="px-4 py-2.5 font-mono text-xs">{formatMs(conn.lastPingMs)}</td>
								<td class="px-4 py-2.5 text-xs text-[var(--color-error)] max-w-[200px] truncate">{conn.lastError ?? '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
				No server connections. Add servers and connect them from the Servers page.
			</div>
		{/if}
	{:else}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{/if}
</div>
