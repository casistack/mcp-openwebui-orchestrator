<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ArrowLeft, TrendingUp, Star, Download, Package } from '@lucide/svelte';

	interface ListingAnalytics {
		id: string; name: string; slug: string;
		installCount: number; recentInstalls: number;
		avgRating: number; ratingCount: number; reviewCount: number;
		status: string | null;
	}

	interface Analytics {
		totalListings: number; totalInstalls: number;
		avgRating: number; totalReviews: number;
		listings: ListingAnalytics[];
	}

	let analytics = $state<Analytics | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			analytics = await trpc.marketplace.publisherAnalytics.query() as Analytics;
		} catch { analytics = null; }
		loading = false;
	});
</script>

<div>
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	<div class="mb-6">
		<h2 class="text-2xl font-bold tracking-tight">Publisher Analytics</h2>
		<p class="text-sm text-muted-foreground">Track your marketplace listing performance</p>
	</div>

	{#if loading}
		<div class="grid grid-cols-4 gap-4 mb-6">
			{#each [1,2,3,4] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-16 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else if !analytics || analytics.totalListings === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Package class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">You haven't published any marketplace listings yet.</p>
				<a href="/marketplace/publish"><Button class="mt-4">Publish Your First Server</Button></a>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Listings</p>
					<p class="text-2xl font-bold">{analytics.totalListings}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Total Installs</p>
					<div class="flex items-center gap-2">
						<Download class="size-4 text-muted-foreground" />
						<p class="text-2xl font-bold">{analytics.totalInstalls}</p>
					</div>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Avg Rating</p>
					<div class="flex items-center gap-2">
						<Star class="size-4 text-yellow-500" />
						<p class="text-2xl font-bold">{analytics.avgRating}/5</p>
					</div>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Total Reviews</p>
					<p class="text-2xl font-bold">{analytics.totalReviews}</p>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header><Card.Title class="text-sm">Listing Performance</Card.Title></Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Installs</Table.Head>
							<Table.Head>7-day</Table.Head>
							<Table.Head>Rating</Table.Head>
							<Table.Head>Reviews</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each analytics.listings as listing}
							<Table.Row>
								<Table.Cell>
									<a href="/marketplace/{listing.slug}" class="text-primary hover:underline text-sm font-medium">{listing.name}</a>
								</Table.Cell>
								<Table.Cell>
									<Badge variant={listing.status === 'approved' ? 'default' : listing.status === 'pending' ? 'secondary' : 'outline'} class="text-xs">{listing.status}</Badge>
								</Table.Cell>
								<Table.Cell class="font-mono text-sm">{listing.installCount}</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-1 text-sm">
										{#if listing.recentInstalls > 0}
											<TrendingUp class="size-3 text-green-600" />
										{/if}
										{listing.recentInstalls}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-1 text-sm">
										<Star class="size-3 text-yellow-500" />
										{listing.avgRating} ({listing.ratingCount})
									</span>
								</Table.Cell>
								<Table.Cell class="text-sm">{listing.reviewCount}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
