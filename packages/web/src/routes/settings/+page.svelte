<script lang="ts">
	import { onMount } from 'svelte';

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
	let activeTab = $state<'profile' | 'appearance' | 'users'>('profile');

	async function load() {
		try {
			const meRes = await fetch('/api/v1/admin/me');
			if (meRes.ok) {
				userInfo = await meRes.json();
				isAdmin = userInfo?.permissions.includes('admin.users') ?? false;
			}

			if (isAdmin) {
				const [usersRes, rolesRes] = await Promise.all([
					fetch('/api/v1/admin/users'),
					fetch('/api/v1/admin/roles'),
				]);
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
			const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: roleName }),
			});
			if (res.ok) { success = 'Role updated'; await load(); }
			else error = (await res.json()).error;
		} catch { error = 'Network error'; }
	}

	async function handleLogout() {
		try {
			await fetch('/api/auth/sign-out', { method: 'POST' });
			window.location.href = '/login';
		} catch {
			window.location.href = '/login';
		}
	}

	function clearThemeCache() {
		localStorage.removeItem('mcp-dark-mode');
		success = 'Theme cache cleared. Reload to apply defaults.';
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold">Settings</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Manage your account and platform settings</p>
		</div>
		<button onclick={handleLogout} class="border border-[var(--color-border)] text-[var(--color-text-muted)] px-4 py-2 rounded-lg text-sm hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors">
			Sign Out
		</button>
	</div>

	{#if error}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">{error}</div>
	{/if}
	{#if success}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-success) 10%, transparent); border-color: var(--color-success); color: var(--color-success);">
			{success}
			<button onclick={() => success = null} class="ml-2 underline">dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else}
		<!-- Tabs -->
		<div class="flex gap-1 mb-6 border-b border-[var(--color-border)]">
			<button
				onclick={() => activeTab = 'profile'}
				class="px-4 py-2 text-sm transition-colors -mb-px {activeTab === 'profile' ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
			>Profile</button>
			<button
				onclick={() => activeTab = 'appearance'}
				class="px-4 py-2 text-sm transition-colors -mb-px {activeTab === 'appearance' ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
			>Appearance</button>
			{#if isAdmin}
				<button
					onclick={() => activeTab = 'users'}
					class="px-4 py-2 text-sm transition-colors -mb-px {activeTab === 'users' ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)] font-medium' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
				>User Management</button>
			{/if}
		</div>

		<!-- Profile Tab -->
		{#if activeTab === 'profile'}
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<h3 class="font-bold mb-4">Your Account</h3>
				<div class="space-y-3 text-sm">
					<div class="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
						<span class="text-[var(--color-text-muted)]">User ID</span>
						<span class="font-mono text-xs">{userInfo?.userId}</span>
					</div>
					<div class="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
						<span class="text-[var(--color-text-muted)]">Role</span>
						<span class="px-2 py-0.5 rounded text-xs" style="background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary);">{userInfo?.role?.name ?? 'No role'}</span>
					</div>
				</div>
				{#if userInfo?.permissions.length}
					<div class="mt-4">
						<span class="text-sm text-[var(--color-text-muted)]">Permissions</span>
						<div class="flex flex-wrap gap-1 mt-2">
							{#each userInfo.permissions as perm}
								<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs font-mono">{perm}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>

		<!-- Appearance Tab -->
		{:else if activeTab === 'appearance'}
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<h3 class="font-bold mb-4">Appearance</h3>
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Theme</p>
							<p class="text-xs text-[var(--color-text-muted)]">Toggle dark/light mode using the sidebar button</p>
						</div>
					</div>
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Reset Theme</p>
							<p class="text-xs text-[var(--color-text-muted)]">Clear saved theme preference</p>
						</div>
						<button onclick={clearThemeCache} class="border border-[var(--color-border)] px-3 py-1.5 rounded text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
							Reset
						</button>
					</div>
				</div>
			</div>

			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] mt-4">
				<h3 class="font-bold mb-4">Platform Info</h3>
				<div class="space-y-2 text-sm">
					<div class="flex justify-between py-1">
						<span class="text-[var(--color-text-muted)]">Version</span>
						<span class="font-mono text-xs">0.1.0</span>
					</div>
					<div class="flex justify-between py-1">
						<span class="text-[var(--color-text-muted)]">Frontend</span>
						<span class="font-mono text-xs">SvelteKit</span>
					</div>
					<div class="flex justify-between py-1">
						<span class="text-[var(--color-text-muted)]">Backend</span>
						<span class="font-mono text-xs">Express 5 + tRPC</span>
					</div>
				</div>
			</div>

		<!-- Users Tab (Admin only) -->
		{:else if activeTab === 'users' && isAdmin}
			<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
				<div class="px-4 py-3 border-b border-[var(--color-border)]">
					<h3 class="font-bold text-sm">User Management</h3>
					<p class="text-xs text-[var(--color-text-muted)]">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
				</div>
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
							<th class="text-left px-4 py-2.5 font-medium">Email</th>
							<th class="text-left px-4 py-2.5 font-medium">Name</th>
							<th class="text-left px-4 py-2.5 font-medium">Role</th>
							<th class="text-left px-4 py-2.5 font-medium">Change Role</th>
						</tr>
					</thead>
					<tbody>
						{#each users as user}
							<tr class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/20">
								<td class="px-4 py-2.5 text-xs">{user.email}</td>
								<td class="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{user.name ?? '-'}</td>
								<td class="px-4 py-2.5">
									<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{user.role?.name ?? 'none'}</span>
								</td>
								<td class="px-4 py-2.5">
									<select
										value={user.role?.name ?? ''}
										onchange={(e) => changeRole(user.id, (e.target as HTMLSelectElement).value)}
										class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-xs outline-none"
									>
										<option value="" disabled>Select role</option>
										{#each roleList as role}
											<option value={role.name}>{role.name}</option>
										{/each}
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
