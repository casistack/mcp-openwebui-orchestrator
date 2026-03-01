<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Connection {
		serverId: string;
		status: string;
		toolCount: number;
		lastPingMs: number | null;
		lastError: string | null;
	}

	interface HealthStats {
		serverId: string;
		totalChecks: number;
		healthyChecks: number;
		uptimePercent: number;
		avgResponseTime: number | null;
		maxResponseTime: number | null;
		minResponseTime: number | null;
	}

	interface HealthRecord {
		healthy: boolean;
		responseTime: number | null;
		checkedAt: string;
		error: string | null;
	}

	let connections = $state<Connection[]>([]);
	let healthStats = $state<HealthStats[]>([]);
	let selectedServer = $state<string | null>(null);
	let timeSeries = $state<HealthRecord[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		await loadAll();

		// Auto-refresh every 30 seconds
		refreshInterval = setInterval(() => {
			refreshing = true;
			loadAll();
		}, 30000);
	});

	onDestroy(() => {
		if (refreshInterval) clearInterval(refreshInterval);
	});

	async function loadAll() {
		try {
			const [conns, stats] = await Promise.all([
				trpc.connections.list.query().catch(() => []),
				trpc.health.allStats.query().catch(() => []),
			]);
			connections = conns as Connection[];
			healthStats = stats as HealthStats[];

			if (!selectedServer && connections.length > 0) {
				await selectServer(connections[0].serverId);
			} else if (selectedServer) {
				await loadTimeSeries(selectedServer);
			}
		} catch {
			error = 'Failed to load health data';
		}
		loading = false;
		refreshing = false;
	}

	async function selectServer(serverId: string) {
		selectedServer = serverId;
		await loadTimeSeries(serverId);
	}

	async function loadTimeSeries(serverId: string) {
		try {
			timeSeries = (await trpc.health.timeSeries.query({ serverId, hours: 24 })) as HealthRecord[];
		} catch {
			timeSeries = [];
		}
	}

	function getStatsForServer(serverId: string): HealthStats | undefined {
		return healthStats.find((s) => s.serverId === serverId);
	}

	function uptimeColor(pct: number): string {
		if (pct >= 99) return 'var(--color-success)';
		if (pct >= 95) return 'var(--color-warning)';
		return 'var(--color-error)';
	}

	function chartPoints(data: HealthRecord[], width: number, height: number): string {
		if (data.length === 0) return '';
		const times = data.map((d) => d.responseTime ?? 0);
		const maxTime = Math.max(...times, 1);
		const padding = 5;
		const w = width - padding * 2;
		const h = height - padding * 2;

		return data
			.map((d, i) => {
				const x = padding + (i / Math.max(data.length - 1, 1)) * w;
				const y = padding + h - ((d.responseTime ?? 0) / maxTime) * h;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function healthDots(data: HealthRecord[], width: number): Array<{ x: number; healthy: boolean }> {
		if (data.length === 0) return [];
		return data.map((d, i) => ({
			x: 5 + (i / Math.max(data.length - 1, 1)) * (width - 10),
			healthy: d.healthy,
		}));
	}

	function summaryStats() {
		const total = connections.length;
		const healthy = connections.filter((c) => c.status === 'connected').length;
		return { total, healthy, unhealthy: total - healthy };
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Health Monitor</h2>
		<button
			onclick={() => { refreshing = true; loadAll(); }}
			disabled={refreshing}
			class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
		>
			{refreshing ? 'Refreshing...' : 'Refresh'}
		</button>
	</div>

	{#if error}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">
			{error}
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading health data...</p>
	{:else}
		<!-- Summary -->
		{@const summary = summaryStats()}
		<div class="grid grid-cols-3 gap-4 mb-6">
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Total Servers</p>
				<p class="text-3xl font-bold mt-1">{summary.total}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-xs font-medium uppercase tracking-wide" style="color: var(--color-success)">Healthy</p>
				<p class="text-3xl font-bold mt-1" style="color: var(--color-success)">{summary.healthy}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-xs font-medium uppercase tracking-wide" style="color: {summary.unhealthy > 0 ? 'var(--color-error)' : 'var(--color-text-muted)'}">Unhealthy</p>
				<p class="text-3xl font-bold mt-1" style="color: {summary.unhealthy > 0 ? 'var(--color-error)' : 'inherit'}">{summary.unhealthy}</p>
			</div>
		</div>

		<!-- Server cards with health stats -->
		{#if connections.length > 0}
			<h3 class="text-lg font-semibold mb-3">Per-Server Health</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
				{#each connections as conn}
					{@const stats = getStatsForServer(conn.serverId)}
					<button
						onclick={() => selectServer(conn.serverId)}
						class="text-left bg-[var(--color-surface)] rounded-lg p-4 border transition-colors {selectedServer === conn.serverId
							? 'border-[var(--color-primary)]'
							: 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}"
					>
						<div class="flex items-center justify-between mb-2">
							<span class="font-mono text-sm font-medium truncate">{conn.serverId}</span>
							<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background: {conn.status === 'connected' ? 'var(--color-success)' : 'var(--color-error)'};"></span>
						</div>
						{#if stats && stats.totalChecks > 0}
							<div class="grid grid-cols-3 gap-2 text-xs text-[var(--color-text-muted)]">
								<div>
									<p class="font-medium" style="color: {uptimeColor(stats.uptimePercent)}">{stats.uptimePercent}%</p>
									<p>uptime</p>
								</div>
								<div>
									<p class="font-medium">{stats.avgResponseTime ?? '-'}ms</p>
									<p>avg</p>
								</div>
								<div>
									<p class="font-medium">{stats.maxResponseTime ?? '-'}ms</p>
									<p>max</p>
								</div>
							</div>
						{:else}
							<p class="text-xs text-[var(--color-text-muted)]">
								{conn.lastPingMs !== null ? `Last ping: ${conn.lastPingMs}ms` : 'No health data yet'}
							</p>
						{/if}
					</button>
				{/each}
			</div>
		{:else}
			<div class="bg-[var(--color-surface)] rounded-lg p-8 border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
				No server connections. Health data appears once servers are connected.
			</div>
		{/if}

		<!-- Charts for selected server -->
		{#if selectedServer && timeSeries.length > 0}
			<div class="space-y-4">
				<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
					<h3 class="text-sm font-semibold mb-3">Response Time (24h) - {selectedServer}</h3>
					<svg viewBox="0 0 400 120" class="w-full" style="max-height: 160px;">
						<line x1="5" y1="5" x2="395" y2="5" stroke="var(--color-border)" stroke-width="0.5" />
						<line x1="5" y1="62" x2="395" y2="62" stroke="var(--color-border)" stroke-width="0.5" />
						<line x1="5" y1="115" x2="395" y2="115" stroke="var(--color-border)" stroke-width="0.5" />
						<polyline
							points={chartPoints(timeSeries, 400, 120)}
							fill="none"
							stroke="var(--color-primary)"
							stroke-width="1.5"
							stroke-linejoin="round"
						/>
					</svg>
					<div class="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-1">
						<span>24h ago</span>
						<span>now</span>
					</div>
				</div>

				<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
					<h3 class="text-sm font-semibold mb-3">Health Timeline (24h) - {selectedServer}</h3>
					<svg viewBox="0 0 400 24" class="w-full" style="max-height: 32px;">
						{#each healthDots(timeSeries, 400) as dot}
							<circle
								cx={dot.x}
								cy="12"
								r="3"
								fill={dot.healthy ? 'var(--color-success)' : 'var(--color-error)'}
								opacity="0.8"
							/>
						{/each}
					</svg>
					<div class="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-1">
						<span>24h ago</span>
						<span>now</span>
					</div>
				</div>
			</div>
		{:else if selectedServer}
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
				No health history for {selectedServer}. Data appears after health checks run.
			</div>
		{/if}
	{/if}
</div>
