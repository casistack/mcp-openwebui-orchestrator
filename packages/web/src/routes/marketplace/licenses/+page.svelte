<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ArrowLeft, Key, ShieldCheck, Clock, Copy } from '@lucide/svelte';

	interface License {
		id: string;
		listingId: string;
		licenseKey: string;
		tier: string;
		seatsUsed: number;
		seatsTotal: number | null;
		status: string;
		expiresAt: string | null;
		createdAt: string | null;
	}

	let licenses = $state<License[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			licenses = await trpc.marketplace.myLicenses.query() as License[];
		} catch { licenses = []; }
		loading = false;
	});

	function copyKey(key: string) {
		navigator.clipboard.writeText(key);
	}

	function formatDate(d: string | null) {
		if (!d) return 'N/A';
		return new Date(d).toLocaleDateString();
	}

	function maskKey(key: string) {
		if (key.length <= 12) return key;
		return key.slice(0, 8) + '...' + key.slice(-4);
	}
</script>

<div>
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	<div class="mb-6">
		<h2 class="text-2xl font-bold tracking-tight">My Licenses</h2>
		<p class="text-sm text-muted-foreground">Manage your premium and enterprise licenses</p>
	</div>

	{#if loading}
		<div class="grid grid-cols-3 gap-4 mb-6">
			{#each [1,2,3] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-16 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else if licenses.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Key class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No active licenses. Browse the marketplace to find premium servers.</p>
				<a href="/marketplace"><Button class="mt-4">Browse Marketplace</Button></a>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Total Licenses</p>
					<p class="text-2xl font-bold">{licenses.length}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Active</p>
					<p class="text-2xl font-bold">{licenses.filter(l => l.status === 'active').length}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Premium</p>
					<p class="text-2xl font-bold">{licenses.filter(l => l.tier === 'premium').length}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Enterprise</p>
					<p class="text-2xl font-bold">{licenses.filter(l => l.tier === 'enterprise').length}</p>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root>
			<Card.Header><Card.Title class="text-sm">License Keys</Card.Title></Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>License Key</Table.Head>
							<Table.Head>Tier</Table.Head>
							<Table.Head>Seats</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Expires</Table.Head>
							<Table.Head>Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each licenses as license}
							<Table.Row>
								<Table.Cell>
									<span class="font-mono text-xs">{maskKey(license.licenseKey)}</span>
								</Table.Cell>
								<Table.Cell>
									<Badge variant={license.tier === 'enterprise' ? 'default' : 'secondary'} class="text-xs">
										{#if license.tier === 'enterprise'}<ShieldCheck class="size-3 mr-1" />{/if}
										{license.tier}
									</Badge>
								</Table.Cell>
								<Table.Cell class="font-mono text-sm">
									{license.seatsUsed}{license.seatsTotal ? `/${license.seatsTotal}` : '/∞'}
								</Table.Cell>
								<Table.Cell>
									<Badge variant={license.status === 'active' ? 'default' : license.status === 'expired' ? 'outline' : 'destructive'} class="text-xs">
										{license.status}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-sm">
									{#if license.expiresAt}
										<span class="flex items-center gap-1 text-xs">
											<Clock class="size-3" /> {formatDate(license.expiresAt)}
										</span>
									{:else}
										<span class="text-xs text-muted-foreground">Never</span>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<Button variant="ghost" size="icon" class="size-7" onclick={() => copyKey(license.licenseKey)}>
										<Copy class="size-3" />
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
