<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface ServerHealth {
		id: string;
		name: string;
		displayName: string;
		status: string;
		transport: string;
		lastChecked: Date;
	}

	let servers = $state<ServerHealth[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let lastRefresh = $state<Date | null>(null);

	async function loadHealth() {
		try {
			const result = await trpc.servers.list.query();
			const serverList = (result as unknown as { servers: ServerHealth[] }).servers ?? (result as unknown as ServerHealth[]);
			servers = serverList.map(s => ({
				...s,
				lastChecked: new Date(),
			}));
			lastRefresh = new Date();
		} catch {
			error = 'Failed to load server health';
		}
		loading = false;
		refreshing = false;
	}

	onMount(() => {
		loadHealth();
		// Auto-refresh every 30 seconds
		const interval = setInterval(() => {
			refreshing = true;
			loadHealth();
		}, 30000);
		return () => clearInterval(interval);
	});

	function statusColor(status: string): string {
		switch (status) {
			case 'active': return 'var(--color-success)';
			case 'error': return 'var(--color-error)';
			case 'starting': return 'var(--color-warning)';
			default: return 'var(--color-text-muted)';
		}
	}

	function healthySummary() {
		const healthy = servers.filter(s => s.status === 'active').length;
		return { healthy, total: servers.length, unhealthy: servers.length - healthy };
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Health Monitor</h2>
		<div class="flex items-center gap-3">
			{#if lastRefresh}
				<span class="text-xs text-[var(--color-text-muted)]">
					Last updated: {lastRefresh.toLocaleTimeString()}
				</span>
			{/if}
			<button
				onclick={() => { refreshing = true; loadHealth(); }}
				disabled={refreshing}
				class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
			>
				{refreshing ? 'Refreshing...' : 'Refresh'}
			</button>
		</div>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">
			{error}
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading health data...</p>
	{:else}
		<!-- Summary Cards -->
		{@const summary = healthySummary()}
		<div class="grid grid-cols-3 gap-4 mb-6">
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-text-muted)]">Total Servers</p>
				<p class="text-3xl font-bold mt-1">{summary.total}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-success)]">Healthy</p>
				<p class="text-3xl font-bold mt-1 text-[var(--color-success)]">{summary.healthy}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-error)]">Unhealthy</p>
				<p class="text-3xl font-bold mt-1" class:text-[var(--color-error)]={summary.unhealthy > 0}>{summary.unhealthy}</p>
			</div>
		</div>

		<!-- Server Health Table -->
		{#if servers.length === 0}
			<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
				<p class="text-[var(--color-text-muted)]">No servers to monitor.</p>
			</div>
		{:else}
			<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
				<table class="w-full text-sm">
					<thead class="border-b border-[var(--color-border)]">
						<tr class="text-left text-[var(--color-text-muted)]">
							<th class="p-3">Status</th>
							<th class="p-3">Server</th>
							<th class="p-3">Transport</th>
							<th class="p-3">Last Checked</th>
						</tr>
					</thead>
					<tbody>
						{#each servers as server}
							<tr class="border-b border-[var(--color-border)] last:border-0">
								<td class="p-3">
									<span class="inline-flex items-center gap-2">
										<span class="w-3 h-3 rounded-full" style="background-color: {statusColor(server.status)}"></span>
										<span class="capitalize">{server.status}</span>
									</span>
								</td>
								<td class="p-3">
									<span class="font-medium">{server.displayName || server.name}</span>
									<span class="text-xs text-[var(--color-text-muted)] ml-1">({server.id})</span>
								</td>
								<td class="p-3">
									<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{server.transport}</span>
								</td>
								<td class="p-3 text-xs text-[var(--color-text-muted)]">{server.lastChecked.toLocaleTimeString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
