<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { LogOut, AlertCircle, CheckCircle, Radio, Loader2 } from '@lucide/svelte';
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
	let switchingToMode = $state<RuntimeMode | null>(null);
	let transportConfig = $state({ sse: true, websocket: true, streamableHttp: true });
	let transportSaving = $state(false);

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

	let switchPollTimer = $state<ReturnType<typeof setInterval> | null>(null);

	async function handleModeSwitch(newMode: RuntimeMode) {
		if (newMode === runtimeMode || modeSwitching) return;
		modeSwitching = true;
		switchingToMode = newMode;
		error = null;
		success = null;
		try {
			await trpc.runtimeMode.switchMode.mutate({ mode: newMode });
			// Start polling for completion
			pollSwitchStatus();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to switch mode';
			modeSwitching = false;
			switchingToMode = null;
		}
	}

	function pollSwitchStatus() {
		if (switchPollTimer) clearInterval(switchPollTimer);
		switchPollTimer = setInterval(async () => {
			try {
				const status = await trpc.runtimeMode.status.query() as {
					mode: RuntimeMode; switching: boolean; switchingTo: RuntimeMode | null; switchError: string | null;
				} | null;
				if (!status) return;
				runtimeMode = status.mode;
				if (!status.switching) {
					// Switch complete
					if (switchPollTimer) { clearInterval(switchPollTimer); switchPollTimer = null; }
					modeSwitching = false;
					switchingToMode = null;
					if (status.switchError) {
						error = `Mode switch failed: ${status.switchError}`;
					} else {
						success = `Runtime mode switched to ${status.mode}`;
						// Refresh transport config for the new mode
						if (status.mode === 'multi-transport') {
							const tc = await trpc.runtimeMode.transportConfig.query() as typeof transportConfig;
							transportConfig = tc;
						}
					}
				}
			} catch {
				// Network error during poll — keep trying
			}
		}, 1500);
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
	onDestroy(() => { if (switchPollTimer) clearInterval(switchPollTimer); });

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
									{@const isActive = runtimeMode === mode.id && !modeSwitching}
									{@const isSwitchingTo = modeSwitching && mode.id === switchingToMode}
									<button
										class="flex items-start gap-3 p-4 rounded-lg border text-left transition-colors {isActive ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'} {modeSwitching ? 'opacity-60 cursor-not-allowed' : ''}"
										onclick={() => handleModeSwitch(mode.id)}
										disabled={modeSwitching}
									>
										<div class="mt-0.5">
											{#if isSwitchingTo}
												<Loader2 class="size-4 text-primary animate-spin" />
											{:else}
												<Radio class="size-4 {isActive ? 'text-primary' : 'text-muted-foreground'}" />
											{/if}
										</div>
										<div class="flex-1">
											<div class="flex items-center gap-2">
												<span class="font-medium text-sm">{mode.label}</span>
												{#if isActive}
													<Badge variant="default" class="text-xs">Active</Badge>
												{/if}
											</div>
											<p class="text-xs text-muted-foreground mt-1">{mode.desc}</p>
										</div>
									</button>
								{/each}
							</div>
							{#if modeSwitching}
								<div class="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
									<Loader2 class="size-4 text-primary animate-spin" />
									<div>
										<p class="text-sm font-medium">Switching runtime mode...</p>
										<p class="text-xs text-muted-foreground">Stopping current processes and starting new ones. The UI will update when ready.</p>
									</div>
								</div>
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
