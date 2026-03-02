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
	import { LogOut, AlertCircle, CheckCircle } from '@lucide/svelte';

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

	async function load() {
		try {
			const meRes = await fetch('/api/v1/admin/me');
			if (meRes.ok) { userInfo = await meRes.json(); isAdmin = userInfo?.permissions.includes('admin.users') ?? false; }
			if (isAdmin) {
				const [usersRes, rolesRes] = await Promise.all([fetch('/api/v1/admin/users'), fetch('/api/v1/admin/roles')]);
				if (usersRes.ok) users = (await usersRes.json()).users;
				if (rolesRes.ok) roleList = (await rolesRes.json()).roles;
			}
		} catch { error = 'Failed to load'; }
		loading = false;
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
