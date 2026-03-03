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
	import { Lock, Plus, Trash2, Ban, AlertCircle, RefreshCw } from '@lucide/svelte';

	interface OAuthToken {
		id: string;
		userId: string;
		endpointId: string;
		provider: string;
		accessToken: string;
		refreshToken: string | null;
		expiresAt: string | null;
		scopes: string | null;
		tokenType: string | null;
		status: string | null;
		lastUsedAt: string | null;
		lastRefreshedAt: string | null;
		createdAt: string | null;
	}

	interface Endpoint {
		id: string;
		name: string;
		slug: string;
		transport: string;
		authType: string | null;
	}

	let tokens = $state<OAuthToken[]>([]);
	let endpoints = $state<Endpoint[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAdd = $state(false);

	let newEndpointId = $state('');
	let newProvider = $state('google');
	let newAccessToken = $state('');
	let newRefreshToken = $state('');
	let newExpiresAt = $state('');
	let newScopes = $state('');

	async function load() {
		loading = true;
		error = null;
		try {
			const [tokenList, endpointList] = await Promise.all([
				trpc.oauthTokens.list.query({}),
				trpc.endpoints.list.query(),
			]);
			tokens = tokenList as OAuthToken[];
			endpoints = endpointList as Endpoint[];
		} catch (e) {
			error = (e as Error).message;
		}
		loading = false;
	}

	onMount(load);

	function endpointName(endpointId: string): string {
		const ep = endpoints.find(e => e.id === endpointId);
		return ep ? ep.name : endpointId.slice(0, 8) + '...';
	}

	function statusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'active': return 'default';
			case 'expired': return 'secondary';
			case 'revoked': return 'destructive';
			case 'refresh_failed': return 'destructive';
			default: return 'outline';
		}
	}

	function maskToken(token: string): string {
		if (token.length <= 8) return '****';
		return token.slice(0, 4) + '...' + token.slice(-4);
	}

	async function addToken() {
		if (!newEndpointId || !newAccessToken) return;
		try {
			await trpc.oauthTokens.set.mutate({
				endpointId: newEndpointId,
				provider: newProvider,
				accessToken: newAccessToken,
				refreshToken: newRefreshToken || undefined,
				expiresAt: newExpiresAt || undefined,
				scopes: newScopes || undefined,
			});
			showAdd = false;
			newEndpointId = '';
			newProvider = 'google';
			newAccessToken = '';
			newRefreshToken = '';
			newExpiresAt = '';
			newScopes = '';
			await load();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function revokeToken(tokenId: string) {
		try {
			await trpc.oauthTokens.revoke.mutate({ tokenId });
			await load();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function deleteToken(tokenId: string) {
		try {
			await trpc.oauthTokens.delete.mutate({ tokenId });
			await load();
		} catch (e) {
			error = (e as Error).message;
		}
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">OAuth Tokens</h2>
			<p class="text-sm text-muted-foreground">Manage per-user OAuth credentials for endpoint authentication</p>
		</div>
		<div class="flex items-center gap-2">
			<Badge variant="outline">{tokens.length} tokens</Badge>
			<Button size="sm" onclick={() => showAdd = true}><Plus class="size-4 mr-1" />Add Token</Button>
		</div>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else if tokens.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Lock class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No OAuth tokens configured.</p>
				<p class="text-xs text-muted-foreground mt-1">Add tokens to authenticate with OAuth-protected endpoints.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Endpoint</Table.Head>
							<Table.Head>Provider</Table.Head>
							<Table.Head>Token</Table.Head>
							<Table.Head>Scopes</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Expires</Table.Head>
							<Table.Head>Last Used</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each tokens as token}
							<Table.Row class="text-sm">
								<Table.Cell class="font-medium">{endpointName(token.endpointId)}</Table.Cell>
								<Table.Cell>
									<Badge variant="outline" class="text-xs">{token.provider}</Badge>
								</Table.Cell>
								<Table.Cell class="font-mono text-xs text-muted-foreground">{maskToken(token.accessToken)}</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">{token.scopes ?? '-'}</Table.Cell>
								<Table.Cell>
									<Badge variant={statusVariant(token.status)} class="text-xs">{token.status ?? 'unknown'}</Badge>
								</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">
									{token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
								</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">
									{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : '-'}
								</Table.Cell>
								<Table.Cell class="text-right">
									<div class="flex justify-end gap-1">
										{#if token.status === 'active'}
											<Button variant="ghost" size="sm" onclick={() => revokeToken(token.id)} title="Revoke">
												<Ban class="size-3.5" />
											</Button>
										{/if}
										<Button variant="ghost" size="sm" onclick={() => deleteToken(token.id)} title="Delete">
											<Trash2 class="size-3.5 text-destructive" />
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={showAdd}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add OAuth Token</Dialog.Title>
			<Dialog.Description>Configure OAuth credentials for an endpoint</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="endpoint">Endpoint</Label>
				<select
					id="endpoint"
					bind:value={newEndpointId}
					class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<option value="">Select endpoint...</option>
					{#each endpoints as ep}
						<option value={ep.id}>{ep.name} ({ep.transport})</option>
					{/each}
				</select>
			</div>
			<div class="grid gap-2">
				<Label for="provider">Provider</Label>
				<select
					id="provider"
					bind:value={newProvider}
					class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<option value="google">Google</option>
					<option value="github">GitHub</option>
					<option value="microsoft">Microsoft</option>
					<option value="custom">Custom</option>
				</select>
			</div>
			<div class="grid gap-2">
				<Label for="access-token">Access Token</Label>
				<Input id="access-token" type="password" bind:value={newAccessToken} placeholder="Access token" />
			</div>
			<div class="grid gap-2">
				<Label for="refresh-token">Refresh Token (optional)</Label>
				<Input id="refresh-token" type="password" bind:value={newRefreshToken} placeholder="Refresh token" />
			</div>
			<div class="grid gap-2">
				<Label for="expires">Expires At (optional)</Label>
				<Input id="expires" type="datetime-local" bind:value={newExpiresAt} />
			</div>
			<div class="grid gap-2">
				<Label for="scopes">Scopes (optional)</Label>
				<Input id="scopes" bind:value={newScopes} placeholder="read,write" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => showAdd = false}>Cancel</Button>
			<Button onclick={addToken} disabled={!newEndpointId || !newAccessToken}>Save Token</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
