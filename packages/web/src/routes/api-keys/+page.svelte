<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface ApiKey { id: string; name: string; keyPrefix: string; scope: string; rateLimit: number; isActive: boolean; lastUsedAt?: string; expiresAt?: string; createdAt: string; }

	let keys = $state<ApiKey[]>([]);
	let loading = $state(true);
	let showCreate = $state(false);
	let newKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let form = $state({ name: '', scope: 'user' as 'user' | 'namespace' | 'endpoint', rateLimit: 100 });

	async function load() {
		try {
			const result = await trpc.apiKeys.list.query();
			keys = (result as unknown as { apiKeys: ApiKey[] }).apiKeys ?? (result as unknown as ApiKey[]);
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	async function handleCreate() {
		error = null;
		try {
			const result = await trpc.apiKeys.create.mutate(form);
			newKey = (result as unknown as { rawKey: string }).rawKey;
			showCreate = false;
			await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to create'; }
	}

	async function revokeKey(id: string) {
		try {
			await trpc.apiKeys.revoke.mutate({ id });
			await load();
		} catch { error = 'Failed to revoke'; }
	}

	async function deleteKey(id: string) {
		try {
			await trpc.apiKeys.delete.mutate({ id });
			await load();
		} catch { error = 'Failed to delete'; }
	}

	function formatDate(d: string): string {
		return new Date(d).toLocaleDateString();
	}

	function expiryDisplay(key: ApiKey): string {
		if (!key.expiresAt) return 'Never';
		return formatDate(key.expiresAt);
	}

	function scopeColor(scope: string): string {
		switch (scope) {
			case 'user': return 'var(--color-primary)';
			case 'namespace': return 'var(--color-success)';
			case 'endpoint': return 'var(--color-warning)';
			default: return 'var(--color-text-muted)';
		}
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold">API Keys</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Manage programmatic access credentials</p>
		</div>
		<button onclick={() => { form = { name: '', scope: 'user', rateLimit: 100 }; showCreate = true; }} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
			Create API Key
		</button>
	</div>

	{#if error}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">{error}</div>
	{/if}

	<!-- New key display -->
	{#if newKey}
		<div class="rounded-lg p-4 mb-4 border" style="background: color-mix(in srgb, var(--color-success) 10%, transparent); border-color: var(--color-success);">
			<p class="text-sm font-bold mb-1">API Key Created</p>
			<p class="text-xs text-[var(--color-text-muted)] mb-2">Copy this key now. It will not be shown again.</p>
			<code class="block bg-[var(--color-bg)] p-2 rounded text-sm break-all select-all">{newKey}</code>
			<button onclick={() => newKey = null} class="mt-2 text-xs text-[var(--color-text-muted)] hover:underline">Dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if keys.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)]">No API keys. Create one for programmatic access.</p>
		</div>
	{:else}
		<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
						<th class="text-left px-4 py-2.5 font-medium">Name</th>
						<th class="text-left px-4 py-2.5 font-medium">Key</th>
						<th class="text-left px-4 py-2.5 font-medium">Scope</th>
						<th class="text-left px-4 py-2.5 font-medium">Created</th>
						<th class="text-left px-4 py-2.5 font-medium">Expires</th>
						<th class="text-right px-4 py-2.5 font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each keys as key}
						<tr class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/20">
							<td class="px-4 py-2.5">
								<span class="font-medium text-xs">{key.name}</span>
								<span class="ml-2 inline-flex items-center gap-1">
									<span class="w-1.5 h-1.5 rounded-full" style="background: {key.isActive ? 'var(--color-success)' : 'var(--color-error)'};"></span>
									<span class="text-[10px] text-[var(--color-text-muted)]">{key.isActive ? 'Active' : 'Revoked'}</span>
								</span>
							</td>
							<td class="px-4 py-2.5"><code class="text-xs font-mono text-[var(--color-text-muted)]">{key.keyPrefix}...</code></td>
							<td class="px-4 py-2.5">
								<span class="text-xs px-2 py-0.5 rounded" style="background: color-mix(in srgb, {scopeColor(key.scope)} 15%, transparent); color: {scopeColor(key.scope)};">{key.scope}</span>
							</td>
							<td class="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{formatDate(key.createdAt)}</td>
							<td class="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{expiryDisplay(key)}</td>
							<td class="px-4 py-2.5 text-right">
								{#if key.isActive}
									<button onclick={() => revokeKey(key.id)} class="text-[var(--color-warning)] hover:underline text-xs mr-2">Revoke</button>
								{/if}
								<button onclick={() => deleteKey(key.id)} class="text-[var(--color-error)] hover:underline text-xs">Delete</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-3 text-xs text-[var(--color-text-muted)]">
			{keys.length} key{keys.length !== 1 ? 's' : ''} total
		</div>
	{/if}
</div>

{#if showCreate}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showCreate = false}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-md border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-4">Create API Key</h3>
			<form onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Name</span>
					<input bind:value={form.name} placeholder="My API Key" class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none" required />
				</label>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Scope</span>
					<select bind:value={form.scope} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none">
						<option value="user">User (all my resources)</option>
						<option value="namespace">Namespace</option>
						<option value="endpoint">Endpoint</option>
					</select>
				</label>
				<label class="block mb-4">
					<span class="text-sm text-[var(--color-text-muted)]">Rate Limit</span>
					<input type="number" bind:value={form.rateLimit} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none" />
				</label>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => showCreate = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
					<button type="submit" class="bg-[var(--color-primary)] text-white px-4 py-2 rounded text-sm">Create</button>
				</div>
			</form>
		</div>
	</div>
{/if}
