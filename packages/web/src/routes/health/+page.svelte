<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { trpc } from '$lib/trpc';
	import { websocketStore } from '$lib/stores/websocket';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { HeartPulse, RefreshCw, Server, AlertCircle, AlertTriangle, Bell, Check } from '@lucide/svelte';

	interface Connection { serverId: string; status: string; toolCount: number; lastPingMs: number | null; lastError: string | null; }
	interface HealthStats { serverId: string; totalChecks: number; healthyChecks: number; uptimePercent: number; avgResponseTime: number | null; maxResponseTime: number | null; minResponseTime: number | null; }
	interface HealthRecord { healthy: boolean; responseTime: number | null; checkedAt: string; error: string | null; }
	interface HealthAlert { id: string; serverId: string; alertType: string; severity: string; message: string; remediation: string | null; resolvedAt: string | null; createdAt: string; }

	let connections = $state<Connection[]>([]);
	let healthStats = $state<HealthStats[]>([]);
	let selectedServer = $state<string | null>(null);
	let timeSeries = $state<HealthRecord[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let activeAlerts = $state<HealthAlert[]>([]);
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		await loadAll();
		refreshInterval = setInterval(() => { refreshing = true; loadAll(); }, 30000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
		unsubWs();
	});

	// Auto-refresh on WebSocket alert/health events
	const unsubWs = websocketStore.subscribe(($ws) => {
		const last = $ws.lastEvent;
		if (!last || loading) return;
		if (last.type === 'alert:created' || last.type.startsWith('server:ping') || last.type === 'server:error') {
			loadAll();
		}
	});

	async function loadAll() {
		try {
			const [conns, stats, alerts] = await Promise.all([
				trpc.connections.list.query().catch(() => []),
				trpc.health.allStats.query().catch(() => []),
				trpc.alerts.active.query().catch(() => []),
			]);
			activeAlerts = alerts as HealthAlert[];
			connections = conns as Connection[];
			healthStats = stats as HealthStats[];
			if (!selectedServer && connections.length > 0) await selectServer(connections[0].serverId);
			else if (selectedServer) await loadTimeSeries(selectedServer);
		} catch { error = 'Failed to load health data'; }
		loading = false;
		refreshing = false;
	}

	async function selectServer(serverId: string) { selectedServer = serverId; await loadTimeSeries(serverId); }

	async function loadTimeSeries(serverId: string) {
		try { timeSeries = (await trpc.health.timeSeries.query({ serverId, hours: 24 })) as HealthRecord[]; }
		catch { timeSeries = []; }
	}

	function getStatsForServer(serverId: string): HealthStats | undefined { return healthStats.find(s => s.serverId === serverId); }

	function uptimeVariant(pct: number): 'default' | 'secondary' | 'destructive' {
		if (pct >= 99) return 'default';
		if (pct >= 95) return 'secondary';
		return 'destructive';
	}

	function chartPoints(data: HealthRecord[], width: number, height: number): string {
		if (data.length === 0) return '';
		const times = data.map(d => d.responseTime ?? 0);
		const maxTime = Math.max(...times, 1);
		const padding = 5;
		const w = width - padding * 2;
		const h = height - padding * 2;
		return data.map((d, i) => {
			const x = padding + (i / Math.max(data.length - 1, 1)) * w;
			const y = padding + h - ((d.responseTime ?? 0) / maxTime) * h;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		}).join(' ');
	}

	function healthDots(data: HealthRecord[], width: number): Array<{ x: number; healthy: boolean }> {
		if (data.length === 0) return [];
		return data.map((d, i) => ({ x: 5 + (i / Math.max(data.length - 1, 1)) * (width - 10), healthy: d.healthy }));
	}

	async function resolveAlert(alertId: string) {
		try {
			await trpc.alerts.resolve.mutate({ alertId });
			activeAlerts = activeAlerts.filter(a => a.id !== alertId);
		} catch { /* ignore */ }
	}

	function severityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (severity === 'critical' || severity === 'high') return 'destructive';
		if (severity === 'medium') return 'secondary';
		return 'outline';
	}

	function summaryStats() {
		const total = connections.length;
		const healthy = connections.filter(c => c.status === 'connected').length;
		return { total, healthy, unhealthy: total - healthy };
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Health Monitor</h2>
			<p class="text-sm text-muted-foreground">Real-time server health and uptime tracking</p>
		</div>
		<Button variant="outline" onclick={() => { refreshing = true; loadAll(); }} disabled={refreshing}>
			<RefreshCw class="size-4 mr-2 {refreshing ? 'animate-spin' : ''}" />{refreshing ? 'Refreshing...' : 'Refresh'}
		</Button>
	</div>

	{#if error}<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>{/if}

	{#if loading}
		<div class="grid grid-cols-3 gap-4 mb-6">
			{#each [1, 2, 3] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-16 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else}
		{@const summary = summaryStats()}
		<div class="grid grid-cols-3 gap-4 mb-6">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Total Servers</Card.Title>
					<Server class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content><div class="text-2xl font-bold">{summary.total}</div></Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium text-success">Healthy</Card.Title>
					<HeartPulse class="size-4 text-success" />
				</Card.Header>
				<Card.Content><div class="text-2xl font-bold text-success">{summary.healthy}</div></Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium {summary.unhealthy > 0 ? 'text-destructive' : 'text-muted-foreground'}">Unhealthy</Card.Title>
					<AlertCircle class="size-4 {summary.unhealthy > 0 ? 'text-destructive' : 'text-muted-foreground'}" />
				</Card.Header>
				<Card.Content><div class="text-2xl font-bold {summary.unhealthy > 0 ? 'text-destructive' : ''}">{summary.unhealthy}</div></Card.Content>
			</Card.Root>
		</div>

		{#if activeAlerts.length > 0}
			<Card.Root class="mb-6 border-destructive/50">
				<Card.Header class="pb-2">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Bell class="size-4 text-destructive" />
							<Card.Title class="text-sm">Active Alerts ({activeAlerts.length})</Card.Title>
						</div>
					</div>
				</Card.Header>
				<Card.Content class="space-y-2">
					{#each activeAlerts.slice(0, 10) as alert}
						<div class="flex items-center justify-between py-2 px-3 rounded border text-sm">
							<div class="flex items-center gap-2 min-w-0">
								{#if alert.severity === 'critical' || alert.severity === 'high'}
									<AlertTriangle class="size-4 text-destructive shrink-0" />
								{:else}
									<AlertCircle class="size-4 text-muted-foreground shrink-0" />
								{/if}
								<Badge variant={severityVariant(alert.severity)} class="text-xs shrink-0">{alert.severity}</Badge>
								<span class="font-mono text-xs text-muted-foreground shrink-0">{alert.serverId}</span>
								<span class="text-xs truncate">{alert.message}</span>
								{#if alert.remediation}
									<Badge variant="outline" class="text-xs shrink-0">{alert.remediation}</Badge>
								{/if}
							</div>
							<Button variant="ghost" size="icon" class="shrink-0 size-7" title="Resolve" onclick={() => resolveAlert(alert.id)}>
								<Check class="size-3" />
							</Button>
						</div>
					{/each}
					{#if activeAlerts.length > 10}
						<p class="text-xs text-muted-foreground text-center">+ {activeAlerts.length - 10} more alerts</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if connections.length > 0}
			<h3 class="text-lg font-semibold mb-3">Per-Server Health</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
				{#each connections as conn}
					{@const stats = getStatsForServer(conn.serverId)}
					<Card.Root class="cursor-pointer transition-colors {selectedServer === conn.serverId ? 'ring-2 ring-primary' : 'hover:border-muted-foreground/50'}" onclick={() => selectServer(conn.serverId)}>
						<Card.Content class="p-4">
							<div class="flex items-center justify-between mb-2">
								<span class="font-mono text-sm font-medium truncate">{conn.serverId}</span>
								<Badge variant={conn.status === 'connected' ? 'default' : 'destructive'}>{conn.status}</Badge>
							</div>
							{#if stats && stats.totalChecks > 0}
								<div class="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
									<div>
										<Badge variant={uptimeVariant(stats.uptimePercent)} class="text-xs mb-0.5">{stats.uptimePercent}%</Badge>
										<p>uptime</p>
									</div>
									<div>
										<p class="font-medium text-foreground">{stats.avgResponseTime ?? '-'}ms</p>
										<p>avg</p>
									</div>
									<div>
										<p class="font-medium text-foreground">{stats.maxResponseTime ?? '-'}ms</p>
										<p>max</p>
									</div>
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">{conn.lastPingMs !== null ? `Last ping: ${conn.lastPingMs}ms` : 'No health data yet'}</p>
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		{:else}
			<Card.Root>
				<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
					<HeartPulse class="size-10 text-muted-foreground mb-3" />
					<p class="text-sm text-muted-foreground">No server connections. Health data appears once servers are connected.</p>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if selectedServer && timeSeries.length > 0}
			<div class="space-y-4">
				<Card.Root>
					<Card.Header class="pb-2"><Card.Title class="text-sm">Response Time (24h) - {selectedServer}</Card.Title></Card.Header>
					<Card.Content>
						<svg viewBox="0 0 400 120" class="w-full" style="max-height: 160px;">
							<line x1="5" y1="5" x2="395" y2="5" stroke="hsl(var(--border))" stroke-width="0.5" />
							<line x1="5" y1="62" x2="395" y2="62" stroke="hsl(var(--border))" stroke-width="0.5" />
							<line x1="5" y1="115" x2="395" y2="115" stroke="hsl(var(--border))" stroke-width="0.5" />
							<polyline points={chartPoints(timeSeries, 400, 120)} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" stroke-linejoin="round" />
						</svg>
						<div class="flex justify-between text-[10px] text-muted-foreground mt-1">
							<span>24h ago</span><span>now</span>
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header class="pb-2"><Card.Title class="text-sm">Health Timeline (24h) - {selectedServer}</Card.Title></Card.Header>
					<Card.Content>
						<svg viewBox="0 0 400 24" class="w-full" style="max-height: 32px;">
							{#each healthDots(timeSeries, 400) as dot}
								<circle cx={dot.x} cy="12" r="3" fill={dot.healthy ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} opacity="0.8" />
							{/each}
						</svg>
						<div class="flex justify-between text-[10px] text-muted-foreground mt-1">
							<span>24h ago</span><span>now</span>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		{:else if selectedServer}
			<Card.Root>
				<Card.Content class="flex flex-col items-center justify-center py-8 text-center">
					<p class="text-sm text-muted-foreground">No health history for {selectedServer}. Data appears after health checks run.</p>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
