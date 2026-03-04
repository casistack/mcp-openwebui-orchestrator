<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { LogOut, AlertCircle, CheckCircle, Radio, FileCode, RefreshCw, Undo2 } from '@lucide/svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { trpc } from '$lib/trpc';

	interface UserInfo { userId: string; role: { id: string; name: string } | null; permissions: string[]; }
	interface User { id: string; email: string; name: string | null; role: { name: string } | null; }
	interface Role { id: string; name: string; description: string; }

	let userInfo = $state<UserInfo | null>(null);
	let users = $state<User[]>([]);
	let roleList = $state<Role[]>([]);
	let isAdmin = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// Runtime mode state
	type RuntimeMode = 'individual' | 'unified' | 'multi-transport';
	let runtimeMode = $state<RuntimeMode>('individual');
	let runtimeAvailable = $state(false);
	let modeSwitching = $state(false);
	let transportConfig = $state({ sse: true, websocket: true, streamableHttp: true });
	let transportSaving = $state(false);

	// Config viewer state
	interface ConfigServer { id: string; name: string; transport: string; command?: string; args?: string[]; url?: string; }
	interface DismissedEntry { id: string; serverName: string; dismissedAt: string | null; }
	let configServers = $state<ConfigServer[]>([]);
	let configPath = $state('');
	let configRaw = $state<unknown>(null);
	let configDismissed = $state<DismissedEntry[]>([]);
	let configLoading = $state(false);
	let reimporting = $state(false);

	const runtimeModes: { id: RuntimeMode; label: string; desc: string }[] = [
		{ id: 'individual', label: 'Individual', desc: 'Separate proxy per server. Port-based access (4200, 4201, ...). Best for development and debugging.' },
		{ id: 'unified', label: 'Unified', desc: 'Single MCPO process, route-based access (/server-name/). Resource-efficient, production-ready.' },
		{ id: 'multi-transport', label: 'Multi-Transport', desc: 'SSE + WebSocket + Streamable HTTP per server via SuperGateway. Maximum protocol coverage.' },
	];

	async function load() {
		try {
			const meRes = await fetch('/api/v1/admin/me');
			if (meRes.ok) { userInfo = await meRes.json(); isAdmin = userInfo?.permissions.includes('admin.users') ?? false; }
			if (isAdmin) {
				const [usersRes, rolesRes] = await Promise.all([fetch('/api/v1/admin/users'), fetch('/api/v1/admin/roles')]);
				if (usersRes.ok) users = (await usersRes.json()).users;
				if (rolesRes.ok) roleList = (await rolesRes.json()).roles;
			}
			// Load runtime mode
			await loadRuntimeMode();
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	async function loadRuntimeMode() {
		try {
			const result = await trpc.runtimeMode.getMode.query() as { mode: RuntimeMode; available: boolean };
			runtimeMode = result.mode;
			runtimeAvailable = result.available;
			if (runtimeAvailable) {
				const tc = await trpc.runtimeMode.transportConfig.query() as typeof transportConfig;
				transportConfig = tc;
			}
		} catch { /* runtime mode not available */ }
	}

	async function loadConfig() {
		configLoading = true;
		try {
			const result = await trpc.configImport.getConfig.query() as { configPath: string; servers: ConfigServer[]; raw: unknown };
			configPath = result.configPath;
			configServers = result.servers;
			configRaw = result.raw;
			const dismissed = await trpc.configImport.getDismissed.query() as DismissedEntry[];
			configDismissed = dismissed;
		} catch { /* config not available */ }
		configLoading = false;
	}

	async function handleReimport() {
		reimporting = true;
		error = null;
		try {
			const result = await trpc.configImport.reimport.mutate() as { imported: number; skipped: number; failed: number; total: number };
			success = `Imported ${result.imported} servers (${result.skipped} skipped, ${result.failed} failed)`;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to reimport';
		}
		reimporting = false;
	}

	async function handleUndismiss(serverName: string) {
		try {
			await trpc.configImport.undismiss.mutate({ serverName });
			configDismissed = configDismissed.filter(d => d.serverName !== serverName);
			success = `"${serverName}" will be imported on next reimport`;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to undismiss';
		}
	}

	async function handleModeSwitch(newMode: RuntimeMode) {
		if (newMode === runtimeMode || modeSwitching) return;
		modeSwitching = true;
		error = null;
		success = null;
		try {
			await trpc.runtimeMode.switchMode.mutate({ mode: newMode });
			runtimeMode = newMode;
			success = `Runtime mode switched to ${newMode}`;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to switch mode';
		}
		modeSwitching = false;
	}

	async function handleTransportToggle(transport: 'sse' | 'websocket' | 'streamableHttp', enabled: boolean) {
		transportSaving = true;
		try {
			const update: Record<string, boolean> = {};
			update[transport] = enabled;
			const result = await trpc.runtimeMode.updateTransportConfig.mutate(update) as typeof transportConfig;
			transportConfig = result;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to update transport config';
		}
		transportSaving = false;
	}

	onMount(load);

	async function changeRole(userId: string, roleName: string) {
		success = null; error = null;
		try {
			const res = await fetch(`/api/v1/admin/users/${userId}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: roleName }) });
			if (res.ok) { success = 'Role updated'; await load(); } else error = (await res.json()).error;
		} catch { error = 'Network error'; }
	}

	async function handleLogout() {
		try { await fetch('/api/auth/sign-out', { method: 'POST' }); window.location.href = '/login'; }
		catch { window.location.href = '/login'; }
	}

	function clearThemeCache() { localStorage.removeItem('mcp-dark-mode'); success = 'Theme cache cleared. Reload to apply defaults.'; }
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Settings</h2>
			<p class="text-sm text-muted-foreground">Manage your account and platform settings</p>
		</div>
		<Button variant="outline" onclick={handleLogout}><LogOut class="size-4 mr-2" />Sign Out</Button>
	</div>

	{#if error}<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>{/if}
	{#if success}
		<Alert class="mb-4 border-success bg-success/10">
			<CheckCircle class="size-4 text-success" />
			<AlertDescription>{success} <Button variant="link" class="ml-2 h-auto p-0" onclick={() => success = null}>dismiss</Button></AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else}
		<Tabs.Root value="profile">
			<Tabs.List class="mb-6">
				<Tabs.Trigger value="profile">Profile</Tabs.Trigger>
				<Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
				<Tabs.Trigger value="config" onclick={() => { if (!configServers.length && !configLoading) loadConfig(); }}>Config File</Tabs.Trigger>
				{#if runtimeAvailable}<Tabs.Trigger value="runtime">Runtime Mode</Tabs.Trigger>{/if}
				{#if isAdmin}<Tabs.Trigger value="users">User Management</Tabs.Trigger>{/if}
			</Tabs.List>

			<Tabs.Content value="profile">
				<Card.Root>
					<Card.Header><Card.Title>Your Account</Card.Title></Card.Header>
					<Card.Content class="space-y-3 text-sm">
						<div class="flex items-center justify-between py-2 border-b">
							<span class="text-muted-foreground">User ID</span>
							<span class="font-mono text-xs">{userInfo?.userId}</span>
						</div>
						<div class="flex items-center justify-between py-2 border-b">
							<span class="text-muted-foreground">Role</span>
							<Badge variant="secondary">{userInfo?.role?.name ?? 'No role'}</Badge>
						</div>
					</Card.Content>
				</Card.Root>
				{#if userInfo?.permissions.length}
					<Card.Root class="mt-4">
						<Card.Header><Card.Title class="text-sm">Permissions</Card.Title></Card.Header>
						<Card.Content>
							<div class="flex flex-wrap gap-1">
								{#each userInfo.permissions as perm}
									<Badge variant="outline" class="font-mono text-xs">{perm}</Badge>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/if}
			</Tabs.Content>

			<Tabs.Content value="appearance">
				<Card.Root>
					<Card.Header><Card.Title>Appearance</Card.Title></Card.Header>
					<Card.Content class="space-y-4">
						<div class="flex items-center justify-between">
							<div><p class="text-sm font-medium">Theme</p><p class="text-xs text-muted-foreground">Toggle dark/light mode using the sidebar button</p></div>
						</div>
						<Separator />
						<div class="flex items-center justify-between">
							<div><p class="text-sm font-medium">Reset Theme</p><p class="text-xs text-muted-foreground">Clear saved theme preference</p></div>
							<Button variant="outline" size="sm" onclick={clearThemeCache}>Reset</Button>
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root class="mt-4">
					<Card.Header><Card.Title>Platform Info</Card.Title></Card.Header>
					<Card.Content class="space-y-2 text-sm">
						<div class="flex justify-between py-1"><span class="text-muted-foreground">Version</span><span class="font-mono text-xs">0.1.0</span></div>
						<div class="flex justify-between py-1"><span class="text-muted-foreground">Frontend</span><span class="font-mono text-xs">SvelteKit</span></div>
						<div class="flex justify-between py-1"><span class="text-muted-foreground">Backend</span><span class="font-mono text-xs">Express 5 + tRPC</span></div>
					</Card.Content>
				</Card.Root>
			</Tabs.Content>

			<Tabs.Content value="config">
				<Card.Root>
					<Card.Header>
						<div class="flex items-center justify-between">
							<div>
								<Card.Title class="flex items-center gap-2"><FileCode class="size-4" />Claude Desktop Config</Card.Title>
								<p class="text-xs text-muted-foreground mt-1">Read-only view of <span class="font-mono">{configPath || '/config/claude_desktop_config.json'}</span></p>
							</div>
							<Button size="sm" onclick={handleReimport} disabled={reimporting}>
								<RefreshCw class="size-4 mr-1 {reimporting ? 'animate-spin' : ''}" />{reimporting ? 'Importing...' : 'Re-import'}
							</Button>
						</div>
					</Card.Header>
					<Card.Content>
						{#if configLoading}
							<Skeleton class="h-32 w-full" />
						{:else if configServers.length === 0}
							<p class="text-sm text-muted-foreground text-center py-4">No config file found or no servers defined.</p>
						{:else}
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Name</Table.Head>
										<Table.Head>Transport</Table.Head>
										<Table.Head>Command / URL</Table.Head>
										<Table.Head>Status</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each configServers as cs}
										{@const isDismissed = configDismissed.some(d => d.serverName === (cs.name || cs.id))}
										<Table.Row class={isDismissed ? 'opacity-50' : ''}>
											<Table.Cell class="font-mono text-xs">{cs.name || cs.id}</Table.Cell>
											<Table.Cell><Badge variant="secondary" class="text-xs">{cs.transport}</Badge></Table.Cell>
											<Table.Cell class="font-mono text-xs text-muted-foreground truncate max-w-[300px]">
												{cs.command ? `${cs.command} ${(cs.args ?? []).join(' ')}` : cs.url ?? '-'}
											</Table.Cell>
											<Table.Cell>
												{#if isDismissed}
													<div class="flex items-center gap-1">
														<Badge variant="outline" class="text-xs text-destructive">dismissed</Badge>
														<Button variant="ghost" size="icon" class="size-6" onclick={() => handleUndismiss(cs.name || cs.id)} title="Restore">
															<Undo2 class="size-3" />
														</Button>
													</div>
												{:else}
													<Badge variant="default" class="text-xs">active</Badge>
												{/if}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						{/if}
					</Card.Content>
				</Card.Root>

				{#if configDismissed.length > 0}
					<Card.Root class="mt-4">
						<Card.Header>
							<Card.Title class="text-sm">Dismissed Servers</Card.Title>
							<p class="text-xs text-muted-foreground">These servers were deleted and won't be re-imported on restart. Restore them to re-enable auto-import.</p>
						</Card.Header>
						<Card.Content>
							<div class="space-y-2">
								{#each configDismissed as d}
									<div class="flex items-center justify-between py-1.5 px-3 rounded border">
										<span class="font-mono text-xs">{d.serverName}</span>
										<Button variant="ghost" size="sm" onclick={() => handleUndismiss(d.serverName)}>
											<Undo2 class="size-3 mr-1" />Restore
										</Button>
									</div>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				{/if}
			</Tabs.Content>

			{#if runtimeAvailable}
				<Tabs.Content value="runtime">
					<Card.Root>
						<Card.Header>
							<Card.Title>Runtime Mode</Card.Title>
							<p class="text-xs text-muted-foreground">Choose how MCP servers are deployed and accessed</p>
						</Card.Header>
						<Card.Content class="space-y-4">
							<div class="grid gap-3">
								{#each runtimeModes as mode}
									<button
										class="flex items-start gap-3 p-4 rounded-lg border text-left transition-colors {runtimeMode === mode.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}"
										onclick={() => handleModeSwitch(mode.id)}
										disabled={modeSwitching}
									>
										<div class="mt-0.5">
											<Radio class="size-4 {runtimeMode === mode.id ? 'text-primary' : 'text-muted-foreground'}" />
										</div>
										<div class="flex-1">
											<div class="flex items-center gap-2">
												<span class="font-medium text-sm">{mode.label}</span>
												{#if runtimeMode === mode.id}
													<Badge variant="default" class="text-xs">Active</Badge>
												{/if}
											</div>
											<p class="text-xs text-muted-foreground mt-1">{mode.desc}</p>
										</div>
									</button>
								{/each}
							</div>
							{#if modeSwitching}
								<p class="text-xs text-muted-foreground">Switching mode... This may take a moment as processes are stopped and restarted.</p>
							{/if}
						</Card.Content>
					</Card.Root>

					{#if runtimeMode === 'multi-transport'}
						<Card.Root class="mt-4">
							<Card.Header>
								<Card.Title class="text-sm">Transport Protocols</Card.Title>
								<p class="text-xs text-muted-foreground">Enable or disable transport protocols for multi-transport mode</p>
							</Card.Header>
							<Card.Content class="space-y-3">
								<div class="flex items-center justify-between">
									<div><p class="text-sm font-medium">SSE (Server-Sent Events)</p><p class="text-xs text-muted-foreground">Standard real-time streaming transport</p></div>
									<Switch checked={transportConfig.sse} onCheckedChange={(v) => handleTransportToggle('sse', !!v)} disabled={transportSaving} />
								</div>
								<Separator />
								<div class="flex items-center justify-between">
									<div><p class="text-sm font-medium">WebSocket</p><p class="text-xs text-muted-foreground">Bidirectional real-time communication</p></div>
									<Switch checked={transportConfig.websocket} onCheckedChange={(v) => handleTransportToggle('websocket', !!v)} disabled={transportSaving} />
								</div>
								<Separator />
								<div class="flex items-center justify-between">
									<div><p class="text-sm font-medium">Streamable HTTP</p><p class="text-xs text-muted-foreground">HTTP-based streaming for firewalled environments</p></div>
									<Switch checked={transportConfig.streamableHttp} onCheckedChange={(v) => handleTransportToggle('streamableHttp', !!v)} disabled={transportSaving} />
								</div>
							</Card.Content>
						</Card.Root>
					{/if}
				</Tabs.Content>
			{/if}

			{#if isAdmin}
				<Tabs.Content value="users">
					<Card.Root>
						<Card.Header>
							<Card.Title>User Management</Card.Title>
							<p class="text-xs text-muted-foreground">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
						</Card.Header>
						<Card.Content class="p-0">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Email</Table.Head>
										<Table.Head>Name</Table.Head>
										<Table.Head>Role</Table.Head>
										<Table.Head>Change Role</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each users as user}
										<Table.Row>
											<Table.Cell class="text-xs">{user.email}</Table.Cell>
											<Table.Cell class="text-xs text-muted-foreground">{user.name ?? '-'}</Table.Cell>
											<Table.Cell><Badge variant="outline">{user.role?.name ?? 'none'}</Badge></Table.Cell>
											<Table.Cell>
												<select
													value={user.role?.name ?? ''}
													onchange={(e) => changeRole(user.id, (e.target as HTMLSelectElement).value)}
													class="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
												>
													<option value="" disabled>Select role</option>
													{#each roleList as role}<option value={role.name}>{role.name}</option>{/each}
												</select>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</Card.Content>
					</Card.Root>
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	{/if}
</div>
