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
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ArrowLeft, Lock, UserPlus, Trash2, Check, AlertCircle, Users } from '@lucide/svelte';

	interface OrgListing {
		id: string;
		orgOwnerId: string;
		listingId: string;
		accessLevel: string;
		approvedAt: string | null;
		listing: { id: string; name: string; slug: string; shortDescription: string | null; } | null;
	}

	interface OrgMember {
		id: string;
		userId: string;
		role: string;
		createdAt: string | null;
	}

	let orgListings = $state<OrgListing[]>([]);
	let members = $state<OrgMember[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAddMember = $state(false);
	let showAddListing = $state(false);
	let newMemberEmail = $state('');
	let newListingId = $state('');

	// For simplicity, the "org" is the current user's org (they are the owner)
	let orgOwnerId = $state('');

	onMount(async () => {
		try {
			// Get current user session to determine org
			const sessionRes = await fetch('/api/auth/get-session', { credentials: 'include' });
			const session = await sessionRes.json();
			orgOwnerId = session?.user?.id ?? '';

			if (orgOwnerId) {
				const [listings, mems] = await Promise.all([
					trpc.marketplace.orgListings.query({ orgOwnerId }),
					trpc.marketplace.orgMembers.query({ orgOwnerId }),
				]);
				orgListings = listings as OrgListing[];
				members = mems as OrgMember[];
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load organization data';
		}
		loading = false;
	});

	async function addMember() {
		if (!newMemberEmail.trim() || !orgOwnerId) return;
		error = null;
		try {
			await trpc.marketplace.addOrgMember.mutate({ orgOwnerId, userId: newMemberEmail.trim() });
			showAddMember = false;
			newMemberEmail = '';
			members = await trpc.marketplace.orgMembers.query({ orgOwnerId }) as OrgMember[];
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to add member'; }
	}

	async function removeMember(userId: string) {
		try {
			await trpc.marketplace.removeOrgMember.mutate({ orgOwnerId, userId });
			members = members.filter(m => m.userId !== userId);
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to remove member'; }
	}

	async function addListing() {
		if (!newListingId.trim() || !orgOwnerId) return;
		error = null;
		try {
			await trpc.marketplace.addOrgListing.mutate({ orgOwnerId, listingId: newListingId.trim() });
			showAddListing = false;
			newListingId = '';
			orgListings = await trpc.marketplace.orgListings.query({ orgOwnerId }) as OrgListing[];
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to add listing'; }
	}

	async function removeListing(listingId: string) {
		try {
			await trpc.marketplace.removeOrgListing.mutate({ orgOwnerId, listingId });
			orgListings = orgListings.filter(l => l.listingId !== listingId);
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to remove listing'; }
	}

	async function approveListing(listingId: string) {
		try {
			await trpc.marketplace.approveOrgListing.mutate({ orgOwnerId, listingId });
			orgListings = await trpc.marketplace.orgListings.query({ orgOwnerId }) as OrgListing[];
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to approve listing'; }
	}
</script>

<div>
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Private Marketplace</h2>
			<p class="text-sm text-muted-foreground">Manage your organization's internal MCP servers and members</p>
		</div>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>
	{/if}

	{#if loading}
		<div class="grid grid-cols-2 gap-4">
			{#each [1,2] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-32 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Org Members -->
			<Card.Root>
				<Card.Header>
					<div class="flex items-center justify-between">
						<Card.Title class="text-sm flex items-center gap-2"><Users class="size-4" />Members</Card.Title>
						<Button size="sm" onclick={() => showAddMember = true}><UserPlus class="size-4 mr-1" />Add</Button>
					</div>
				</Card.Header>
				<Card.Content>
					{#if members.length === 0}
						<p class="text-sm text-muted-foreground text-center py-4">No members yet. Add users to give them access to your private marketplace.</p>
					{:else}
						<div class="space-y-2">
							{#each members as member}
								<div class="flex items-center justify-between py-2 px-3 rounded border">
									<div>
										<p class="text-sm font-mono">{member.userId}</p>
										<Badge variant="outline" class="text-[10px]">{member.role}</Badge>
									</div>
									<Button variant="ghost" size="icon" class="size-7" onclick={() => removeMember(member.userId)}>
										<Trash2 class="size-3 text-destructive" />
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			<!-- Org Listings -->
			<Card.Root>
				<Card.Header>
					<div class="flex items-center justify-between">
						<Card.Title class="text-sm flex items-center gap-2"><Lock class="size-4" />Private Listings</Card.Title>
						<Button size="sm" onclick={() => showAddListing = true}><Lock class="size-4 mr-1" />Add</Button>
					</div>
				</Card.Header>
				<Card.Content>
					{#if orgListings.length === 0}
						<p class="text-sm text-muted-foreground text-center py-4">No private listings. Add marketplace listings that only your org members can access.</p>
					{:else}
						<div class="space-y-2">
							{#each orgListings as ol}
								<div class="flex items-center justify-between py-2 px-3 rounded border">
									<div class="min-w-0">
										{#if ol.listing}
											<a href="/marketplace/{ol.listing.slug}" class="text-sm font-medium text-primary hover:underline">{ol.listing.name}</a>
											{#if ol.listing.shortDescription}<p class="text-xs text-muted-foreground truncate">{ol.listing.shortDescription}</p>{/if}
										{:else}
											<span class="text-sm text-muted-foreground">Unknown listing</span>
										{/if}
										<div class="flex items-center gap-2 mt-1">
											<Badge variant="outline" class="text-[10px]">{ol.accessLevel}</Badge>
											{#if ol.approvedAt}
												<Badge variant="default" class="text-[10px]"><Check class="size-2 mr-0.5" />Approved</Badge>
											{:else}
												<Badge variant="secondary" class="text-[10px]">Pending</Badge>
											{/if}
										</div>
									</div>
									<div class="flex items-center gap-1 shrink-0">
										{#if !ol.approvedAt}
											<Button variant="ghost" size="icon" class="size-7" onclick={() => approveListing(ol.listingId)}>
												<Check class="size-3 text-green-600" />
											</Button>
										{/if}
										<Button variant="ghost" size="icon" class="size-7" onclick={() => removeListing(ol.listingId)}>
											<Trash2 class="size-3 text-destructive" />
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>

<!-- Add Member Dialog -->
<Dialog.Root bind:open={showAddMember}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>Add Organization Member</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); addMember(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="member-id">User ID</Label>
				<Input id="member-id" bind:value={newMemberEmail} placeholder="Enter user ID" required />
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddMember = false}>Cancel</Button>
				<Button type="submit">Add Member</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Add Listing Dialog -->
<Dialog.Root bind:open={showAddListing}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>Add Private Listing</Dialog.Title></Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); addListing(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="listing-id">Listing ID</Label>
				<Input id="listing-id" bind:value={newListingId} placeholder="Enter marketplace listing ID" required />
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddListing = false}>Cancel</Button>
				<Button type="submit">Add Listing</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
