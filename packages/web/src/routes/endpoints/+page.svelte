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

	function authLabel(type: string): string {
		switch (type) {
			case 'api_key': return 'API Key';
			case 'bearer': return 'Bearer';
			case 'oauth': return 'OAuth';
			case 'none': return 'None';
			default: return type;
		}
	}

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
		<div>
			<h2 class="text-2xl font-bold">Endpoints</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Expose namespaces to MCP clients</p>
		</div>
		<button onclick={() => { form = { namespaceId: namespaces[0]?.id ?? '', name: '', transport: 'sse', authType: 'api_key', rateLimit: 100 }; showDialog = true; }} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
			Create Endpoint
		</button>
	</div>

	{#if error}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">{error}</div>
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
				<thead>
					<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
						<th class="text-left px-4 py-2.5 font-medium">Name</th>
						<th class="text-left px-4 py-2.5 font-medium">Namespace</th>
						<th class="text-left px-4 py-2.5 font-medium">Transport</th>
						<th class="text-left px-4 py-2.5 font-medium">Auth</th>
						<th class="text-left px-4 py-2.5 font-medium">Rate Limit</th>
						<th class="text-left px-4 py-2.5 font-medium">Status</th>
						<th class="text-right px-4 py-2.5 font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each endpoints as ep}
						<tr class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/20">
							<td class="px-4 py-2.5">
								<span class="font-mono text-xs font-medium">{ep.name}</span>
								<p class="text-[10px] text-[var(--color-text-muted)]">/{ep.slug}</p>
							</td>
							<td class="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{nsName(ep.namespaceId)}</td>
							<td class="px-4 py-2.5">
								<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{ep.transport}</span>
							</td>
							<td class="px-4 py-2.5">
								<span class="text-xs px-2 py-0.5 rounded" style="background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary);">{authLabel(ep.authType)}</span>
							</td>
							<td class="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{ep.rateLimit}/min</td>
							<td class="px-4 py-2.5">
								<span class="inline-flex items-center gap-1.5">
									<span class="w-2 h-2 rounded-full" style="background: {ep.isActive ? 'var(--color-success)' : 'var(--color-text-muted)'};"></span>
									<span class="text-xs">{ep.isActive ? 'Active' : 'Inactive'}</span>
								</span>
							</td>
							<td class="px-4 py-2.5 text-right">
								<button onclick={() => deleteTarget = ep} class="text-[var(--color-error)] hover:underline text-xs">Delete</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-3 text-xs text-[var(--color-text-muted)]">
			{endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''} configured
		</div>
	{/if}
</div>

{#if showDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
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
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
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
