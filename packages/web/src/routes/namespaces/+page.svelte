<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Plus, Pencil, Trash2, Server, Layers, AlertCircle } from '@lucide/svelte';

	interface Namespace { id: string; name: string; slug: string; description?: string; isPublic: boolean; }
	interface ServerItem { id: string; name: string; transport: string; }

	let namespaces = $state<Namespace[]>([]);
	let allServers = $state<ServerItem[]>([]);
	let nsServerMap = $state<Record<string, ServerItem[]>>({});
	let loading = $state(true);
	let showDialog = $state(false);
	let editingNs = $state<Namespace | null>(null);
	let deleteTarget = $state<Namespace | null>(null);
	let managingNs = $state<Namespace | null>(null);
	let nsServers = $state<ServerItem[]>([]);
	let error = $state<string | null>(null);
	let form = $state({ name: '', description: '', isPublic: false });

	async function load() {
		try {
			const [nsResult, srvResult] = await Promise.all([trpc.namespaces.list.query(), trpc.servers.list.query()]);
			namespaces = (nsResult as unknown as { namespaces: Namespace[] }).namespaces ?? (nsResult as unknown as Namespace[]);
			allServers = (srvResult as unknown as { servers: ServerItem[] }).servers ?? (srvResult as unknown as ServerItem[]);
			const map: Record<string, ServerItem[]> = {};
			await Promise.all(namespaces.map(async (ns) => {
				try { const r = await trpc.namespaces.listServers.query({ namespaceId: ns.id }); map[ns.id] = (r as unknown as { servers: ServerItem[] }).servers ?? (r as unknown as ServerItem[]); }
				catch { map[ns.id] = []; }
			}));
			nsServerMap = map;
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	function openAdd() { form = { name: '', description: '', isPublic: false }; editingNs = null; showDialog = true; }
	function openEdit(ns: Namespace) { editingNs = ns; form = { name: ns.name, description: ns.description ?? '', isPublic: ns.isPublic }; showDialog = true; }

	async function handleSubmit() {
		error = null;
		try {
			if (editingNs) { await trpc.namespaces.update.mutate({ id: editingNs.id, data: form }); }
			else { await trpc.namespaces.create.mutate(form); }
			showDialog = false; await load();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed'; }
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try { await trpc.namespaces.delete.mutate({ id: deleteTarget.id }); deleteTarget = null; await load(); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete'; }
	}

	async function openManageServers(ns: Namespace) {
		managingNs = ns;
		try { const r = await trpc.namespaces.listServers.query({ namespaceId: ns.id }); nsServers = (r as unknown as { servers: ServerItem[] }).servers ?? (r as unknown as ServerItem[]); }
		catch { nsServers = []; }
	}

	async function addServerToNs(serverId: string) { if (!managingNs) return; await trpc.namespaces.addServer.mutate({ namespaceId: managingNs.id, serverId }); await openManageServers(managingNs); await load(); }
	async function removeServerFromNs(serverId: string) { if (!managingNs) return; await trpc.namespaces.removeServer.mutate({ namespaceId: managingNs.id, serverId }); await openManageServers(managingNs); await load(); }
	function availableServers() { const ids = new Set(nsServers.map(s => s.id)); return allServers.filter(s => !ids.has(s.id)); }
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Namespaces</h2>
			<p class="text-sm text-muted-foreground">Group servers into logical units</p>
		</div>
		<Button onclick={openAdd}><Plus class="size-4 mr-2" />Create Namespace</Button>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error} <Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button></AlertDescription></Alert>
	{/if}

	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each [1, 2, 3] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-24 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else if namespaces.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Layers class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground mb-4">No namespaces yet. Namespaces group servers for organized access.</p>
				<Button onclick={openAdd}>Create your first namespace</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each namespaces as ns}
				{@const servers = nsServerMap[ns.id] ?? []}
				<Card.Root>
					<Card.Header class="pb-3">
						<div class="flex justify-between items-start">
							<div>
								<Card.Title class="text-base">{ns.name}</Card.Title>
								<p class="text-xs text-muted-foreground font-mono">/{ns.slug}</p>
							</div>
							{#if ns.isPublic}<Badge variant="secondary" class="bg-success/15 text-success border-0">Public</Badge>{/if}
						</div>
					</Card.Header>
					<Card.Content class="pb-3">
						{#if ns.description}<p class="text-sm text-muted-foreground mb-3">{ns.description}</p>{/if}
						<p class="text-xs text-muted-foreground mb-1.5">{servers.length} server{servers.length !== 1 ? 's' : ''}</p>
						{#if servers.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each servers as server}<Badge variant="outline" class="text-xs font-mono">{server.name}</Badge>{/each}
							</div>
						{/if}
					</Card.Content>
					<Separator />
					<Card.Footer class="pt-3 gap-2">
						<Button variant="ghost" size="sm" onclick={() => openManageServers(ns)}><Server class="size-3 mr-1" />Servers</Button>
						<Button variant="ghost" size="sm" onclick={() => openEdit(ns)}><Pencil class="size-3 mr-1" />Edit</Button>
						<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => deleteTarget = ns}><Trash2 class="size-3 mr-1" />Delete</Button>
					</Card.Footer>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<Dialog.Root bind:open={showDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>{editingNs ? 'Edit Namespace' : 'Create Namespace'}</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
			<div class="space-y-2"><Label for="ns-name">Name</Label><Input id="ns-name" bind:value={form.name} required /></div>
			<div class="space-y-2"><Label for="ns-desc">Description</Label><textarea bind:value={form.description} id="ns-desc" class="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"></textarea></div>
			<div class="flex items-center gap-3"><Switch bind:checked={form.isPublic} id="ns-public" /><Label for="ns-public">Public namespace</Label></div>
			<Dialog.Footer><Button variant="outline" type="button" onclick={() => showDialog = false}>Cancel</Button><Button type="submit">{editingNs ? 'Save' : 'Create'}</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!managingNs} onOpenChange={(open) => { if (!open) managingNs = null; }}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header><Dialog.Title>Servers in "{managingNs?.name}"</Dialog.Title></Dialog.Header>
		{#if nsServers.length > 0}
			<div class="mb-4">
				<p class="text-xs text-muted-foreground mb-2">Current servers:</p>
				{#each nsServers as server}
					<div class="flex justify-between items-center py-2 border-b last:border-0">
						<span class="text-sm font-mono">{server.name} <span class="text-xs text-muted-foreground">({server.transport})</span></span>
						<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => removeServerFromNs(server.id)}>Remove</Button>
					</div>
				{/each}
			</div>
		{:else}<p class="text-sm text-muted-foreground mb-4">No servers in this namespace.</p>{/if}
		{#if availableServers().length > 0}
			<div>
				<p class="text-xs text-muted-foreground mb-2">Add server:</p>
				{#each availableServers() as server}
					<div class="flex justify-between items-center py-2 border-b last:border-0">
						<span class="text-sm font-mono">{server.name}</span>
						<Button variant="ghost" size="sm" onclick={() => addServerToNs(server.id)}>Add</Button>
					</div>
				{/each}
			</div>
		{/if}
		<Dialog.Footer><Button variant="outline" onclick={() => managingNs = null}>Close</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!deleteTarget} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header><Dialog.Title>Delete Namespace</Dialog.Title><Dialog.Description>Delete <strong>{deleteTarget?.name}</strong>? This will remove all endpoint and tool configurations.</Dialog.Description></Dialog.Header>
		<Dialog.Footer><Button variant="outline" onclick={() => deleteTarget = null}>Cancel</Button><Button variant="destructive" onclick={handleDelete}>Delete</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
