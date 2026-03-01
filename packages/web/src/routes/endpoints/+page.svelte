<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Endpoint { id: string; namespaceId: string; name: string; slug: string; transport: string; isActive: boolean; authType: string; rateLimit: number; }
	interface Namespace { id: string; name: string; }

	let endpoints = $state<Endpoint[]>([]);
	let namespaces = $state<Namespace[]>([]);
	let loading = $state(true);
	let showDialog = $state(false);
	let deleteTarget = $state<Endpoint | null>(null);
	let error = $state<string | null>(null);
	let form = $state({ namespaceId: '', name: '', transport: 'sse' as 'sse' | 'streamable-http' | 'openapi', authType: 'api_key' as 'none' | 'api_key' | 'oauth' | 'bearer', rateLimit: 100 });

	async function load() {
		try {
			const [epResult, nsResult] = await Promise.all([
				trpc.endpoints.list.query(),
				trpc.namespaces.list.query(),
			]);
			endpoints = (epResult as unknown as { endpoints: Endpoint[] }).endpoints ?? (epResult as unknown as Endpoint[]);
			namespaces = (nsResult as unknown as { namespaces: Namespace[] }).namespaces ?? (nsResult as unknown as Namespace[]);
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	function nsName(id: string) { return namespaces.find(n => n.id === id)?.name ?? id; }

	async function handleCreate() {
		error = null;
		try {
			await trpc.endpoints.create.mutate(form);
			showDialog = false;
			await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to create'; }
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			await trpc.endpoints.delete.mutate({ id: deleteTarget.id });
			deleteTarget = null;
			await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete'; }
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Endpoints</h2>
		<button onclick={() => { form = { namespaceId: namespaces[0]?.id ?? '', name: '', transport: 'sse', authType: 'api_key', rateLimit: 100 }; showDialog = true; }} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
			Create Endpoint
		</button>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">{error}</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if endpoints.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)]">No endpoints created yet. Endpoints expose namespaces to MCP clients.</p>
		</div>
	{:else}
		<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
			<table class="w-full text-sm">
				<thead class="border-b border-[var(--color-border)]">
					<tr class="text-left text-[var(--color-text-muted)]">
						<th class="p-3">Name</th>
						<th class="p-3">Namespace</th>
						<th class="p-3">Transport</th>
						<th class="p-3">Auth</th>
						<th class="p-3">Rate Limit</th>
						<th class="p-3">Status</th>
						<th class="p-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each endpoints as ep}
						<tr class="border-b border-[var(--color-border)] last:border-0">
							<td class="p-3 font-medium">{ep.name}</td>
							<td class="p-3 text-[var(--color-text-muted)]">{nsName(ep.namespaceId)}</td>
							<td class="p-3"><span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{ep.transport}</span></td>
							<td class="p-3 text-xs">{ep.authType}</td>
							<td class="p-3 text-xs">{ep.rateLimit}/min</td>
							<td class="p-3">
								<span class="inline-flex items-center gap-1">
									<span class="w-2 h-2 rounded-full" class:bg-[var(--color-success)]={ep.isActive} class:bg-[var(--color-text-muted)]={!ep.isActive}></span>
									{ep.isActive ? 'Active' : 'Inactive'}
								</span>
							</td>
							<td class="p-3 text-right">
								<button onclick={() => deleteTarget = ep} class="text-[var(--color-error)] hover:underline text-xs">Delete</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if showDialog}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showDialog = false}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-md border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-4">Create Endpoint</h3>
			<form onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Namespace</span>
					<select bind:value={form.namespaceId} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none" required>
						{#each namespaces as ns}<option value={ns.id}>{ns.name}</option>{/each}
					</select>
				</label>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Name</span>
					<input bind:value={form.name} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none" required />
				</label>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Transport</span>
					<select bind:value={form.transport} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none">
						<option value="sse">SSE</option>
						<option value="streamable-http">Streamable HTTP</option>
						<option value="openapi">OpenAPI</option>
					</select>
				</label>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Auth Type</span>
					<select bind:value={form.authType} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none">
						<option value="api_key">API Key</option>
						<option value="bearer">Bearer Token</option>
						<option value="oauth">OAuth</option>
						<option value="none">None</option>
					</select>
				</label>
				<label class="block mb-4">
					<span class="text-sm text-[var(--color-text-muted)]">Rate Limit (requests/min)</span>
					<input type="number" bind:value={form.rateLimit} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none" />
				</label>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => showDialog = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
					<button type="submit" class="bg-[var(--color-primary)] text-white px-4 py-2 rounded text-sm">Create</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deleteTarget}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => deleteTarget = null}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-sm border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-2">Delete Endpoint</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">Delete <strong>{deleteTarget.name}</strong>?</p>
			<div class="flex justify-end gap-2">
				<button onclick={() => deleteTarget = null} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
				<button onclick={handleDelete} class="bg-[var(--color-error)] text-white px-4 py-2 rounded text-sm">Delete</button>
			</div>
		</div>
	</div>
{/if}
