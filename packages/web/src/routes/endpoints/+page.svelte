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
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Plus, Trash2, Globe, AlertCircle } from '@lucide/svelte';

	interface Endpoint { id: string; namespaceId: string; name: string; slug: string; transport: string; isActive: boolean; authType: string; rateLimit: number; }
	interface Namespace { id: string; name: string; }

	let endpoints = $state<Endpoint[]>([]);
	let namespaces = $state<Namespace[]>([]);
	let loading = $state(true);
	let showDialog = $state(false);
	let deleteTarget = $state<Endpoint | null>(null);
	let error = $state<string | null>(null);
	let form = $state({ namespaceId: '', name: '', transport: 'sse' as string, authType: 'api_key' as string, rateLimit: 100 });

	async function load() {
		try {
			const [epResult, nsResult] = await Promise.all([trpc.endpoints.list.query(), trpc.namespaces.list.query()]);
			endpoints = (epResult as unknown as { endpoints: Endpoint[] }).endpoints ?? (epResult as unknown as Endpoint[]);
			namespaces = (nsResult as unknown as { namespaces: Namespace[] }).namespaces ?? (nsResult as unknown as Namespace[]);
		} catch { error = 'Failed to load'; }
		loading = false;
	}
	onMount(load);

	function nsName(id: string) { return namespaces.find(n => n.id === id)?.name ?? id; }
	function authLabel(type: string): string { return ({ api_key: 'API Key', bearer: 'Bearer', oauth: 'OAuth', none: 'None' })[type] ?? type; }

	async function handleCreate() {
		error = null;
		try { await trpc.endpoints.create.mutate(form as never); showDialog = false; await load(); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to create'; }
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try { await trpc.endpoints.delete.mutate({ id: deleteTarget.id }); deleteTarget = null; await load(); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete'; }
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Endpoints</h2>
			<p class="text-sm text-muted-foreground">Expose namespaces to MCP clients</p>
		</div>
		<Button onclick={() => { form = { namespaceId: namespaces[0]?.id ?? '', name: '', transport: 'sse', authType: 'api_key', rateLimit: 100 }; showDialog = true; }}><Plus class="size-4 mr-2" />Create Endpoint</Button>
	</div>

	{#if error}<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else if endpoints.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Globe class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No endpoints created yet. Endpoints expose namespaces to MCP clients.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Namespace</Table.Head>
							<Table.Head>Transport</Table.Head>
							<Table.Head>Auth</Table.Head>
							<Table.Head>Rate Limit</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each endpoints as ep}
							<Table.Row>
								<Table.Cell>
									<span class="font-mono text-xs font-medium">{ep.name}</span>
									<p class="text-xs text-muted-foreground">/{ep.slug}</p>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{nsName(ep.namespaceId)}</Table.Cell>
								<Table.Cell><Badge variant="secondary">{ep.transport}</Badge></Table.Cell>
								<Table.Cell><Badge variant="outline">{authLabel(ep.authType)}</Badge></Table.Cell>
								<Table.Cell class="text-muted-foreground">{ep.rateLimit}/min</Table.Cell>
								<Table.Cell><Badge variant={ep.isActive ? 'default' : 'outline'}>{ep.isActive ? 'Active' : 'Inactive'}</Badge></Table.Cell>
								<Table.Cell class="text-right"><Button variant="ghost" size="icon" onclick={() => deleteTarget = ep}><Trash2 class="size-4 text-destructive" /></Button></Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
		<p class="mt-3 text-xs text-muted-foreground">{endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''} configured</p>
	{/if}
</div>

<Dialog.Root bind:open={showDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>Create Endpoint</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleCreate(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="ep-ns">Namespace</Label>
				<select bind:value={form.namespaceId} id="ep-ns" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" required>
					{#each namespaces as ns}<option value={ns.id}>{ns.name}</option>{/each}
				</select>
			</div>
			<div class="space-y-2"><Label for="ep-name">Name</Label><Input id="ep-name" bind:value={form.name} required /></div>
			<div class="space-y-2">
				<Label for="ep-transport">Transport</Label>
				<select bind:value={form.transport} id="ep-transport" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					<option value="sse">SSE</option><option value="streamable-http">Streamable HTTP</option><option value="openapi">OpenAPI</option>
				</select>
			</div>
			<div class="space-y-2">
				<Label for="ep-auth">Auth Type</Label>
				<select bind:value={form.authType} id="ep-auth" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					<option value="api_key">API Key</option><option value="bearer">Bearer Token</option><option value="oauth">OAuth</option><option value="none">None</option>
				</select>
			</div>
			<div class="space-y-2"><Label for="ep-rate">Rate Limit (requests/min)</Label><Input id="ep-rate" type="number" bind:value={form.rateLimit} /></div>
			<Dialog.Footer><Button variant="outline" type="button" onclick={() => showDialog = false}>Cancel</Button><Button type="submit">Create</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!deleteTarget} onOpenChange={(open) => { if (!open) deleteTarget = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header><Dialog.Title>Delete Endpoint</Dialog.Title><Dialog.Description>Delete <strong>{deleteTarget?.name}</strong>?</Dialog.Description></Dialog.Header>
		<Dialog.Footer><Button variant="outline" onclick={() => deleteTarget = null}>Cancel</Button><Button variant="destructive" onclick={handleDelete}>Delete</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
