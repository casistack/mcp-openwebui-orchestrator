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
	import ScrollArea from '$lib/components/ui/scroll-area/scroll-area.svelte';
	import { Plus, Pencil, Trash2, Server, AlertCircle, Play, Square, RotateCcw, FileText } from '@lucide/svelte';

	interface ServerItem { id: string; name: string; displayName: string; transport: string; status: string; command?: string; url?: string; proxyType?: string; needsProxy?: boolean; }
	interface Connection { serverId: string; status: string; toolCount: number; lastPingMs: number | null; lastError: string | null; }
	interface RuntimeInfo { serverId: string; status: string; pid: number | null; port: number | null; proxyType: string | null; startedAt: string | null; restartCount: number; healthy: boolean; lastError: string | null; }
	interface LogEntry { stream: string; message: string; createdAt: string | null; }

	let servers = $state<ServerItem[]>([]);
	let connections = $state<Connection[]>([]);
	let runtimeMap = $state<Record<string, RuntimeInfo>>({});
	let runtimeEnabled = $state(false);
	let loading = $state(true);
	let showAddDialog = $state(false);
	let editingServer = $state<ServerItem | null>(null);
	let deleteTarget = $state<ServerItem | null>(null);
	let logsTarget = $state<ServerItem | null>(null);
	let logs = $state<LogEntry[]>([]);
	let logsLoading = $state(false);
	let actionLoading = $state<Record<string, boolean>>({});
	let bulkActionLoading = $state(false);
	let error = $state<string | null>(null);
	let form = $state({ name: '', transport: 'stdio' as 'stdio' | 'sse' | 'streamable-http', command: '', args: '', url: '', proxyType: 'mcpo', needsProxy: true });

	// Bulk selection
	let selected = $state<Set<string>>(new Set());
	let bulkDeleting = $state(false);
	let showBulkDeleteDialog = $state(false);

	let allSelected = $derived(servers.length > 0 && selected.size === servers.length);
	let someSelected = $derived(selected.size > 0 && selected.size < servers.length);

	function toggleSelect(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function toggleSelectAll() {
		if (allSelected) {
			selected = new Set();
		} else {
			selected = new Set(servers.map(s => s.id));
		}
	}

	async function handleBulkDelete() {
		if (selected.size === 0) return;
		bulkDeleting = true;
		let failed = 0;
		for (const id of selected) {
			try {
				await trpc.servers.delete.mutate({ id });
			} catch {
				failed++;
			}
		}
		selected = new Set();
		showBulkDeleteDialog = false;
		bulkDeleting = false;
		if (failed > 0) error = `Failed to delete ${failed} server(s)`;
		await loadServers();
	}

	async function loadServers() {
		try {
			const [result, conns] = await Promise.all([trpc.servers.list.query(), trpc.connections.list.query().catch(() => [])]);
			servers = (result as unknown as { servers: ServerItem[] }).servers ?? (result as unknown as ServerItem[]);
			connections = conns as Connection[];
			// Clear stale selections
			const ids = new Set(servers.map(s => s.id));
			selected = new Set([...selected].filter(id => ids.has(id)));
			await loadRuntimeStatus();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Failed to connect to backend';
			error = msg.includes('FORBIDDEN') ? 'Insufficient permissions to view servers' : msg;
		}
		loading = false;
	}

	async function loadRuntimeStatus() {
		try {
			const enabled = await trpc.runtime.enabled.query();
			runtimeEnabled = (enabled as { enabled: boolean }).enabled;
			if (!runtimeEnabled) return;
			const running = await trpc.runtime.listRunning.query() as RuntimeInfo[];
			const map: Record<string, RuntimeInfo> = {};
			for (const r of running) map[r.serverId] = r;
			runtimeMap = map;
		} catch {
			// Runtime service not available
		}
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

	async function handleRuntimeAction(serverId: string, action: 'start' | 'stop' | 'restart') {
		actionLoading = { ...actionLoading, [serverId]: true };
		try {
			if (action === 'start') await trpc.runtime.start.mutate({ serverId });
			else if (action === 'stop') await trpc.runtime.stop.mutate({ serverId });
			else await trpc.runtime.restart.mutate({ serverId });
			await loadRuntimeStatus();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : `Failed to ${action} server`;
		}
		actionLoading = { ...actionLoading, [serverId]: false };
	}

	async function openLogs(server: ServerItem) {
		logsTarget = server;
		logsLoading = true;
		try {
			logs = await trpc.runtime.logs.query({ serverId: server.id, limit: 100 }) as LogEntry[];
		} catch {
			logs = [];
		}
		logsLoading = false;
	}

	async function refreshLogs() {
		if (!logsTarget) return;
		logsLoading = true;
		try {
			logs = await trpc.runtime.logs.query({ serverId: logsTarget.id, limit: 100 }) as LogEntry[];
		} catch {
			logs = [];
		}
		logsLoading = false;
	}

	async function handleStartAll() {
		bulkActionLoading = true;
		try {
			const result = await trpc.runtime.startAll.mutate() as { started: number; failed: number };
			if (result.failed > 0) error = `Started ${result.started}, failed ${result.failed}`;
			await loadRuntimeStatus();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to start all'; }
		bulkActionLoading = false;
	}

	async function handleStopAll() {
		bulkActionLoading = true;
		try {
			await trpc.runtime.stopAll.mutate();
			await loadRuntimeStatus();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to stop all'; }
		bulkActionLoading = false;
	}

	function getConnection(id: string) { return connections.find(c => c.serverId === id); }
	function connectionStatus(server: ServerItem): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		const conn = getConnection(server.id);
		if (!conn) { return server.status === 'active' ? { label: 'connected', variant: 'default' } : { label: 'disconnected', variant: 'outline' }; }
		if (conn.status === 'connected') return { label: 'connected', variant: 'default' };
		if (conn.status === 'connecting' || conn.status === 'reconnecting') return { label: conn.status, variant: 'secondary' };
		return { label: conn.status || 'error', variant: 'destructive' };
	}

	function runtimeBadge(serverId: string): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		const rt = runtimeMap[serverId];
		if (!rt) return { label: 'stopped', variant: 'outline' };
		if (rt.status === 'running' && rt.healthy) return { label: 'running', variant: 'default' };
		if (rt.status === 'running' || rt.status === 'starting') return { label: rt.status, variant: 'secondary' };
		if (rt.status === 'error' || rt.status === 'crashed') return { label: rt.status, variant: 'destructive' };
		return { label: rt.status, variant: 'outline' };
	}

	function isRunning(serverId: string): boolean {
		const rt = runtimeMap[serverId];
		return !!rt && (rt.status === 'running' || rt.status === 'starting');
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Servers</h2>
			<p class="text-sm text-muted-foreground">Manage MCP server connections and runtime processes</p>
		</div>
		<div class="flex items-center gap-2">
			{#if selected.size > 0}
				<Button variant="destructive" size="sm" onclick={() => showBulkDeleteDialog = true}>
					<Trash2 class="size-4 mr-1" />Delete {selected.size} selected
				</Button>
				<Button variant="outline" size="sm" onclick={() => selected = new Set()}>Clear</Button>
			{/if}
			{#if runtimeEnabled && servers.length > 0}
				<Button variant="outline" size="sm" onclick={handleStartAll} disabled={bulkActionLoading}>
					<Play class="size-4 mr-1" />Start All
				</Button>
				<Button variant="outline" size="sm" onclick={handleStopAll} disabled={bulkActionLoading}>
					<Square class="size-4 mr-1" />Stop All
				</Button>
			{/if}
			<Button onclick={openAdd}><Plus class="size-4 mr-2" />Add Server</Button>
		</div>
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
							<Table.Head class="w-10">
								<input
									type="checkbox"
									checked={allSelected}
									indeterminate={someSelected}
									onchange={toggleSelectAll}
									class="size-4 rounded border-input accent-primary cursor-pointer"
								/>
							</Table.Head>
							<Table.Head>Name</Table.Head>
							<Table.Head>Transport</Table.Head>
							<Table.Head>Connection</Table.Head>
							{#if runtimeEnabled}
								<Table.Head>Runtime</Table.Head>
								<Table.Head>Port</Table.Head>
							{/if}
							<Table.Head>Tools</Table.Head>
							<Table.Head>Latency</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each servers as server}
							{@const status = connectionStatus(server)}
							{@const conn = getConnection(server.id)}
							{@const rtBadge = runtimeBadge(server.id)}
							{@const rt = runtimeMap[server.id]}
							<Table.Row class={selected.has(server.id) ? 'bg-muted/50' : ''}>
								<Table.Cell>
									<input
										type="checkbox"
										checked={selected.has(server.id)}
										onchange={() => toggleSelect(server.id)}
										class="size-4 rounded border-input accent-primary cursor-pointer"
									/>
								</Table.Cell>
								<Table.Cell class="font-mono text-xs font-medium"><a href="/servers/{server.id}" class="hover:underline text-primary">{server.displayName || server.name}</a></Table.Cell>
								<Table.Cell><Badge variant="secondary">{server.transport}</Badge></Table.Cell>
								<Table.Cell><Badge variant={status.variant}>{status.label}</Badge></Table.Cell>
								{#if runtimeEnabled}
									<Table.Cell><Badge variant={rtBadge.variant}>{rtBadge.label}</Badge></Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground">{rt?.port ?? '-'}</Table.Cell>
								{/if}
								<Table.Cell class="text-muted-foreground">{conn?.toolCount ?? 0}</Table.Cell>
								<Table.Cell class="font-mono text-xs text-muted-foreground">{conn?.lastPingMs ? `${conn.lastPingMs}ms` : '-'}</Table.Cell>
								<Table.Cell class="text-right space-x-1">
									{#if runtimeEnabled}
										{#if isRunning(server.id)}
											<Button variant="ghost" size="icon" title="Stop" disabled={actionLoading[server.id]} onclick={() => handleRuntimeAction(server.id, 'stop')}>
												<Square class="size-4 text-destructive" />
											</Button>
											<Button variant="ghost" size="icon" title="Restart" disabled={actionLoading[server.id]} onclick={() => handleRuntimeAction(server.id, 'restart')}>
												<RotateCcw class="size-4" />
											</Button>
										{:else}
											<Button variant="ghost" size="icon" title="Start" disabled={actionLoading[server.id]} onclick={() => handleRuntimeAction(server.id, 'start')}>
												<Play class="size-4 text-green-600" />
											</Button>
										{/if}
										<Button variant="ghost" size="icon" title="Logs" onclick={() => openLogs(server)}>
											<FileText class="size-4" />
										</Button>
									{/if}
									<Button variant="ghost" size="icon" onclick={() => openEdit(server)}><Pencil class="size-4" /></Button>
									<Button variant="ghost" size="icon" onclick={() => deleteTarget = server}><Trash2 class="size-4 text-destructive" /></Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
		<p class="mt-3 text-xs text-muted-foreground">{servers.length} server{servers.length !== 1 ? 's' : ''} configured{selected.size > 0 ? ` (${selected.size} selected)` : ''}</p>
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

<!-- Single Delete Confirmation -->
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

<!-- Bulk Delete Confirmation -->
<Dialog.Root bind:open={showBulkDeleteDialog}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete {selected.size} Server{selected.size !== 1 ? 's' : ''}</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete the following servers? This cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-40 overflow-y-auto py-2">
			{#each servers.filter(s => selected.has(s.id)) as server}
				<div class="flex items-center gap-2 py-1 px-1 text-sm">
					<Badge variant="secondary" class="text-xs">{server.transport}</Badge>
					<span class="font-mono text-xs">{server.displayName || server.name}</span>
				</div>
			{/each}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => showBulkDeleteDialog = false} disabled={bulkDeleting}>Cancel</Button>
			<Button variant="destructive" onclick={handleBulkDelete} disabled={bulkDeleting}>
				{bulkDeleting ? 'Deleting...' : `Delete ${selected.size} server${selected.size !== 1 ? 's' : ''}`}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Logs Dialog -->
<Dialog.Root open={!!logsTarget} onOpenChange={(open) => { if (!open) logsTarget = null; }}>
	<Dialog.Content class="sm:max-w-2xl max-h-[80vh]">
		<Dialog.Header>
			<Dialog.Title>Logs: {logsTarget?.displayName || logsTarget?.name}</Dialog.Title>
		</Dialog.Header>
		<div class="flex justify-end mb-2">
			<Button variant="outline" size="sm" onclick={refreshLogs} disabled={logsLoading}>
				<RotateCcw class="size-3 mr-1" />Refresh
			</Button>
		</div>
		<ScrollArea class="h-[400px] rounded-md border p-3 bg-muted/50">
			{#if logsLoading}
				<Skeleton class="h-6 w-full mb-2" />
				<Skeleton class="h-6 w-3/4 mb-2" />
				<Skeleton class="h-6 w-5/6" />
			{:else if logs.length === 0}
				<p class="text-sm text-muted-foreground text-center py-8">No logs available</p>
			{:else}
				<pre class="text-xs font-mono whitespace-pre-wrap">{#each logs as log}<span class={log.stream === 'stderr' ? 'text-red-500' : 'text-muted-foreground'}>{log.message}
</span>{/each}</pre>
			{/if}
		</ScrollArea>
	</Dialog.Content>
</Dialog.Root>
