<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Namespace { id: string; name: string; slug: string; description?: string; isPublic: boolean; }
	interface Server { id: string; name: string; transport: string; }

	let namespaces = $state<Namespace[]>([]);
	let allServers = $state<Server[]>([]);
	let loading = $state(true);
	let showDialog = $state(false);
	let editingNs = $state<Namespace | null>(null);
	let deleteTarget = $state<Namespace | null>(null);
	let managingNs = $state<Namespace | null>(null);
	let nsServers = $state<Server[]>([]);
	let error = $state<string | null>(null);

	let form = $state({ name: '', description: '', isPublic: false });

	async function load() {
		try {
			const [nsResult, srvResult] = await Promise.all([
				trpc.namespaces.list.query(),
				trpc.servers.list.query(),
			]);
			namespaces = (nsResult as unknown as { namespaces: Namespace[] }).namespaces ?? (nsResult as unknown as Namespace[]);
			allServers = (srvResult as unknown as { servers: Server[] }).servers ?? (srvResult as unknown as Server[]);
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	function openAdd() {
		form = { name: '', description: '', isPublic: false };
		editingNs = null;
		showDialog = true;
	}

	function openEdit(ns: Namespace) {
		editingNs = ns;
		form = { name: ns.name, description: ns.description ?? '', isPublic: ns.isPublic };
		showDialog = true;
	}

	async function handleSubmit() {
		error = null;
		try {
			if (editingNs) {
				await trpc.namespaces.update.mutate({ id: editingNs.id, data: form });
			} else {
				await trpc.namespaces.create.mutate(form);
			}
			showDialog = false;
			await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed'; }
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			await trpc.namespaces.delete.mutate({ id: deleteTarget.id });
			deleteTarget = null;
			await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete'; }
	}

	async function openManageServers(ns: Namespace) {
		managingNs = ns;
		try {
			const result = await trpc.namespaces.listServers.query({ namespaceId: ns.id });
			nsServers = (result as unknown as { servers: Server[] }).servers ?? (result as unknown as Server[]);
		} catch { nsServers = []; }
	}

	async function addServerToNs(serverId: string) {
		if (!managingNs) return;
		await trpc.namespaces.addServer.mutate({ namespaceId: managingNs.id, serverId });
		await openManageServers(managingNs);
	}

	async function removeServerFromNs(serverId: string) {
		if (!managingNs) return;
		await trpc.namespaces.removeServer.mutate({ namespaceId: managingNs.id, serverId });
		await openManageServers(managingNs);
	}

	function availableServers() {
		const nsIds = new Set(nsServers.map(s => s.id));
		return allServers.filter(s => !nsIds.has(s.id));
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Namespaces</h2>
		<button onclick={openAdd} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">Create Namespace</button>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">
			{error} <button onclick={() => error = null} class="ml-2 underline">dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if namespaces.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)] mb-4">No namespaces yet. Namespaces group servers for organized access.</p>
			<button onclick={openAdd} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm">Create your first namespace</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each namespaces as ns}
				<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
					<div class="flex justify-between items-start mb-2">
						<div>
							<h3 class="font-medium">{ns.name}</h3>
							<p class="text-xs text-[var(--color-text-muted)]">/{ns.slug}</p>
						</div>
						{#if ns.isPublic}
							<span class="text-xs bg-[var(--color-success)]/20 text-[var(--color-success)] px-2 py-0.5 rounded">Public</span>
						{/if}
					</div>
					{#if ns.description}
						<p class="text-sm text-[var(--color-text-muted)] mb-3">{ns.description}</p>
					{/if}
					<div class="flex gap-2 text-xs">
						<button onclick={() => openManageServers(ns)} class="text-[var(--color-primary)] hover:underline">Servers</button>
						<button onclick={() => openEdit(ns)} class="text-[var(--color-primary)] hover:underline">Edit</button>
						<button onclick={() => deleteTarget = ns} class="text-[var(--color-error)] hover:underline">Delete</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Add/Edit Dialog -->
{#if showDialog}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showDialog = false}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-md border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-4">{editingNs ? 'Edit Namespace' : 'Create Namespace'}</h3>
			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Name</span>
					<input bind:value={form.name} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" required />
				</label>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Description</span>
					<textarea bind:value={form.description} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] h-20 resize-none"></textarea>
				</label>
				<label class="flex items-center gap-2 mb-4">
					<input type="checkbox" bind:checked={form.isPublic} />
					<span class="text-sm text-[var(--color-text-muted)]">Public namespace</span>
				</label>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => showDialog = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
					<button type="submit" class="bg-[var(--color-primary)] text-white px-4 py-2 rounded text-sm">{editingNs ? 'Save' : 'Create'}</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Manage Servers Dialog -->
{#if managingNs}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => managingNs = null}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-lg border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-4">Servers in "{managingNs.name}"</h3>

			{#if nsServers.length > 0}
				<div class="mb-4">
					<p class="text-xs text-[var(--color-text-muted)] mb-2">Current servers:</p>
					{#each nsServers as server}
						<div class="flex justify-between items-center py-1.5 border-b border-[var(--color-border)] last:border-0">
							<span class="text-sm">{server.name} <span class="text-xs text-[var(--color-text-muted)]">({server.transport})</span></span>
							<button onclick={() => removeServerFromNs(server.id)} class="text-xs text-[var(--color-error)] hover:underline">Remove</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-muted)] mb-4">No servers in this namespace.</p>
			{/if}

			{#if availableServers().length > 0}
				<div>
					<p class="text-xs text-[var(--color-text-muted)] mb-2">Add server:</p>
					{#each availableServers() as server}
						<div class="flex justify-between items-center py-1.5 border-b border-[var(--color-border)] last:border-0">
							<span class="text-sm">{server.name}</span>
							<button onclick={() => addServerToNs(server.id)} class="text-xs text-[var(--color-primary)] hover:underline">Add</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex justify-end mt-4">
				<button onclick={() => managingNs = null} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Close</button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete Confirmation -->
{#if deleteTarget}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => deleteTarget = null}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-sm border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-2">Delete Namespace</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">Delete <strong>{deleteTarget.name}</strong>? This will remove all endpoint and tool configurations.</p>
			<div class="flex justify-end gap-2">
				<button onclick={() => deleteTarget = null} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
				<button onclick={handleDelete} class="bg-[var(--color-error)] text-white px-4 py-2 rounded text-sm">Delete</button>
			</div>
		</div>
	</div>
{/if}
