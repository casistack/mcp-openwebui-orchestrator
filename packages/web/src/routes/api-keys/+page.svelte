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
	import { Plus, Key, Copy, AlertCircle, CheckCircle } from '@lucide/svelte';

	interface ApiKey { id: string; name: string; keyPrefix: string; scope: string; rateLimit: number; isActive: boolean; lastUsedAt?: string; expiresAt?: string; createdAt: string; }

	let keys = $state<ApiKey[]>([]);
	let loading = $state(true);
	let showCreate = $state(false);
	let newKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let form = $state({ name: '', scope: 'user' as string, rateLimit: 100 });

	async function load() {
		try { const result = await trpc.apiKeys.list.query(); keys = (result as unknown as { apiKeys: ApiKey[] }).apiKeys ?? (result as unknown as ApiKey[]); }
		catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	async function handleCreate() {
		error = null;
		try { const result = await trpc.apiKeys.create.mutate(form); newKey = (result as unknown as { rawKey: string }).rawKey; showCreate = false; await load(); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to create'; }
	}

	async function revokeKey(id: string) {
		try { await trpc.apiKeys.revoke.mutate({ id }); await load(); }
		catch { error = 'Failed to revoke'; }
	}

	async function deleteKey(id: string) {
		try { await trpc.apiKeys.delete.mutate({ id }); await load(); }
		catch { error = 'Failed to delete'; }
	}

	function formatDate(d: string): string { return new Date(d).toLocaleDateString(); }
	function expiryDisplay(key: ApiKey): string { return key.expiresAt ? formatDate(key.expiresAt) : 'Never'; }

	function scopeVariant(scope: string): 'default' | 'secondary' | 'outline' {
		switch (scope) {
			case 'user': return 'default';
			case 'namespace': return 'secondary';
			default: return 'outline';
		}
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">API Keys</h2>
			<p class="text-sm text-muted-foreground">Manage programmatic access credentials</p>
		</div>
		<Button onclick={() => { form = { name: '', scope: 'user', rateLimit: 100 }; showCreate = true; }}><Plus class="size-4 mr-2" />Create API Key</Button>
	</div>

	{#if error}<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>{/if}

	{#if newKey}
		<Alert class="mb-4 border-success bg-success/10">
			<CheckCircle class="size-4 text-success" />
			<AlertDescription>
				<p class="font-semibold mb-1">API Key Created</p>
				<p class="text-xs text-muted-foreground mb-2">Copy this key now. It will not be shown again.</p>
				<code class="block bg-muted p-2 rounded text-sm break-all select-all font-mono">{newKey}</code>
				<Button variant="ghost" size="sm" class="mt-2" onclick={() => newKey = null}>Dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else if keys.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Key class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No API keys. Create one for programmatic access.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Key</Table.Head>
							<Table.Head>Scope</Table.Head>
							<Table.Head>Created</Table.Head>
							<Table.Head>Expires</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each keys as key}
							<Table.Row>
								<Table.Cell>
									<span class="font-medium text-xs">{key.name}</span>
									<Badge variant={key.isActive ? 'default' : 'outline'} class="ml-2 text-xs">{key.isActive ? 'Active' : 'Revoked'}</Badge>
								</Table.Cell>
								<Table.Cell><code class="text-xs font-mono text-muted-foreground">{key.keyPrefix}...</code></Table.Cell>
								<Table.Cell><Badge variant={scopeVariant(key.scope)}>{key.scope}</Badge></Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">{formatDate(key.createdAt)}</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">{expiryDisplay(key)}</Table.Cell>
								<Table.Cell class="text-right">
									{#if key.isActive}
										<Button variant="ghost" size="sm" class="text-warning" onclick={() => revokeKey(key.id)}>Revoke</Button>
									{/if}
									<Button variant="ghost" size="sm" class="text-destructive" onclick={() => deleteKey(key.id)}>Delete</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
		<p class="mt-3 text-xs text-muted-foreground">{keys.length} key{keys.length !== 1 ? 's' : ''} total</p>
	{/if}
</div>

<Dialog.Root bind:open={showCreate}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>Create API Key</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleCreate(); }} class="space-y-4">
			<div class="space-y-2"><Label for="key-name">Name</Label><Input id="key-name" bind:value={form.name} placeholder="My API Key" required /></div>
			<div class="space-y-2">
				<Label for="key-scope">Scope</Label>
				<select bind:value={form.scope} id="key-scope" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					<option value="user">User (all my resources)</option>
					<option value="namespace">Namespace</option>
					<option value="endpoint">Endpoint</option>
				</select>
			</div>
			<div class="space-y-2"><Label for="key-rate">Rate Limit (requests/min)</Label><Input id="key-rate" type="number" bind:value={form.rateLimit} /></div>
			<Dialog.Footer><Button variant="outline" type="button" onclick={() => showCreate = false}>Cancel</Button><Button type="submit">Create</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
