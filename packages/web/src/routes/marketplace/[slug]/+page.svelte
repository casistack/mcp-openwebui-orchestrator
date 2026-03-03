<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Separator } from '$lib/components/ui/separator';
	import { Download, Star, ArrowLeft, AlertCircle, Check } from '@lucide/svelte';

	interface Listing {
		id: string;
		name: string;
		slug: string;
		shortDescription: string | null;
		description: string | null;
		category: string;
		tags: string[] | null;
		transport: string;
		config: Record<string, unknown> | null;
		version: string;
		requirements: { envVars?: Array<{ key: string; description: string; required: boolean }>; dependencies?: string[] } | null;
		compatibility: string[] | null;
		installCount: number | null;
		avgRating: number | null;
		ratingCount: number | null;
		isVerified: boolean | null;
		isFeatured: boolean | null;
		status: string | null;
		publisherId: string;
	}

	interface Review { id: string; userId: string; rating: number; title: string | null; body: string | null; createdAt: string | null; }

	let listing = $state<Listing | null>(null);
	let reviews = $state<Review[]>([]);
	let loading = $state(true);
	let installing = $state(false);
	let installed = $state(false);
	let showReviewDialog = $state(false);
	let reviewForm = $state({ rating: 5, title: '', body: '' });
	let error = $state<string | null>(null);

	async function loadListing() {
		try {
			const slug = page.params.slug;
			const result = await trpc.marketplace.getBySlug.query({ slug });
			listing = result as Listing | null;
			if (listing) {
				const reviewsResult = await trpc.marketplace.reviews.query({ listingId: listing.id });
				reviews = reviewsResult as Review[];
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load listing';
		}
		loading = false;
	}

	async function handleInstall() {
		if (!listing) return;
		installing = true;
		error = null;
		try {
			await trpc.marketplace.install.mutate({ listingId: listing.id });
			installed = true;
			// Refresh listing to get updated install count
			const result = await trpc.marketplace.getBySlug.query({ slug: listing.slug });
			listing = result as Listing;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Installation failed';
		}
		installing = false;
	}

	async function handleReview() {
		if (!listing) return;
		error = null;
		try {
			await trpc.marketplace.submitReview.mutate({
				listingId: listing.id,
				rating: reviewForm.rating,
				title: reviewForm.title || undefined,
				body: reviewForm.body || undefined,
			});
			showReviewDialog = false;
			// Refresh
			const [listingResult, reviewsResult] = await Promise.all([
				trpc.marketplace.getBySlug.query({ slug: listing.slug }),
				trpc.marketplace.reviews.query({ listingId: listing.id }),
			]);
			listing = listingResult as Listing;
			reviews = reviewsResult as Review[];
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to submit review';
		}
	}

	function formatCategory(cat: string) {
		return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	function renderStars(rating: number) {
		return Array.from({ length: 5 }, (_, i) => i < Math.round(rating) ? 'filled' : 'empty');
	}

	onMount(loadListing);
</script>

<div>
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}
				<Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-60 w-full" /></Card.Content></Card.Root>
	{:else if !listing}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<p class="text-sm text-muted-foreground">Listing not found.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Main Content -->
			<div class="lg:col-span-2 space-y-6">
				<Card.Root>
					<Card.Content class="p-6">
						<div class="flex items-start justify-between mb-4">
							<div>
								<h2 class="text-2xl font-bold">{listing.name}</h2>
								{#if listing.shortDescription}
									<p class="text-muted-foreground mt-1">{listing.shortDescription}</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								{#if listing.isVerified}
									<Badge variant="default">Verified</Badge>
								{/if}
								{#if listing.isFeatured}
									<Badge variant="secondary">Featured</Badge>
								{/if}
							</div>
						</div>

						<div class="flex flex-wrap gap-2 mb-4">
							<Badge variant="secondary">{formatCategory(listing.category)}</Badge>
							<Badge variant="outline">{listing.transport}</Badge>
							<Badge variant="outline">v{listing.version}</Badge>
							{#if listing.tags}
								{#each listing.tags as tag}
									<Badge variant="outline">{tag}</Badge>
								{/each}
							{/if}
						</div>

						<div class="flex items-center gap-4 text-sm text-muted-foreground">
							<span class="flex items-center gap-1"><Download class="size-4" />{listing.installCount ?? 0} installs</span>
							<span class="flex items-center gap-1">
								<Star class="size-4" />{listing.avgRating ?? 0}/5
								<span class="text-xs">({listing.ratingCount ?? 0} reviews)</span>
							</span>
						</div>
					</Card.Content>
				</Card.Root>

				<!-- Description -->
				{#if listing.description}
					<Card.Root>
						<Card.Content class="p-6">
							<h3 class="font-semibold mb-3">Description</h3>
							<div class="prose prose-sm dark:prose-invert max-w-none">
								<pre class="whitespace-pre-wrap text-sm">{listing.description}</pre>
							</div>
						</Card.Content>
					</Card.Root>
				{/if}

				<!-- Reviews -->
				<Card.Root>
					<Card.Content class="p-6">
						<div class="flex justify-between items-center mb-4">
							<h3 class="font-semibold">Reviews ({reviews.length})</h3>
							<Button size="sm" onclick={() => showReviewDialog = true}>Write Review</Button>
						</div>
						{#if reviews.length === 0}
							<p class="text-sm text-muted-foreground">No reviews yet. Be the first!</p>
						{:else}
							<div class="space-y-4">
								{#each reviews as review}
									<div class="border-b pb-4 last:border-0 last:pb-0">
										<div class="flex items-center gap-2 mb-1">
											<span class="text-sm font-medium flex items-center gap-0.5">
												{#each renderStars(review.rating) as s}
													<Star class="size-3 {s === 'filled' ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'}" />
												{/each}
											</span>
											{#if review.title}
												<span class="text-sm font-medium">{review.title}</span>
											{/if}
										</div>
										{#if review.body}
											<p class="text-sm text-muted-foreground">{review.body}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			</div>

			<!-- Sidebar -->
			<div class="space-y-4">
				<Card.Root>
					<Card.Content class="p-6">
						{#if installed}
							<Button class="w-full mb-3" disabled>
								<Check class="size-4 mr-2" /> Installed
							</Button>
						{:else}
							<Button class="w-full mb-3" onclick={handleInstall} disabled={installing}>
								{#if installing}
									Installing...
								{:else}
									<Download class="size-4 mr-2" /> Install
								{/if}
							</Button>
						{/if}

						<Separator class="my-4" />

						<div class="space-y-3 text-sm">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Transport</span>
								<span class="font-mono">{listing.transport}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Version</span>
								<span class="font-mono">{listing.version}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Category</span>
								<span>{formatCategory(listing.category)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Installs</span>
								<span>{listing.installCount ?? 0}</span>
							</div>
						</div>
					</Card.Content>
				</Card.Root>

				<!-- Requirements -->
				{#if listing.requirements?.envVars && listing.requirements.envVars.length > 0}
					<Card.Root>
						<Card.Content class="p-6">
							<h4 class="font-semibold text-sm mb-3">Required Environment Variables</h4>
							<div class="space-y-2">
								{#each listing.requirements.envVars as envVar}
									<div class="text-xs">
										<span class="font-mono font-medium">{envVar.key}</span>
										{#if envVar.required}
											<Badge variant="destructive" class="text-[9px] ml-1">Required</Badge>
										{/if}
										<p class="text-muted-foreground mt-0.5">{envVar.description}</p>
									</div>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/if}

				<!-- Compatibility -->
				{#if listing.compatibility && listing.compatibility.length > 0}
					<Card.Root>
						<Card.Content class="p-6">
							<h4 class="font-semibold text-sm mb-3">Compatible With</h4>
							<div class="flex flex-wrap gap-1">
								{#each listing.compatibility as client}
									<Badge variant="outline" class="text-xs">{client}</Badge>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Review Dialog -->
<Dialog.Root bind:open={showReviewDialog}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Write a Review</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleReview(); }} class="space-y-4">
			<div class="space-y-2">
				<Label>Rating</Label>
				<div class="flex gap-1">
					{#each [1, 2, 3, 4, 5] as n}
						<button
							type="button"
							class="p-0.5"
							onclick={() => reviewForm.rating = n}
						>
							<Star class="size-6 {n <= reviewForm.rating ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'}" />
						</button>
					{/each}
				</div>
			</div>
			<div class="space-y-2">
				<Label for="review-title">Title (optional)</Label>
				<Input id="review-title" bind:value={reviewForm.title} placeholder="Summary of your review" />
			</div>
			<div class="space-y-2">
				<Label for="review-body">Review (optional)</Label>
				<textarea
					id="review-body"
					bind:value={reviewForm.body}
					placeholder="Share your experience..."
					rows={4}
					class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				></textarea>
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showReviewDialog = false}>Cancel</Button>
				<Button type="submit">Submit Review</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
