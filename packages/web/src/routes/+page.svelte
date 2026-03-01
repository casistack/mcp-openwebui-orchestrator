<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	let stats = $state<{ servers: number; namespaces: number; endpoints: number } | null>(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			stats = await trpc.stats.query();
		} catch {
			error = 'Backend not reachable';
		}
	});
</script>

<div>
	<h2 class="text-2xl font-bold mb-6">Dashboard</h2>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-4 text-[var(--color-error)]">
			{error}
		</div>
	{:else if stats}
		<div class="grid grid-cols-3 gap-4">
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-text-muted)]">Servers</p>
				<p class="text-3xl font-bold mt-1">{stats.servers}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-text-muted)]">Namespaces</p>
				<p class="text-3xl font-bold mt-1">{stats.namespaces}</p>
			</div>
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<p class="text-sm text-[var(--color-text-muted)]">Endpoints</p>
				<p class="text-3xl font-bold mt-1">{stats.endpoints}</p>
			</div>
		</div>
	{:else}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{/if}
</div>
