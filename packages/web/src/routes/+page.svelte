<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { trpc } from '$lib/trpc';
	import { wsClient, type WSEvent } from '$lib/ws';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Activity, Server, Layers, Globe, Zap, AlertCircle, Store } from '@lucide/svelte';

	interface Stats { servers: number; namespaces: number; endpoints: number; connectedServers?: number; marketplaceListings?: number; }
	interface Connection { serverId: string; status: string; toolCount: number; lastPingMs: number | null; lastError: string | null; connectTime: string | null; reconnectAttempts: number; }
	interface ToolCallStats { totalCalls: number; successCalls: number; failedCalls: number; avgDurationMs: number; }

	let stats = $state<Stats | null>(null);
	let connections = $state<Connection[]>([]);
	let toolCallStats = $state<ToolCallStats>({ totalCalls: 0, successCalls: 0, failedCalls: 0, avgDurationMs: 0 });
	let error = $state<string | null>(null);
	let wsConnected = $state(false);
	let cleanups: (() => void)[] = [];

	onMount(async () => {
		try {
			const [s, c, t] = await Promise.all([
				trpc.stats.query(),
				trpc.connections.list.query().catch(() => []),
				trpc.audit.toolCallStats.query().catch(() => ({ totalCalls: 0, successCalls: 0, failedCalls: 0, avgDurationMs: 0 })),
			]);
			stats = s;
			connections = c as Connection[];
			toolCallStats = t;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('Not authenticated') || msg.includes('UNAUTHORIZED') || msg.includes('FORBIDDEN') || msg.includes('401') || msg.includes('403')) {
				window.location.href = '/login';
				return;
			}
			error = 'Backend not reachable';
		}

		wsClient.connect();
		cleanups.push(wsClient.on('connected', () => { wsConnected = true; }));
		cleanups.push(wsClient.on('server:connected', () => { refreshConnections(); }));
		cleanups.push(wsClient.on('server:disconnected', () => { refreshConnections(); }));
		cleanups.push(wsClient.on('server:ping', (evt: WSEvent) => {
			const { serverId, latencyMs } = evt.data;
			connections = connections.map((c) =>
				c.serverId === serverId ? { ...c, lastPingMs: latencyMs as number, lastError: null } : c
			);
		}));
		cleanups.push(wsClient.on('tool:called', () => {
			trpc.audit.toolCallStats.query().then((t) => { toolCallStats = t; }).catch(() => {});
		}));
	});

	onDestroy(() => { cleanups.forEach((fn) => fn()); wsClient.disconnect(); });

	async function refreshConnections() {
		try { connections = (await trpc.connections.list.query()) as Connection[]; } catch {}
	}

	function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'connected') return 'default';
		if (status === 'connecting' || status === 'reconnecting') return 'secondary';
		return 'destructive';
	}

	function errorRate(): string {
		if (toolCallStats.totalCalls === 0) return '0%';
		return `${Math.round((toolCallStats.failedCalls / toolCallStats.totalCalls) * 100)}%`;
	}
</script>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Dashboard</h2>
			<p class="text-sm text-muted-foreground">Platform overview and real-time status</p>
		</div>
		{#if wsConnected}
			<Badge variant="outline" class="gap-1.5">
				<span class="size-2 rounded-full bg-success animate-pulse"></span>
				Live
			</Badge>
		{/if}
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-6">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	{:else if stats}
		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Servers</Card.Title>
					<Server class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{stats.servers}</div>
					{#if stats.connectedServers !== undefined}
						<p class="text-xs text-muted-foreground">{stats.connectedServers} connected</p>
					{/if}
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Namespaces</Card.Title>
					<Layers class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{stats.namespaces}</div>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Endpoints</Card.Title>
					<Globe class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{stats.endpoints}</div>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Marketplace</Card.Title>
					<Store class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{stats.marketplaceListings ?? 0}</div>
					<p class="text-xs text-muted-foreground"><a href="/marketplace" class="hover:underline">Browse listings</a></p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">Tool Calls (24h)</Card.Title>
					<Zap class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{toolCallStats.totalCalls}</div>
					<p class="text-xs text-muted-foreground">Avg {toolCallStats.avgDurationMs}ms | Err {errorRate()}</p>
				</Card.Content>
			</Card.Root>
		</div>

		{#if connections.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2">
						<Activity class="size-4" />
						Server Connections
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Server</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Tools</Table.Head>
								<Table.Head>Latency</Table.Head>
								<Table.Head>Error</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each connections as conn}
								<Table.Row>
									<Table.Cell class="font-mono text-xs">{conn.serverId}</Table.Cell>
									<Table.Cell>
										<Badge variant={statusVariant(conn.status)}>{conn.status}</Badge>
									</Table.Cell>
									<Table.Cell>{conn.toolCount}</Table.Cell>
									<Table.Cell class="font-mono text-xs">{conn.lastPingMs !== null ? `${conn.lastPingMs}ms` : '-'}</Table.Cell>
									<Table.Cell class="text-xs text-destructive max-w-[200px] truncate">{conn.lastError ?? '-'}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
					<Server class="size-10 text-muted-foreground mb-3" />
					<p class="text-sm text-muted-foreground">No server connections. Add servers and connect them from the Servers page.</p>
				</Card.Content>
			</Card.Root>
		{/if}
	{:else}
		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
			{#each [1, 2, 3, 4, 5] as _}
				<Card.Root>
					<Card.Header class="pb-2"><Skeleton class="h-4 w-20" /></Card.Header>
					<Card.Content><Skeleton class="h-8 w-16" /></Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
