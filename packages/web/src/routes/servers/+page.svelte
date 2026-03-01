<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Server {
		id: string;
		name: string;
		displayName: string;
		transport: string;
		status: string;
		command?: string;
		url?: string;
		proxyType?: string;
		needsProxy?: boolean;
		createdAt?: string;
	}

	let servers = $state<Server[]>([]);
	let loading = $state(true);
	let showAddDialog = $state(false);
	let editingServer = $state<Server | null>(null);
	let deleteTarget = $state<Server | null>(null);
	let error = $state<string | null>(null);

	let form = $state({
		name: '',
		transport: 'stdio' as 'stdio' | 'sse' | 'streamable-http',
		command: '',
		args: '',
		url: '',
		proxyType: 'mcpo',
		needsProxy: true,
	});

	async function loadServers() {
		try {
			const result = await trpc.servers.list.query();
			servers = (result as unknown as { servers: Server[] }).servers ?? (result as unknown as Server[]);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Failed to connect to backend';
			error = msg.includes('FORBIDDEN') ? 'Insufficient permissions to view servers' : msg;
		}
		loading = false;
	}

	onMount(loadServers);

	function resetForm() {
		form = { name: '', transport: 'stdio', command: '', args: '', url: '', proxyType: 'mcpo', needsProxy: true };
	}

	function openAdd() {
		resetForm();
		editingServer = null;
		showAddDialog = true;
	}

	function openEdit(server: Server) {
		editingServer = server;
		form = {
			name: server.name,
			transport: server.transport as 'stdio' | 'sse' | 'streamable-http',
			command: server.command ?? '',
			args: '',
			url: server.url ?? '',
			proxyType: server.proxyType ?? 'mcpo',
			needsProxy: server.needsProxy ?? true,
		};
		showAddDialog = true;
	}

	async function handleSubmit() {
		error = null;
		try {
			const input: Record<string, unknown> = {
				name: form.name,
				transport: form.transport,
				proxyType: form.proxyType,
				needsProxy: form.needsProxy,
			};
			if (form.transport === 'stdio') {
				input.command = form.command;
				if (form.args.trim()) input.args = form.args.split(' ');
			} else {
				input.url = form.url;
			}

			if (editingServer) {
				await trpc.servers.update.mutate({ id: editingServer.id, data: input as never });
			} else {
				await trpc.servers.create.mutate(input as never);
			}
			showAddDialog = false;
			await loadServers();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to save server';
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			await trpc.servers.delete.mutate({ id: deleteTarget.id });
			deleteTarget = null;
			await loadServers();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to delete server';
		}
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Servers</h2>
		<button onclick={openAdd} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
			Add Server
		</button>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">
			{error}
			<button onclick={() => error = null} class="ml-2 underline">dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if servers.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)] mb-4">No servers configured yet.</p>
			<button onclick={openAdd} class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm">
				Add your first server
			</button>
		</div>
	{:else}
		<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
			<table class="w-full text-sm">
				<thead class="border-b border-[var(--color-border)]">
					<tr class="text-left text-[var(--color-text-muted)]">
						<th class="p-3">Name</th>
						<th class="p-3">Transport</th>
						<th class="p-3">Status</th>
						<th class="p-3">Proxy</th>
						<th class="p-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each servers as server}
						<tr class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/30">
							<td class="p-3">
								<span class="font-medium">{server.displayName || server.name}</span>
								<span class="text-xs text-[var(--color-text-muted)] ml-1">({server.id})</span>
							</td>
							<td class="p-3">
								<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{server.transport}</span>
							</td>
							<td class="p-3">
								<span class="inline-flex items-center gap-1.5">
									<span class="w-2 h-2 rounded-full" class:bg-[var(--color-success)]={server.status === 'active'} class:bg-[var(--color-text-muted)]={server.status !== 'active'}></span>
									{server.status}
								</span>
							</td>
							<td class="p-3 text-xs text-[var(--color-text-muted)]">{server.proxyType ?? 'mcpo'}</td>
							<td class="p-3 text-right">
								<button onclick={() => openEdit(server)} class="text-[var(--color-primary)] hover:underline text-xs mr-3">Edit</button>
								<button onclick={() => deleteTarget = server} class="text-[var(--color-error)] hover:underline text-xs">Delete</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Add/Edit Dialog -->
{#if showAddDialog}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showAddDialog = false}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-md border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-4">{editingServer ? 'Edit Server' : 'Add Server'}</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Name</span>
					<input bind:value={form.name} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" required disabled={!!editingServer} />
				</label>

				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Transport</span>
					<select bind:value={form.transport} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none">
						<option value="stdio">stdio</option>
						<option value="sse">SSE</option>
						<option value="streamable-http">Streamable HTTP</option>
					</select>
				</label>

				{#if form.transport === 'stdio'}
					<label class="block mb-3">
						<span class="text-sm text-[var(--color-text-muted)]">Command</span>
						<input bind:value={form.command} placeholder="npx -y @modelcontextprotocol/server-memory" class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" />
					</label>
					<label class="block mb-3">
						<span class="text-sm text-[var(--color-text-muted)]">Arguments (space-separated)</span>
						<input bind:value={form.args} placeholder="--flag value" class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" />
					</label>
				{:else}
					<label class="block mb-3">
						<span class="text-sm text-[var(--color-text-muted)]">URL</span>
						<input bind:value={form.url} placeholder="http://localhost:8080/sse" class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" />
					</label>
				{/if}

				<label class="block mb-3">
					<span class="text-sm text-[var(--color-text-muted)]">Proxy Type</span>
					<select bind:value={form.proxyType} class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none">
						<option value="mcpo">MCPO</option>
						<option value="mcp-bridge">MCP Bridge</option>
						<option value="supergateway">SuperGateway</option>
					</select>
				</label>

				<label class="flex items-center gap-2 mb-4">
					<input type="checkbox" bind:checked={form.needsProxy} class="rounded" />
					<span class="text-sm text-[var(--color-text-muted)]">Needs proxy</span>
				</label>

				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => showAddDialog = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-white">Cancel</button>
					<button type="submit" class="bg-[var(--color-primary)] text-white px-4 py-2 rounded text-sm hover:opacity-90">
						{editingServer ? 'Save' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Delete Confirmation -->
{#if deleteTarget}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => deleteTarget = null}>
		<div class="bg-[var(--color-surface)] rounded-lg p-6 w-full max-w-sm border border-[var(--color-border)]" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-lg font-bold mb-2">Delete Server</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button onclick={() => deleteTarget = null} class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-white">Cancel</button>
				<button onclick={handleDelete} class="bg-[var(--color-error)] text-white px-4 py-2 rounded text-sm hover:opacity-90">Delete</button>
			</div>
		</div>
	</div>
{/if}
