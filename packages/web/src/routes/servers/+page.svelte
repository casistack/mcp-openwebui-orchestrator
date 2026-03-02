<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Plus, Pencil, Trash2, Server, AlertCircle } from '@lucide/svelte';

	interface ServerItem { id: string; name: string; displayName: string; transport: string; status: string; command?: string; url?: string; proxyType?: string; needsProxy?: boolean; }
	interface Connection { serverId: string; status: string; toolCount: number; lastPingMs: number | null; lastError: string | null; }

	let servers = $state<ServerItem[]>([]);
	let connections = $state<Connection[]>([]);
	let loading = $state(true);
	let showAddDialog = $state(false);
	let editingServer = $state<ServerItem | null>(null);
	let deleteTarget = $state<ServerItem | null>(null);
	let error = $state<string | null>(null);
	let form = $state({ name: '', transport: 'stdio' as 'stdio' | 'sse' | 'streamable-http', command: '', args: '', url: '', proxyType: 'mcpo', needsProxy: true });

	async function loadServers() {
		try {
			const [result, conns] = await Promise.all([trpc.servers.list.query(), trpc.connections.list.query().catch(() => [])]);
			servers = (result as unknown as { servers: ServerItem[] }).servers ?? (result as unknown as ServerItem[]);
			connections = conns as Connection[];
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Failed to connect to backend';
			error = msg.includes('FORBIDDEN') ? 'Insufficient permissions to view servers' : msg;
		}
		loading = false;
	}

	onMount(loadServers);

	function resetForm() { form = { name: '', transport: 'stdio', command: '', args: '', url: '', proxyType: 'mcpo', needsProxy: true }; }

	function openAdd() { resetForm(); editingServer = null; showAddDialog = true; }
	function openEdit(server: ServerItem) {
		editingServer = server;
		form = { name: server.name, transport: server.transport as typeof form.transport, command: server.command ?? '', args: '', url: server.url ?? '', proxyType: server.proxyType ?? 'mcpo', needsProxy: server.needsProxy ?? true };
		showAddDialog = true;
	}

	async function handleSubmit() {
		error = null;
		try {
			const input: Record<string, unknown> = { name: form.name, transport: form.transport, proxyType: form.proxyType, needsProxy: form.needsProxy };
			if (form.transport === 'stdio') { input.command = form.command; if (form.args.trim()) input.args = form.args.split(' '); }
			else { input.url = form.url; }
			if (editingServer) { await trpc.servers.update.mutate({ id: editingServer.id, data: input as never }); }
			else { await trpc.servers.create.mutate(input as never); }
			showAddDialog = false;
			await loadServers();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to save server'; }
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try { await trpc.servers.delete.mutate({ id: deleteTarget.id }); deleteTarget = null; await loadServers(); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete server'; }
	}

	function getConnection(id: string) { return connections.find(c => c.serverId === id); }
	function connectionStatus(server: ServerItem): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		const conn = getConnection(server.id);
		if (!conn) { return server.status === 'active' ? { label: 'connected', variant: 'default' } : { label: 'disconnected', variant: 'outline' }; }
		if (conn.status === 'connected') return { label: 'connected', variant: 'default' };
		if (conn.status === 'connecting' || conn.status === 'reconnecting') return { label: conn.status, variant: 'secondary' };
		return { label: conn.status || 'error', variant: 'destructive' };
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Servers</h2>
			<p class="text-sm text-muted-foreground">Manage MCP server connections</p>
		</div>
		<Button onclick={openAdd}><Plus class="size-4 mr-2" />Add Server</Button>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}
				<Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else if servers.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Server class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground mb-4">No servers configured yet.</p>
				<Button onclick={openAdd}>Add your first server</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Transport</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Tools</Table.Head>
							<Table.Head>Latency</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each servers as server}
							{@const status = connectionStatus(server)}
							{@const conn = getConnection(server.id)}
							<Table.Row>
								<Table.Cell class="font-mono text-xs font-medium">{server.displayName || server.name}</Table.Cell>
								<Table.Cell><Badge variant="secondary">{server.transport}</Badge></Table.Cell>
								<Table.Cell><Badge variant={status.variant}>{status.label}</Badge></Table.Cell>
								<Table.Cell class="text-muted-foreground">{conn?.toolCount ?? 0}</Table.Cell>
								<Table.Cell class="font-mono text-xs text-muted-foreground">{conn?.lastPingMs ? `${conn.lastPingMs}ms` : '-'}</Table.Cell>
								<Table.Cell class="text-right">
									<Button variant="ghost" size="icon" onclick={() => openEdit(server)}><Pencil class="size-4" /></Button>
									<Button variant="ghost" size="icon" onclick={() => deleteTarget = server}><Trash2 class="size-4 text-destructive" /></Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
		<p class="mt-3 text-xs text-muted-foreground">{servers.length} server{servers.length !== 1 ? 's' : ''} configured</p>
	{/if}
</div>

<!-- Add/Edit Dialog -->
<Dialog.Root bind:open={showAddDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editingServer ? 'Edit Server' : 'Add Server'}</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="srv-name">Name</Label>
				<Input id="srv-name" bind:value={form.name} required disabled={!!editingServer} />
			</div>
			<div class="space-y-2">
				<Label for="srv-transport">Transport</Label>
				<select bind:value={form.transport} id="srv-transport" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					<option value="stdio">stdio</option>
					<option value="sse">SSE</option>
					<option value="streamable-http">Streamable HTTP</option>
				</select>
			</div>
			{#if form.transport === 'stdio'}
				<div class="space-y-2">
					<Label for="srv-cmd">Command</Label>
					<Input id="srv-cmd" bind:value={form.command} placeholder="npx -y @modelcontextprotocol/server-memory" />
				</div>
				<div class="space-y-2">
					<Label for="srv-args">Arguments (space-separated)</Label>
					<Input id="srv-args" bind:value={form.args} placeholder="--flag value" />
				</div>
			{:else}
				<div class="space-y-2">
					<Label for="srv-url">URL</Label>
					<Input id="srv-url" bind:value={form.url} placeholder="http://localhost:8080/sse" />
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="srv-proxy">Proxy Type</Label>
				<select bind:value={form.proxyType} id="srv-proxy" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					<option value="mcpo">MCPO</option>
					<option value="mcp-bridge">MCP Bridge</option>
					<option value="supergateway">SuperGateway</option>
				</select>
			</div>
			<div class="flex items-center gap-3">
				<Switch bind:checked={form.needsProxy} id="srv-needs-proxy" />
				<Label for="srv-needs-proxy">Needs proxy</Label>
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddDialog = false}>Cancel</Button>
				<Button type="submit">{editingServer ? 'Save' : 'Create'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Confirmation -->
<Dialog.Root open={!!deleteTarget} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete Server</Dialog.Title>
			<Dialog.Description>Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => deleteTarget = null}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete}>Delete</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
