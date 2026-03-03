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
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Shield, Plus, Trash2, AlertCircle, Ban, Check } from '@lucide/svelte';

	interface Namespace { id: string; name: string; }
	interface Permission { id: string; userId: string; namespaceId: string; toolName: string; allowed: boolean; }

	let namespaces = $state<Namespace[]>([]);
	let selectedNamespace = $state('');
	let permissions = $state<Permission[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAddDialog = $state(false);
	let addForm = $state({ userId: '', toolName: '', allowed: false });

	onMount(async () => {
		try {
			const ns = await trpc.namespaces.list.query();
			namespaces = ns as Namespace[];
			if (namespaces.length > 0) {
				selectedNamespace = namespaces[0].id;
				await loadPermissions();
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('Not authenticated') || msg.includes('UNAUTHORIZED')) {
				window.location.href = '/login';
				return;
			}
			error = 'Failed to load data';
		}
		loading = false;
	});

	async function loadPermissions() {
		if (!selectedNamespace) return;
		try {
			const result = await trpc.toolPermissions.list.query({ namespaceId: selectedNamespace });
			permissions = result as Permission[];
		} catch {
			permissions = [];
		}
	}

	async function handleAdd() {
		error = null;
		try {
			await trpc.toolPermissions.set.mutate({
				userId: addForm.userId,
				namespaceId: selectedNamespace,
				toolName: addForm.toolName,
				allowed: addForm.allowed,
			});
			showAddDialog = false;
			addForm = { userId: '', toolName: '', allowed: false };
			await loadPermissions();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to add rule';
		}
	}

	async function handleDelete(permId: string) {
		try {
			await trpc.toolPermissions.delete.mutate({ permissionId: permId });
			await loadPermissions();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to delete rule';
		}
	}

	async function handleToggle(perm: Permission) {
		try {
			await trpc.toolPermissions.set.mutate({
				userId: perm.userId,
				namespaceId: perm.namespaceId,
				toolName: perm.toolName,
				allowed: !perm.allowed,
			});
			await loadPermissions();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to update rule';
		}
	}
</script>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Tool Permissions</h2>
			<p class="text-sm text-muted-foreground">Control which users can access specific tools per namespace</p>
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
	{:else if namespaces.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Shield class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No namespaces found. Create a namespace first.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="flex items-center gap-4 mb-6">
			<div class="space-y-1">
				<Label for="ns-select">Namespace</Label>
				<select
					id="ns-select"
					bind:value={selectedNamespace}
					onchange={loadPermissions}
					class="flex h-9 w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{#each namespaces as ns}
						<option value={ns.id}>{ns.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1"></div>
			<Button size="sm" onclick={() => { addForm = { userId: '', toolName: '', allowed: false }; showAddDialog = true; }}>
				<Plus class="size-4 mr-1" /> Add Rule
			</Button>
		</div>

		<Card.Root>
			<Card.Content class="p-0">
				{#if permissions.length === 0}
					<div class="flex flex-col items-center justify-center py-10 text-center">
						<Shield class="size-10 text-muted-foreground mb-3" />
						<p class="text-sm text-muted-foreground mb-2">No tool permission rules configured.</p>
						<p class="text-xs text-muted-foreground">By default, all users have access to all tools. Add rules to block specific tools for specific users.</p>
					</div>
				{:else}
					<div class="divide-y">
						{#each permissions as perm}
							<div class="flex items-center gap-4 px-4 py-3">
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-mono">{perm.toolName}</span>
										{#if perm.allowed}
											<Badge variant="default" class="gap-1"><Check class="size-3" /> Allowed</Badge>
										{:else}
											<Badge variant="destructive" class="gap-1"><Ban class="size-3" /> Blocked</Badge>
										{/if}
									</div>
									<p class="text-xs text-muted-foreground mt-0.5">User: {perm.userId}</p>
								</div>
								<Switch checked={perm.allowed} onCheckedChange={() => handleToggle(perm)} />
								<Button variant="ghost" size="icon" onclick={() => handleDelete(perm.id)}>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<!-- Add Rule Dialog -->
<Dialog.Root bind:open={showAddDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add Tool Permission Rule</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleAdd(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="perm-user">User ID</Label>
				<Input id="perm-user" bind:value={addForm.userId} required placeholder="User ID to restrict" />
			</div>
			<div class="space-y-2">
				<Label for="perm-tool">Tool Name</Label>
				<Input id="perm-tool" bind:value={addForm.toolName} required placeholder="e.g. fire_crawl_search" />
			</div>
			<div class="flex items-center gap-3">
				<Switch bind:checked={addForm.allowed} id="perm-allowed" />
				<Label for="perm-allowed">{addForm.allowed ? 'Allow' : 'Block'} this tool for this user</Label>
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddDialog = false}>Cancel</Button>
				<Button type="submit">Add Rule</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
