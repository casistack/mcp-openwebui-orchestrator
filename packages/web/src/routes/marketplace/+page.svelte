<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Search, Download, Star, AlertCircle, Store, TrendingUp } from '@lucide/svelte';

	interface Listing {
		id: string;
		name: string;
		slug: string;
		shortDescription: string | null;
		category: string;
		tags: string[] | null;
		transport: string;
		installCount: number | null;
		avgRating: number | null;
		ratingCount: number | null;
		isVerified: boolean | null;
		isFeatured: boolean | null;
		status: string | null;
		version: string;
	}

	interface Category { id: string; name: string; count: number; }

	let listings = $state<Listing[]>([]);
	let featured = $state<Listing[]>([]);
	let categories = $state<Category[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let selectedCategory = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function loadMarketplace() {
		try {
			const [listingsResult, featuredResult, categoriesResult] = await Promise.all([
				trpc.marketplace.list.query({ status: 'approved' }),
				trpc.marketplace.featured.query(),
				trpc.marketplace.categories.query(),
			]);
			listings = listingsResult as Listing[];
			featured = featuredResult as Listing[];
			categories = categoriesResult as Category[];
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load marketplace';
		}
		loading = false;
	}

	async function handleSearch() {
		loading = true;
		try {
			const result = await trpc.marketplace.list.query({
				status: 'approved',
				search: searchQuery || undefined,
				category: selectedCategory || undefined,
			});
			listings = result as Listing[];
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Search failed';
		}
		loading = false;
	}

	function selectCategory(catId: string | null) {
		selectedCategory = catId === selectedCategory ? null : catId;
		handleSearch();
	}

	function formatCategory(cat: string) {
		return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	onMount(loadMarketplace);
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Marketplace</h2>
			<p class="text-sm text-muted-foreground">Discover, install, and share MCP servers</p>
		</div>
		<a href="/marketplace/publish">
			<Button>Publish Server</Button>
		</a>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}
				<Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Search -->
	<div class="flex gap-2 mb-6">
		<div class="relative flex-1">
			<Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
			<Input
				bind:value={searchQuery}
				placeholder="Search servers by name, description, or tags..."
				class="pl-9"
				onkeydown={(e) => { if (e.key === 'Enter') handleSearch(); }}
			/>
		</div>
		<Button onclick={handleSearch} variant="secondary">Search</Button>
	</div>

	<!-- Categories -->
	<div class="flex flex-wrap gap-2 mb-6">
		<Button
			variant={selectedCategory === null ? 'default' : 'outline'}
			size="sm"
			onclick={() => selectCategory(null)}
		>All</Button>
		{#each categories as cat}
			<Button
				variant={selectedCategory === cat.id ? 'default' : 'outline'}
				size="sm"
				onclick={() => selectCategory(cat.id)}
			>{cat.name} ({cat.count})</Button>
		{/each}
	</div>

	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each [1, 2, 3, 4, 5, 6] as _}
				<Card.Root><Card.Content class="p-6"><Skeleton class="h-32 w-full" /></Card.Content></Card.Root>
			{/each}
		</div>
	{:else}
		<!-- Featured -->
		{#if featured.length > 0 && !selectedCategory && !searchQuery}
			<div class="mb-8">
				<h3 class="text-lg font-semibold mb-3 flex items-center gap-2"><TrendingUp class="size-5" /> Featured</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each featured as listing}
						<a href="/marketplace/{listing.slug}" class="block">
							<Card.Root class="hover:border-primary transition-colors h-full">
								<Card.Content class="p-5">
									<div class="flex items-start justify-between mb-2">
										<h4 class="font-semibold">{listing.name}</h4>
										{#if listing.isVerified}
											<Badge variant="default" class="text-[10px]">Verified</Badge>
										{/if}
									</div>
									{#if listing.shortDescription}
										<p class="text-sm text-muted-foreground mb-3 line-clamp-2">{listing.shortDescription}</p>
									{/if}
									<div class="flex items-center gap-3 text-xs text-muted-foreground">
										<span class="flex items-center gap-1"><Download class="size-3" />{listing.installCount ?? 0}</span>
										<span class="flex items-center gap-1"><Star class="size-3" />{listing.avgRating ?? 0}</span>
										<Badge variant="secondary" class="text-[10px]">{listing.transport}</Badge>
										<Badge variant="outline" class="text-[10px]">v{listing.version}</Badge>
									</div>
								</Card.Content>
							</Card.Root>
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<!-- All Listings -->
		{#if listings.length === 0}
			<Card.Root>
				<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
					<Store class="size-10 text-muted-foreground mb-3" />
					<p class="text-sm text-muted-foreground mb-2">No servers found{searchQuery ? ` matching "${searchQuery}"` : ''}.</p>
					<p class="text-xs text-muted-foreground">Be the first to publish a server to the marketplace!</p>
				</Card.Content>
			</Card.Root>
		{:else}
			<div>
				<h3 class="text-lg font-semibold mb-3">{selectedCategory ? formatCategory(selectedCategory) : 'All Servers'}</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each listings as listing}
						<a href="/marketplace/{listing.slug}" class="block">
							<Card.Root class="hover:border-primary transition-colors h-full">
								<Card.Content class="p-5">
									<div class="flex items-start justify-between mb-2">
										<h4 class="font-semibold text-sm">{listing.name}</h4>
										{#if listing.isVerified}
											<Badge variant="default" class="text-[10px]">Verified</Badge>
										{/if}
									</div>
									{#if listing.shortDescription}
										<p class="text-xs text-muted-foreground mb-3 line-clamp-2">{listing.shortDescription}</p>
									{/if}
									<div class="flex flex-wrap gap-1 mb-3">
										<Badge variant="secondary" class="text-[10px]">{formatCategory(listing.category)}</Badge>
										{#if listing.tags}
											{#each listing.tags.slice(0, 3) as tag}
												<Badge variant="outline" class="text-[10px]">{tag}</Badge>
											{/each}
										{/if}
									</div>
									<div class="flex items-center gap-3 text-xs text-muted-foreground">
										<span class="flex items-center gap-1"><Download class="size-3" />{listing.installCount ?? 0}</span>
										<span class="flex items-center gap-1"><Star class="size-3" />{listing.avgRating ?? 0} ({listing.ratingCount ?? 0})</span>
										<Badge variant="outline" class="text-[10px]">{listing.transport}</Badge>
									</div>
								</Card.Content>
							</Card.Root>
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<p class="mt-4 text-xs text-muted-foreground">{listings.length} server{listings.length !== 1 ? 's' : ''} available</p>
	{/if}
</div>
