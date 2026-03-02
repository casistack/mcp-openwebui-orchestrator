<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Search, Server, Layers, ChevronDown, ChevronUp, AlertCircle } from '@lucide/svelte';

	interface ServerItem { id: string; name: string; displayName?: string; transport: string; status?: string; }
	interface Namespace { id: string; name: string; description?: string; }
	interface ToolConfig { id: string; serverId: string; toolName: string; enabled: boolean; displayName?: string | null; description?: string | null; }

	let namespaces = $state<Namespace[]>([]);
	let selectedNs = $state<Namespace | null>(null);
	let nsServers = $state<ServerItem[]>([]);
	let expandedServer = $state<string | null>(null);
	let serverTools = $state<Record<string, ToolConfig[]>>({});
	let loading = $state(true);
	let loadingTools = $state<string | null>(null);
	let error = $state<string | null>(null);
	let allServers = $state<ServerItem[]>([]);

	async function load() {
		try {
			const [nsResult, srvResult] = await Promise.all([trpc.namespaces.list.query(), trpc.servers.list.query()]);
			namespaces = nsResult as unknown as Namespace[];
			const raw = srvResult as unknown as { servers?: ServerItem[] };
			allServers = raw.servers ?? (srvResult as unknown as ServerItem[]);
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to load data'; }
		loading = false;
	}

	onMount(load);

	async function selectNamespace(ns: Namespace) {
		selectedNs = ns; expandedServer = null; serverTools = {};
		try { const servers = await trpc.namespaces.listServers.query({ namespaceId: ns.id }); nsServers = servers as unknown as ServerItem[]; }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to load namespace servers'; }
	}

	async function toggleServer(server: ServerItem) {
		if (expandedServer === server.id) { expandedServer = null; return; }
		expandedServer = server.id;
		if (serverTools[server.id]) return;
		loadingTools = server.id;
		try {
			const nsId = selectedNs?.id ?? '';
			if (nsId) { const tools = await trpc.toolConfigs.list.query({ namespaceId: nsId, serverId: server.id }); serverTools[server.id] = tools as unknown as ToolConfig[]; }
			else serverTools[server.id] = [];
		} catch { serverTools[server.id] = []; }
		loadingTools = null;
	}

	async function toggleServerStandalone(server: ServerItem) {
		if (expandedServer === server.id) { expandedServer = null; return; }
		expandedServer = server.id;
		serverTools[server.id] = [];
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Explorer</h2>
			<p class="text-sm text-muted-foreground">Browse MCP servers, namespaces, and their tools</p>
		</div>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error} <Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button></AlertDescription></Alert>
	{/if}

	{#if loading}
		<div class="space-y-4">
			{#each [1, 2, 3] as _}<Card.Root><Card.Content class="p-6"><Skeleton class="h-20 w-full" /></Card.Content></Card.Root>{/each}
		</div>
	{:else}
		<Tabs.Root value="namespaces">
			<Tabs.List class="mb-4">
				<Tabs.Trigger value="namespaces" onclick={() => { selectedNs = null; expandedServer = null; }}>
					<Layers class="size-4 mr-1.5" />Namespaces
				</Tabs.Trigger>
				<Tabs.Trigger value="servers" onclick={() => { selectedNs = null; expandedServer = null; }}>
					<Server class="size-4 mr-1.5" />All Servers
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="namespaces">
				<div class="flex gap-6">
					<div class="w-64 flex-shrink-0">
						<p class="text-xs font-semibold text-muted-foreground uppercase mb-2 px-1">Namespaces</p>
						{#if namespaces.length === 0}
							<p class="text-sm text-muted-foreground p-2">No namespaces created yet.</p>
						{:else}
							<div class="space-y-1">
								{#each namespaces as ns}
									<Button variant={selectedNs?.id === ns.id ? 'default' : 'ghost'} class="w-full justify-start" onclick={() => selectNamespace(ns)}>
										<div class="text-left truncate">
											<span class="font-medium">{ns.name}</span>
											{#if ns.description}<span class="block text-xs opacity-70 mt-0.5">{ns.description}</span>{/if}
										</div>
									</Button>
								{/each}
							</div>
						{/if}
					</div>

					<div class="flex-1 min-w-0">
						{#if !selectedNs}
							<Card.Root>
								<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
									<Search class="size-10 text-muted-foreground mb-3" />
									<p class="text-sm text-muted-foreground">Select a namespace to browse its servers and tools</p>
								</Card.Content>
							</Card.Root>
						{:else if nsServers.length === 0}
							<Card.Root>
								<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
									<Server class="size-10 text-muted-foreground mb-3" />
									<p class="text-sm text-muted-foreground">No servers in this namespace</p>
								</Card.Content>
							</Card.Root>
						{:else}
							<div class="space-y-2">
								{#each nsServers as server}
									<Card.Root>
										<button onclick={() => toggleServer(server)} class="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors">
											<div class="flex items-center gap-3">
												<span class="size-2.5 rounded-full flex-shrink-0 {server.status === 'active' || server.status === 'running' ? 'bg-success' : 'bg-muted-foreground'}"></span>
												<div>
													<span class="font-medium">{server.displayName || server.name}</span>
													<Badge variant="secondary" class="ml-2">{server.transport}</Badge>
												</div>
											</div>
											{#if expandedServer === server.id}<ChevronUp class="size-4 text-muted-foreground" />{:else}<ChevronDown class="size-4 text-muted-foreground" />{/if}
										</button>
										{#if expandedServer === server.id}
											<Separator />
											<div class="p-4">
												<p class="text-xs text-muted-foreground uppercase font-semibold mb-3">Tool Configurations</p>
												{#if loadingTools === server.id}
													<Skeleton class="h-8 w-full" />
												{:else if (serverTools[server.id] ?? []).length === 0}
													<p class="text-sm text-muted-foreground">No tool configurations. Tools are discovered when the server is connected via an endpoint.</p>
												{:else}
													<div class="space-y-2">
														{#each serverTools[server.id] as tool}
															<div class="bg-muted/50 rounded-lg p-3">
																<div class="flex items-center justify-between">
																	<div class="flex items-center gap-2">
																		<span class="size-2 rounded-full {tool.enabled ? 'bg-success' : 'bg-muted-foreground'}"></span>
																		<span class="font-mono text-sm">{tool.displayName || tool.toolName}</span>
																	</div>
																	<Badge variant={tool.enabled ? 'default' : 'outline'}>{tool.enabled ? 'Enabled' : 'Disabled'}</Badge>
																</div>
																{#if tool.description}<p class="text-xs text-muted-foreground mt-1.5">{tool.description}</p>{/if}
															</div>
														{/each}
													</div>
												{/if}
											</div>
										{/if}
									</Card.Root>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="servers">
				{#if allServers.length === 0}
					<Card.Root>
						<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
							<Server class="size-10 text-muted-foreground mb-3" />
							<p class="text-sm text-muted-foreground">No servers configured yet.</p>
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="space-y-2">
						{#each allServers as server}
							<Card.Root>
								<button onclick={() => toggleServerStandalone(server)} class="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors">
									<div class="flex items-center gap-3">
										<span class="size-2.5 rounded-full flex-shrink-0 {server.status === 'active' || server.status === 'running' ? 'bg-success' : 'bg-muted-foreground'}"></span>
										<div>
											<span class="font-medium">{server.displayName || server.name}</span>
											<Badge variant="secondary" class="ml-2">{server.transport}</Badge>
											<span class="ml-1 text-xs text-muted-foreground">{server.status ?? 'unknown'}</span>
										</div>
									</div>
									{#if expandedServer === server.id}<ChevronUp class="size-4 text-muted-foreground" />{:else}<ChevronDown class="size-4 text-muted-foreground" />{/if}
								</button>
								{#if expandedServer === server.id}
									<Separator />
									<div class="p-4">
										<div class="grid grid-cols-2 gap-3 text-sm">
											<div><span class="text-muted-foreground text-xs">ID</span><p class="font-mono text-xs mt-0.5">{server.id}</p></div>
											<div><span class="text-muted-foreground text-xs">Transport</span><p class="mt-0.5">{server.transport}</p></div>
										</div>
										<p class="text-xs text-muted-foreground mt-3">Add this server to a namespace to configure tools and expose via endpoints.</p>
									</div>
								{/if}
							</Card.Root>
						{/each}
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>
