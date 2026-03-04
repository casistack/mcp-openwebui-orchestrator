<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ArrowLeft, Plus, Trash2, FolderOpen, AlertCircle } from '@lucide/svelte';

	interface Collection { id: string; name: string; slug: string; description: string | null; isPublic: boolean | null; isFeatured: boolean | null; createdAt: string | null; }
	interface CollectionItem { id: string; listingId: string; note: string | null; order: number | null; listing: { id: string; name: string; slug: string; shortDescription: string | null; installCount: number | null; } | null; }

	let collections = $state<Collection[]>([]);
	let selectedCollection = $state<Collection | null>(null);
	let items = $state<CollectionItem[]>([]);
	let loading = $state(true);
	let itemsLoading = $state(false);
	let showCreateDialog = $state(false);
	let form = $state({ name: '', slug: '', description: '' });
	let error = $state<string | null>(null);

	onMount(loadCollections);

	async function loadCollections() {
		try {
			collections = await trpc.marketplace.listCollections.query() as Collection[];
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to load collections'; }
		loading = false;
	}

	async function selectCollection(col: Collection) {
		selectedCollection = col;
		itemsLoading = true;
		try {
			items = await trpc.marketplace.collectionItems.query({ collectionId: col.id }) as CollectionItem[];
		} catch { items = []; }
		itemsLoading = false;
	}

	async function createCollection() {
		if (!form.name.trim() || !form.slug.trim()) return;
		error = null;
		try {
			await trpc.marketplace.createCollection.mutate({ name: form.name, slug: form.slug, description: form.description || undefined });
			showCreateDialog = false;
			form = { name: '', slug: '', description: '' };
			await loadCollections();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to create collection'; }
	}

	async function deleteCollection(id: string) {
		try {
			await trpc.marketplace.deleteCollection.mutate({ id });
			if (selectedCollection?.id === id) { selectedCollection = null; items = []; }
			await loadCollections();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to delete collection'; }
	}

	async function removeItem(listingId: string) {
		if (!selectedCollection) return;
		try {
			await trpc.marketplace.removeFromCollection.mutate({ collectionId: selectedCollection.id, listingId });
			items = items.filter(i => i.listingId !== listingId);
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to remove item'; }
	}

	function autoSlug() {
		form.slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}
</script>

<div>
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Collections</h2>
			<p class="text-sm text-muted-foreground">Curated lists of MCP servers</p>
		</div>
		<Button onclick={() => showCreateDialog = true}><Plus class="size-4 mr-2" />New Collection</Button>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>
	{/if}

	{#if loading}
		<div class="grid grid-cols-3 gap-4">
			{#each [1,2,3] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-20 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="space-y-3">
				{#if collections.length === 0}
					<Card.Root>
						<Card.Content class="flex flex-col items-center justify-center py-8 text-center">
							<FolderOpen class="size-8 text-muted-foreground mb-2" />
							<p class="text-sm text-muted-foreground">No collections yet</p>
						</Card.Content>
					</Card.Root>
				{:else}
					{#each collections as col}
						<Card.Root
							class="cursor-pointer transition-colors {selectedCollection?.id === col.id ? 'ring-2 ring-primary' : 'hover:border-muted-foreground/50'}"
							onclick={() => selectCollection(col)}
						>
							<Card.Content class="p-4">
								<div class="flex items-center justify-between">
									<h4 class="font-semibold text-sm">{col.name}</h4>
									<div class="flex items-center gap-1">
										{#if col.isFeatured}<Badge variant="secondary" class="text-[10px]">Featured</Badge>{/if}
										<Button variant="ghost" size="icon" class="size-6" onclick={(e) => { e.stopPropagation(); deleteCollection(col.id); }}>
											<Trash2 class="size-3 text-destructive" />
										</Button>
									</div>
								</div>
								{#if col.description}<p class="text-xs text-muted-foreground mt-1">{col.description}</p>{/if}
							</Card.Content>
						</Card.Root>
					{/each}
				{/if}
			</div>

			<div class="lg:col-span-2">
				{#if selectedCollection}
					<Card.Root>
						<Card.Header>
							<Card.Title class="text-sm">{selectedCollection.name}</Card.Title>
						</Card.Header>
						<Card.Content>
							{#if itemsLoading}
								<Skeleton class="h-20 w-full" />
							{:else if items.length === 0}
								<p class="text-sm text-muted-foreground text-center py-6">No servers in this collection yet. Add servers from their detail pages.</p>
							{:else}
								<div class="space-y-3">
									{#each items as item}
										<div class="flex items-center justify-between py-2 px-3 rounded border">
											<div class="min-w-0">
												{#if item.listing}
													<a href="/marketplace/{item.listing.slug}" class="text-sm font-medium text-primary hover:underline">{item.listing.name}</a>
													{#if item.listing.shortDescription}<p class="text-xs text-muted-foreground truncate">{item.listing.shortDescription}</p>{/if}
												{:else}
													<span class="text-sm text-muted-foreground">Deleted listing</span>
												{/if}
												{#if item.note}<p class="text-xs text-muted-foreground mt-1 italic">{item.note}</p>{/if}
											</div>
											<Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => removeItem(item.listingId)}>
												<Trash2 class="size-3 text-destructive" />
											</Button>
										</div>
									{/each}
								</div>
							{/if}
						</Card.Content>
					</Card.Root>
				{:else}
					<Card.Root>
						<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
							<FolderOpen class="size-8 text-muted-foreground mb-2" />
							<p class="text-sm text-muted-foreground">Select a collection to view its servers</p>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		</div>
	{/if}
</div>

<Dialog.Root bind:open={showCreateDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>New Collection</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); createCollection(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="col-name">Name</Label>
				<Input id="col-name" bind:value={form.name} oninput={autoSlug} required />
			</div>
			<div class="space-y-2">
				<Label for="col-slug">Slug</Label>
				<Input id="col-slug" bind:value={form.slug} class="font-mono" required />
			</div>
			<div class="space-y-2">
				<Label for="col-desc">Description (optional)</Label>
				<Input id="col-desc" bind:value={form.description} />
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showCreateDialog = false}>Cancel</Button>
				<Button type="submit">Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
