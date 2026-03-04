<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { websocketStore } from '$lib/stores/websocket';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Activity, Cpu, HardDrive, Database, RefreshCw, Server, Zap } from '@lucide/svelte';

	interface Metrics {
		system: {
			uptime: number; platform: string; arch: string; nodeVersion: string;
			cpuCount: number; cpuUsage: { user: number; system: number };
			memoryUsage: { rss: number; heapUsed: number; heapTotal: number; freeSystem: number; totalSystem: number; usedPercent: number };
			loadAverage: number[];
		};
		database: { healthRecordCount: number; runtimeLogCount: number; auditLogCount: number };
		connections: { total: number; connected: number; errored: number };
		runtime: { enabled: boolean; runningProcesses: number; healthyProcesses: number };
		timestamp: string;
	}

	let metrics = $state<Metrics | null>(null);
	let loading = $state(true);
	let refreshing = $state(false);
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		await loadMetrics();
		refreshInterval = setInterval(() => { refreshing = true; loadMetrics(); }, 10000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
		unsubWs();
	});

	// Auto-refresh on WebSocket runtime/connection events
	const unsubWs = websocketStore.subscribe(($ws) => {
		const last = $ws.lastEvent;
		if (!last || loading) return;
		if (last.type.startsWith('process:') || last.type.startsWith('server:')) {
			refreshing = true;
			loadMetrics();
		}
	});

	async function loadMetrics() {
		try {
			const res = await fetch('/api/system/metrics');
			metrics = await res.json();
		} catch { metrics = null; }
		loading = false;
		refreshing = false;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	function formatUptime(seconds: number): string {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (d > 0) return `${d}d ${h}h ${m}m`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m ${seconds % 60}s`;
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">System Metrics</h2>
			<p class="text-sm text-muted-foreground">Real-time platform health and resource usage</p>
		</div>
		<Button variant="outline" onclick={() => { refreshing = true; loadMetrics(); }} disabled={refreshing}>
			<RefreshCw class="size-4 mr-2 {refreshing ? 'animate-spin' : ''}" />{refreshing ? 'Refreshing...' : 'Refresh'}
		</Button>
	</div>

	{#if loading}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			{#each [1,2,3,4] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-16 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else if !metrics}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Activity class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">Unable to load system metrics</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Top-level status -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<Card.Root>
				<Card.Content class="p-4">
					<div class="flex items-center gap-2 mb-1">
						<Zap class="size-4 text-muted-foreground" />
						<p class="text-xs text-muted-foreground">Uptime</p>
					</div>
					<p class="text-xl font-bold">{formatUptime(metrics.system.uptime)}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<div class="flex items-center gap-2 mb-1">
						<Server class="size-4 text-muted-foreground" />
						<p class="text-xs text-muted-foreground">Connections</p>
					</div>
					<p class="text-xl font-bold">{metrics.connections.connected}<span class="text-sm text-muted-foreground">/{metrics.connections.total}</span></p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<div class="flex items-center gap-2 mb-1">
						<HardDrive class="size-4 text-muted-foreground" />
						<p class="text-xs text-muted-foreground">Memory</p>
					</div>
					<p class="text-xl font-bold">{metrics.system.memoryUsage.usedPercent}%</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<div class="flex items-center gap-2 mb-1">
						<Activity class="size-4 text-muted-foreground" />
						<p class="text-xs text-muted-foreground">Runtime Processes</p>
					</div>
					<p class="text-xl font-bold">{metrics.runtime.healthyProcesses}<span class="text-sm text-muted-foreground">/{metrics.runtime.runningProcesses}</span></p>
				</Card.Content>
			</Card.Root>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- System Info -->
			<Card.Root>
				<Card.Header><Card.Title class="text-sm flex items-center gap-2"><Cpu class="size-4" />System</Card.Title></Card.Header>
				<Card.Content>
					<div class="grid grid-cols-2 gap-y-3 text-sm">
						<div>
							<p class="text-xs text-muted-foreground">Platform</p>
							<p class="font-mono">{metrics.system.platform}/{metrics.system.arch}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">Node.js</p>
							<p class="font-mono">{metrics.system.nodeVersion}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">CPU Cores</p>
							<p>{metrics.system.cpuCount}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">Load Average</p>
							<p class="font-mono text-xs">{metrics.system.loadAverage.map(l => l.toFixed(2)).join(', ')}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Memory -->
			<Card.Root>
				<Card.Header><Card.Title class="text-sm flex items-center gap-2"><HardDrive class="size-4" />Memory</Card.Title></Card.Header>
				<Card.Content>
					<div class="grid grid-cols-2 gap-y-3 text-sm">
						<div>
							<p class="text-xs text-muted-foreground">Heap Used</p>
							<p class="font-mono">{formatBytes(metrics.system.memoryUsage.heapUsed)}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">Heap Total</p>
							<p class="font-mono">{formatBytes(metrics.system.memoryUsage.heapTotal)}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">RSS</p>
							<p class="font-mono">{formatBytes(metrics.system.memoryUsage.rss)}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">System Free</p>
							<p class="font-mono">{formatBytes(metrics.system.memoryUsage.freeSystem)}</p>
						</div>
						<div class="col-span-2">
							<p class="text-xs text-muted-foreground mb-1">System Memory Usage</p>
							<div class="w-full bg-muted rounded-full h-2">
								<div
									class="h-2 rounded-full {metrics.system.memoryUsage.usedPercent > 90 ? 'bg-destructive' : metrics.system.memoryUsage.usedPercent > 70 ? 'bg-yellow-500' : 'bg-primary'}"
									style="width: {metrics.system.memoryUsage.usedPercent}%"
								></div>
							</div>
							<p class="text-xs text-muted-foreground mt-1">{formatBytes(metrics.system.memoryUsage.totalSystem - metrics.system.memoryUsage.freeSystem)} / {formatBytes(metrics.system.memoryUsage.totalSystem)}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Database -->
			<Card.Root>
				<Card.Header><Card.Title class="text-sm flex items-center gap-2"><Database class="size-4" />Database Records</Card.Title></Card.Header>
				<Card.Content>
					<div class="grid grid-cols-3 gap-4 text-sm text-center">
						<div>
							<p class="text-2xl font-bold">{metrics.database.healthRecordCount}</p>
							<p class="text-xs text-muted-foreground">Health Records</p>
						</div>
						<div>
							<p class="text-2xl font-bold">{metrics.database.runtimeLogCount}</p>
							<p class="text-xs text-muted-foreground">Runtime Logs</p>
						</div>
						<div>
							<p class="text-2xl font-bold">{metrics.database.auditLogCount}</p>
							<p class="text-xs text-muted-foreground">Audit Logs</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Runtime -->
			<Card.Root>
				<Card.Header><Card.Title class="text-sm flex items-center gap-2"><Server class="size-4" />Runtime</Card.Title></Card.Header>
				<Card.Content>
					<div class="space-y-3 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Runtime Enabled</span>
							<Badge variant={metrics.runtime.enabled ? 'default' : 'outline'}>{metrics.runtime.enabled ? 'Yes' : 'No'}</Badge>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Running Processes</span>
							<span class="font-mono">{metrics.runtime.runningProcesses}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Healthy Processes</span>
							<span class="font-mono">{metrics.runtime.healthyProcesses}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Connected Servers</span>
							<span class="font-mono">{metrics.connections.connected}</span>
						</div>
						{#if metrics.connections.errored > 0}
							<div class="flex justify-between">
								<span class="text-muted-foreground">Errored Connections</span>
								<Badge variant="destructive">{metrics.connections.errored}</Badge>
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<p class="mt-4 text-xs text-muted-foreground">Last updated: {new Date(metrics.timestamp).toLocaleString()}</p>
	{/if}
</div>
