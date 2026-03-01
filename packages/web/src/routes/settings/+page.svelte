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
</script>

<div>
	<h2 class="text-2xl font-bold mb-6">Settings</h2>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">{error}</div>
	{/if}
	{#if success}
		<div class="bg-[var(--color-success)]/10 border border-[var(--color-success)] rounded-lg p-3 mb-4 text-sm text-[var(--color-success)]">{success}</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else}
		<!-- Current User -->
		<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] mb-6">
			<h3 class="font-bold mb-3">Your Account</h3>
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<span class="text-[var(--color-text-muted)]">User ID:</span>
					<span class="ml-2 font-mono text-xs">{userInfo?.userId}</span>
				</div>
				<div>
					<span class="text-[var(--color-text-muted)]">Role:</span>
					<span class="ml-2 font-medium">{userInfo?.role?.name ?? 'No role'}</span>
				</div>
			</div>
			{#if userInfo?.permissions.length}
				<div class="mt-3">
					<span class="text-sm text-[var(--color-text-muted)]">Permissions:</span>
					<div class="flex flex-wrap gap-1 mt-1">
						{#each userInfo.permissions as perm}
							<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{perm}</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Admin: User Management -->
		{#if isAdmin}
			<div class="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)]">
				<h3 class="font-bold mb-3">User Management</h3>
				<div class="overflow-hidden">
					<table class="w-full text-sm">
						<thead class="border-b border-[var(--color-border)]">
							<tr class="text-left text-[var(--color-text-muted)]">
								<th class="p-3">Email</th>
								<th class="p-3">Name</th>
								<th class="p-3">Role</th>
								<th class="p-3">Change Role</th>
							</tr>
						</thead>
						<tbody>
							{#each users as user}
								<tr class="border-b border-[var(--color-border)] last:border-0">
									<td class="p-3">{user.email}</td>
									<td class="p-3 text-[var(--color-text-muted)]">{user.name ?? '-'}</td>
									<td class="p-3">
										<span class="bg-[var(--color-border)] px-2 py-0.5 rounded text-xs">{user.role?.name ?? 'none'}</span>
									</td>
									<td class="p-3">
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
			</div>
		{/if}
	{/if}
</div>
