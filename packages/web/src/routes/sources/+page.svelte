<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		Plus, RefreshCw, Trash2, Pencil, ChevronDown, ChevronRight,
		FolderSync, Globe, FileText, AlertCircle, Check, X, ArrowUp, ArrowDown
	} from '@lucide/svelte';

	interface SourceServer {
		id: string;
		sourceId: string;
		serverKey: string;
		serverName: string;
		serverConfig: string;
		enabled: boolean;
		importedServerId: string | null;
		status: string;
	}

	interface ConfigSource {
		id: string;
		name: string;
		type: string;
		location: string | null;
		enabled: boolean;
		priority: number;
		autoSync: boolean;
		syncIntervalMinutes: number;
		lastSyncAt: string | null;
		lastSyncStatus: string | null;
		lastSyncError: string | null;
		servers?: SourceServer[];
	}

	let sources = $state<ConfigSource[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let syncing = $state<string | null>(null);
	let syncingAll = $state(false);
	let showAddDialog = $state(false);
	let editingSource = $state<ConfigSource | null>(null);
	let deleteTarget = $state<ConfigSource | null>(null);
	let expandedSources = $state<Set<string>>(new Set());

	let form = $state({
		name: '',
		type: 'file' as 'file' | 'url',
		location: '',
		autoSync: false,
		syncIntervalMinutes: 60,
		priority: 0,
	});

	async function load() {
		try {
			const result = await trpc.configSources.list.query();
			// Load servers for each source
			const withServers = await Promise.all(
				(result as ConfigSource[]).map(async (source) => {
					try {
						const full = await trpc.configSources.get.query({ id: source.id });
						return full as ConfigSource;
					} catch {
						return { ...source, servers: [] } as ConfigSource;
					}
				})
			);
			sources = withServers;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sources';
		}
		loading = false;
	}

	onMount(load);

	function openAdd() {
		editingSource = null;
		form = { name: '', type: 'file', location: '', autoSync: false, syncIntervalMinutes: 60, priority: 0 };
		showAddDialog = true;
	}

	function openEdit(source: ConfigSource) {
		editingSource = source;
		form = {
			name: source.name,
			type: source.type as 'file' | 'url',
			location: source.location ?? '',
			autoSync: source.autoSync,
			syncIntervalMinutes: source.syncIntervalMinutes,
			priority: source.priority,
		};
		showAddDialog = true;
	}

	async function handleSubmit() {
		error = null;
		try {
			if (editingSource) {
				await trpc.configSources.update.mutate({
					id: editingSource.id,
					data: {
						name: form.name,
						location: form.location,
						autoSync: form.autoSync,
						syncIntervalMinutes: form.syncIntervalMinutes,
						priority: form.priority,
					},
				});
			} else {
				await trpc.configSources.create.mutate(form);
			}
			showAddDialog = false;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save source';
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			await trpc.configSources.delete.mutate({ id: deleteTarget.id });
			deleteTarget = null;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete';
		}
	}

	async function handleSync(sourceId: string) {
		syncing = sourceId;
		error = null;
		try {
			await trpc.configSources.sync.mutate({ id: sourceId });
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sync failed';
		}
		syncing = null;
	}

	async function handleSyncAll() {
		syncingAll = true;
		error = null;
		try {
			await trpc.configSources.syncAll.mutate();
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sync all failed';
		}
		syncingAll = false;
	}

	async function handleToggleSource(source: ConfigSource) {
		try {
			await trpc.configSources.toggleSource.mutate({ id: source.id, enabled: !source.enabled });
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to toggle source';
		}
	}

	async function handleToggleServer(ss: SourceServer) {
		try {
			await trpc.configSources.toggleServer.mutate({ sourceServerId: ss.id, enabled: !ss.enabled });
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to toggle server';
		}
	}

	async function handleMoveSource(sourceId: string, direction: 'up' | 'down') {
		const idx = sources.findIndex(s => s.id === sourceId);
		if (idx < 0) return;
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= sources.length) return;

		const ordered = sources.map(s => s.id);
		[ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];

		try {
			await trpc.configSources.reorder.mutate({ orderedIds: ordered });
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to reorder';
		}
	}

	function toggleExpanded(id: string) {
		const next = new Set(expandedSources);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedSources = next;
	}

	function formatDate(val: string | null): string {
		if (!val) return 'Never';
		const d = new Date(val);
		if (isNaN(d.getTime())) {
			const ts = Number(val);
			if (!isNaN(ts)) return new Date(ts * 1000).toLocaleString();
			return 'Never';
		}
		return d.toLocaleString();
	}

	function getServerTransport(ss: SourceServer): string {
		try {
			const config = JSON.parse(ss.serverConfig);
			return config.transport ?? 'stdio';
		} catch { return 'unknown'; }
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Config Sources</h2>
			<p class="text-sm text-muted-foreground">Manage server configuration sources — files, URLs, and more</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" onclick={handleSyncAll} disabled={syncingAll}>
				<RefreshCw class="size-4 mr-2 {syncingAll ? 'animate-spin' : ''}" />Sync All
			</Button>
			<Button onclick={openAdd}><Plus class="size-4 mr-2" />Add Source</Button>
		</div>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error} <Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button></AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<div class="space-y-4">
			{#each [1, 2] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-32 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else if sources.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<FolderSync class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground mb-4">No config sources yet. Add a file path or URL to import servers from.</p>
				<Button onclick={openAdd}>Add your first source</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="space-y-4">
			{#each sources as source, idx}
				{@const isExpanded = expandedSources.has(source.id)}
				{@const servers = source.servers ?? []}
				{@const activeCount = servers.filter(s => s.status === 'active').length}
				<Card.Root class={!source.enabled ? 'opacity-60' : ''}>
					<Card.Header class="pb-3">
						<div class="flex justify-between items-start">
							<div class="flex items-center gap-3">
								<button onclick={() => toggleExpanded(source.id)} class="p-0.5 hover:bg-muted rounded">
									{#if isExpanded}<ChevronDown class="size-4" />{:else}<ChevronRight class="size-4" />{/if}
								</button>
								<div>
									<div class="flex items-center gap-2">
										<Card.Title class="text-base">{source.name}</Card.Title>
										<Badge variant="outline" class="text-[10px]">
											{#if source.type === 'file'}<FileText class="size-3 mr-1" />File{:else}<Globe class="size-3 mr-1" />URL{/if}
										</Badge>
										{#if source.autoSync}<Badge variant="secondary" class="text-[10px]">Auto-sync</Badge>{/if}
									</div>
									<p class="text-xs text-muted-foreground font-mono mt-0.5">{source.location ?? 'N/A'}</p>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<span class="text-xs text-muted-foreground">Priority: {source.priority}</span>
								<Switch checked={source.enabled} onCheckedChange={() => handleToggleSource(source)} />
							</div>
						</div>
					</Card.Header>

					<Card.Content class="pb-3">
						<div class="flex items-center gap-4 text-xs text-muted-foreground">
							<span>{activeCount}/{servers.length} server{servers.length !== 1 ? 's' : ''} active</span>
							<span>Last sync: {formatDate(source.lastSyncAt)}</span>
							{#if source.lastSyncStatus === 'success'}
								<Badge variant="secondary" class="text-[10px] bg-green-500/15 text-green-600 border-0"><Check class="size-3 mr-0.5" />Success</Badge>
							{:else if source.lastSyncStatus === 'error'}
								<Badge variant="destructive" class="text-[10px]"><X class="size-3 mr-0.5" />Error</Badge>
							{/if}
						</div>
						{#if source.lastSyncError}
							<p class="text-xs text-destructive mt-1">{source.lastSyncError}</p>
						{/if}
					</Card.Content>

					{#if isExpanded && servers.length > 0}
						<Separator />
						<div class="px-6 py-3">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Server</Table.Head>
										<Table.Head>Transport</Table.Head>
										<Table.Head>Status</Table.Head>
										<Table.Head class="text-right">Enabled</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each servers as ss}
										<Table.Row>
											<Table.Cell class="font-mono text-sm">{ss.serverName}</Table.Cell>
											<Table.Cell><Badge variant="outline" class="text-[10px]">{getServerTransport(ss)}</Badge></Table.Cell>
											<Table.Cell>
												{#if ss.status === 'active'}
													<Badge variant="secondary" class="text-[10px] bg-green-500/15 text-green-600 border-0">Active</Badge>
												{:else if ss.status === 'removed'}
													<Badge variant="destructive" class="text-[10px]">Removed</Badge>
												{:else}
													<Badge variant="secondary" class="text-[10px]">Pending</Badge>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-right">
												<Switch checked={ss.enabled} onCheckedChange={() => handleToggleServer(ss)} />
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					{:else if isExpanded}
						<Separator />
						<div class="px-6 py-4 text-center">
							<p class="text-sm text-muted-foreground">No servers discovered. Try syncing this source.</p>
						</div>
					{/if}

					<Separator />
					<Card.Footer class="pt-3 gap-2">
						<Button variant="ghost" size="sm" onclick={() => handleSync(source.id)} disabled={syncing === source.id}>
							<RefreshCw class="size-3 mr-1 {syncing === source.id ? 'animate-spin' : ''}" />Sync
						</Button>
						<Button variant="ghost" size="sm" onclick={() => openEdit(source)}>
							<Pencil class="size-3 mr-1" />Edit
						</Button>
						{#if idx > 0}
							<Button variant="ghost" size="sm" onclick={() => handleMoveSource(source.id, 'up')}>
								<ArrowUp class="size-3 mr-1" />Up
							</Button>
						{/if}
						{#if idx < sources.length - 1}
							<Button variant="ghost" size="sm" onclick={() => handleMoveSource(source.id, 'down')}>
								<ArrowDown class="size-3 mr-1" />Down
							</Button>
						{/if}
						<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => deleteTarget = source}>
							<Trash2 class="size-3 mr-1" />Delete
						</Button>
					</Card.Footer>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<!-- Add/Edit Source Dialog -->
<Dialog.Root bind:open={showAddDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editingSource ? 'Edit Source' : 'Add Config Source'}</Dialog.Title>
			<Dialog.Description>
				{editingSource ? 'Update this config source.' : 'Add a new file or URL source to import MCP servers from.'}
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="src-name">Name</Label>
				<Input id="src-name" bind:value={form.name} placeholder="My Config" required />
			</div>
			{#if !editingSource}
				<div class="space-y-2">
					<Label for="src-type">Type</Label>
					<select bind:value={form.type} id="src-type" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
						<option value="file">File Path</option>
						<option value="url">Remote URL</option>
					</select>
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="src-location">{form.type === 'file' ? 'File Path' : 'URL'}</Label>
				<Input id="src-location" bind:value={form.location} placeholder={form.type === 'file' ? '/config/claude_desktop_config.json' : 'https://example.com/config.json'} required />
			</div>
			<div class="space-y-2">
				<Label for="src-priority">Priority (higher = higher priority)</Label>
				<Input id="src-priority" type="number" bind:value={form.priority} />
			</div>
			<div class="flex items-center gap-3">
				<Switch bind:checked={form.autoSync} id="src-autosync" />
				<Label for="src-autosync">Auto-sync</Label>
			</div>
			{#if form.autoSync}
				<div class="space-y-2">
					<Label for="src-interval">Sync interval (minutes)</Label>
					<Input id="src-interval" type="number" bind:value={form.syncIntervalMinutes} min={1} />
				</div>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddDialog = false}>Cancel</Button>
				<Button type="submit">{editingSource ? 'Save' : 'Add Source'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Confirmation Dialog -->
<Dialog.Root open={!!deleteTarget} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete Source</Dialog.Title>
			<Dialog.Description>
				Delete <strong>{deleteTarget?.name}</strong>? This will deactivate all servers imported from this source.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => deleteTarget = null}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete}>Delete</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
