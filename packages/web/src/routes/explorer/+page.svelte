<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Server {
		id: string;
		name: string;
		displayName?: string;
		transport: string;
		status?: string;
	}

	interface Namespace {
		id: string;
		name: string;
		description?: string;
	}

	interface ToolConfig {
		id: string;
		serverId: string;
		toolName: string;
		enabled: boolean;
		displayName?: string | null;
		description?: string | null;
	}

	let namespaces = $state<Namespace[]>([]);
	let selectedNs = $state<Namespace | null>(null);
	let nsServers = $state<Server[]>([]);
	let expandedServer = $state<string | null>(null);
	let serverTools = $state<Record<string, ToolConfig[]>>({});
	let loading = $state(true);
	let loadingTools = $state<string | null>(null);
	let error = $state<string | null>(null);

	// Also load all servers for the standalone view
	let allServers = $state<Server[]>([]);
	let viewMode = $state<'namespaces' | 'servers'>('namespaces');

	async function load() {
		try {
			const [nsResult, srvResult] = await Promise.all([
				trpc.namespaces.list.query(),
				trpc.servers.list.query(),
			]);
			namespaces = nsResult as unknown as Namespace[];
			const raw = srvResult as unknown as { servers?: Server[] };
			allServers = raw.servers ?? (srvResult as unknown as Server[]);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		}
		loading = false;
	}

	onMount(load);

	async function selectNamespace(ns: Namespace) {
		selectedNs = ns;
		expandedServer = null;
		serverTools = {};
		try {
			const servers = await trpc.namespaces.listServers.query({ namespaceId: ns.id });
			nsServers = servers as unknown as Server[];
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load namespace servers';
		}
	}

	async function toggleServer(server: Server) {
		if (expandedServer === server.id) {
			expandedServer = null;
			return;
		}
		expandedServer = server.id;

		if (serverTools[server.id]) return;

		loadingTools = server.id;
		try {
			// Load tool configs for the selected namespace + server
			const nsId = selectedNs?.id ?? '';
			if (nsId) {
				const tools = await trpc.toolConfigs.list.query({ namespaceId: nsId, serverId: server.id });
				serverTools[server.id] = tools as unknown as ToolConfig[];
			} else {
				serverTools[server.id] = [];
			}
		} catch {
			// No tool configs yet - that's fine
			serverTools[server.id] = [];
		}
		loadingTools = null;
	}

	async function toggleServerStandalone(server: Server) {
		if (expandedServer === server.id) {
			expandedServer = null;
			return;
		}
		expandedServer = server.id;
		// In standalone mode, no namespace context for tool configs
		serverTools[server.id] = [];
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold">Explorer</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Browse MCP servers, namespaces, and their tools</p>
		</div>
		<div class="flex gap-1 bg-[var(--color-surface)] rounded-lg p-1 border border-[var(--color-border)]">
			<button
				onclick={() => { viewMode = 'namespaces'; selectedNs = null; expandedServer = null; }}
				class="px-3 py-1.5 text-sm rounded-md transition-colors"
				class:bg-[var(--color-primary)]={viewMode === 'namespaces'}
				class:text-white={viewMode === 'namespaces'}
				class:text-[var(--color-text-muted)]={viewMode !== 'namespaces'}
			>Namespaces</button>
			<button
				onclick={() => { viewMode = 'servers'; selectedNs = null; expandedServer = null; }}
				class="px-3 py-1.5 text-sm rounded-md transition-colors"
				class:bg-[var(--color-primary)]={viewMode === 'servers'}
				class:text-white={viewMode === 'servers'}
				class:text-[var(--color-text-muted)]={viewMode !== 'servers'}
			>All Servers</button>
		</div>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">
			{error}
			<button onclick={() => error = null} class="ml-2 underline">dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if viewMode === 'namespaces'}
		<div class="flex gap-6">
			<!-- Namespace list -->
			<div class="w-64 flex-shrink-0">
				<h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2 px-1">Namespaces</h3>
				{#if namespaces.length === 0}
					<p class="text-sm text-[var(--color-text-muted)] p-2">No namespaces created yet.</p>
				{:else}
					<div class="space-y-1">
						{#each namespaces as ns}
							<button
								onclick={() => selectNamespace(ns)}
								class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
								class:bg-[var(--color-primary)]={selectedNs?.id === ns.id}
								class:text-white={selectedNs?.id === ns.id}
								class:bg-[var(--color-surface)]={selectedNs?.id !== ns.id}
								class:text-[var(--color-text)]={selectedNs?.id !== ns.id}
								class:hover:bg-[var(--color-border)]={selectedNs?.id !== ns.id}
							>
								<span class="font-medium">{ns.name}</span>
								{#if ns.description}
									<span class="block text-xs opacity-70 mt-0.5">{ns.description}</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Server + tool detail -->
			<div class="flex-1 min-w-0">
				{#if !selectedNs}
					<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
						<p class="text-[var(--color-text-muted)]">Select a namespace to browse its servers and tools</p>
					</div>
				{:else if nsServers.length === 0}
					<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
						<p class="text-[var(--color-text-muted)]">No servers in this namespace</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each nsServers as server}
							<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
								<button
									onclick={() => toggleServer(server)}
									class="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--color-border)]/30 transition-colors"
								>
									<div class="flex items-center gap-3">
										<span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
											class:bg-[var(--color-success)]={server.status === 'active' || server.status === 'running'}
											class:bg-[var(--color-text-muted)]={server.status !== 'active' && server.status !== 'running'}
										></span>
										<div>
											<span class="font-medium">{server.displayName || server.name}</span>
											<span class="ml-2 text-xs bg-[var(--color-border)] px-2 py-0.5 rounded">{server.transport}</span>
										</div>
									</div>
									<span class="text-[var(--color-text-muted)] text-sm">{expandedServer === server.id ? '▲' : '▼'}</span>
								</button>

								{#if expandedServer === server.id}
									<div class="border-t border-[var(--color-border)] p-4">
										<div class="text-xs text-[var(--color-text-muted)] mb-3 uppercase font-semibold">Tool Configurations</div>
										{#if loadingTools === server.id}
											<p class="text-sm text-[var(--color-text-muted)]">Loading tools...</p>
										{:else if (serverTools[server.id] ?? []).length === 0}
											<p class="text-sm text-[var(--color-text-muted)]">No tool configurations. Tools are discovered when the server is connected via an endpoint.</p>
										{:else}
											<div class="space-y-2">
												{#each serverTools[server.id] as tool}
													<div class="bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
														<div class="flex items-center justify-between">
															<div class="flex items-center gap-2">
																<span class="w-2 h-2 rounded-full" class:bg-[var(--color-success)]={tool.enabled} class:bg-[var(--color-text-muted)]={!tool.enabled}></span>
																<span class="font-mono text-sm">{tool.displayName || tool.toolName}</span>
															</div>
															{#if tool.enabled}
																<span class="text-xs px-2 py-0.5 rounded bg-[var(--color-success)]/20 text-[var(--color-success)]">Enabled</span>
															{:else}
																<span class="text-xs px-2 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-muted)]">Disabled</span>
															{/if}
														</div>
														{#if tool.description}
															<p class="text-xs text-[var(--color-text-muted)] mt-1.5">{tool.description}</p>
														{/if}
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- All Servers view -->
		<div class="space-y-2">
			{#if allServers.length === 0}
				<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
					<p class="text-[var(--color-text-muted)]">No servers configured yet.</p>
				</div>
			{:else}
				{#each allServers as server}
					<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
						<button
							onclick={() => toggleServerStandalone(server)}
							class="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--color-border)]/30 transition-colors"
						>
							<div class="flex items-center gap-3">
								<span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
									class:bg-[var(--color-success)]={server.status === 'active' || server.status === 'running'}
									class:bg-[var(--color-text-muted)]={server.status !== 'active' && server.status !== 'running'}
								></span>
								<div>
									<span class="font-medium">{server.displayName || server.name}</span>
									<span class="ml-2 text-xs bg-[var(--color-border)] px-2 py-0.5 rounded">{server.transport}</span>
									<span class="ml-1 text-xs text-[var(--color-text-muted)]">{server.status ?? 'unknown'}</span>
								</div>
							</div>
							<span class="text-[var(--color-text-muted)] text-sm">{expandedServer === server.id ? '▲' : '▼'}</span>
						</button>

						{#if expandedServer === server.id}
							<div class="border-t border-[var(--color-border)] p-4">
								<div class="grid grid-cols-2 gap-3 text-sm">
									<div>
										<span class="text-[var(--color-text-muted)] text-xs">ID</span>
										<p class="font-mono text-xs mt-0.5">{server.id}</p>
									</div>
									<div>
										<span class="text-[var(--color-text-muted)] text-xs">Transport</span>
										<p class="mt-0.5">{server.transport}</p>
									</div>
								</div>
								<p class="text-xs text-[var(--color-text-muted)] mt-3">Add this server to a namespace to configure tools and expose via endpoints.</p>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
