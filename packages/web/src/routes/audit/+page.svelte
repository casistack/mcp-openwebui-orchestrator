<script lang="ts">
	import { onMount } from 'svelte';

	interface AuditEntry {
		id: string; userId: string | null; action: string; resource: string;
		resourceId: string | null; status: string; ipAddress: string | null;
		durationMs: number | null; createdAt: string;
		details?: Record<string, unknown>;
	}

	let logs = $state<AuditEntry[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let offset = $state(0);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let actionFilter = $state('all');
	let statusFilter = $state('all');
	const limit = 50;

	async function load() {
		loading = true;
		try {
			const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (searchQuery.trim()) params.set('search', searchQuery.trim());
			if (actionFilter !== 'all') params.set('action', actionFilter);
			if (statusFilter !== 'all') params.set('status', statusFilter);

			const res = await fetch(`/api/v1/admin/audit-logs?${params}`);
			if (res.ok) {
				const data = await res.json();
				logs = data.auditLogs;
				total = data.total;
			} else if (res.status === 403) {
				error = 'Insufficient permissions. Admin access required.';
			}
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(load);

	function statusColor(status: string) {
		switch (status) {
			case 'success': return 'var(--color-success)';
			case 'denied': return 'var(--color-error)';
			case 'failure': return 'var(--color-warning)';
			default: return 'var(--color-text-muted)';
		}
	}

	function actionCategory(action: string): { label: string; color: string } {
		if (action.startsWith('tools/') || action.startsWith('tool.')) return { label: 'tools', color: 'var(--color-success)' };
		if (action.startsWith('server.')) return { label: 'server', color: 'var(--color-primary)' };
		if (action.startsWith('namespace.')) return { label: 'namespace', color: 'var(--color-warning)' };
		if (action.startsWith('auth.') || action.startsWith('user.')) return { label: 'auth', color: 'var(--color-error)' };
		return { label: 'system', color: 'var(--color-text-muted)' };
	}

	function prevPage() { offset = Math.max(0, offset - limit); load(); }
	function nextPage() { if (offset + limit < total) { offset += limit; load(); } }

	function handleSearch() {
		offset = 0;
		load();
	}

	function totalPages(): number {
		return Math.max(1, Math.ceil(total / limit));
	}

	function currentPage(): number {
		return Math.floor(offset / limit) + 1;
	}
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold">Audit Log</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Track all platform activity</p>
		</div>
		<span class="text-sm text-[var(--color-text-muted)]">{total} total entries</span>
	</div>

	{#if error}
		<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">{error}</div>
	{/if}

	<!-- Filters -->
	<div class="flex flex-wrap gap-3 mb-4">
		<div class="flex-1 min-w-[200px]">
			<input
				bind:value={searchQuery}
				onkeydown={(e) => { if (e.key === 'Enter') handleSearch(); }}
				placeholder="Search actions, resources..."
				class="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
			/>
		</div>
		<select bind:value={actionFilter} onchange={handleSearch} class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none">
			<option value="all">All actions</option>
			<option value="tools">Tool calls</option>
			<option value="server">Server events</option>
			<option value="namespace">Namespace events</option>
			<option value="auth">Auth events</option>
		</select>
		<select bind:value={statusFilter} onchange={handleSearch} class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none">
			<option value="all">All statuses</option>
			<option value="success">Success</option>
			<option value="failure">Failure</option>
			<option value="denied">Denied</option>
		</select>
	</div>

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if logs.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)]">No audit log entries{searchQuery ? ' matching your search' : ''}.</p>
		</div>
	{:else}
		<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
						<th class="text-left px-4 py-2.5 font-medium">Timestamp</th>
						<th class="text-left px-4 py-2.5 font-medium">User</th>
						<th class="text-left px-4 py-2.5 font-medium">Action</th>
						<th class="text-left px-4 py-2.5 font-medium">Resource</th>
						<th class="text-left px-4 py-2.5 font-medium">Status</th>
						<th class="text-left px-4 py-2.5 font-medium">Duration</th>
					</tr>
				</thead>
				<tbody>
					{#each logs as entry}
						{@const cat = actionCategory(entry.action)}
						<tr class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/20 text-xs">
							<td class="px-4 py-2.5 whitespace-nowrap text-[var(--color-text-muted)]">{new Date(entry.createdAt).toLocaleString()}</td>
							<td class="px-4 py-2.5 text-[var(--color-text-muted)]">{entry.userId?.slice(0, 8) ?? 'system'}...</td>
							<td class="px-4 py-2.5">
								<span class="inline-flex items-center gap-1.5">
									<span class="px-1.5 py-0.5 rounded text-[10px] font-medium" style="background: color-mix(in srgb, {cat.color} 15%, transparent); color: {cat.color};">{cat.label}</span>
									<span class="font-mono">{entry.action}</span>
								</span>
							</td>
							<td class="px-4 py-2.5">
								<span class="font-mono">{entry.resource}</span>
								{#if entry.resourceId}
									<span class="text-[var(--color-text-muted)]">/{entry.resourceId.slice(0, 8)}</span>
								{/if}
							</td>
							<td class="px-4 py-2.5">
								<span class="font-medium" style="color: {statusColor(entry.status)};">{entry.status}</span>
							</td>
							<td class="px-4 py-2.5 text-[var(--color-text-muted)] font-mono">{entry.durationMs ? entry.durationMs + 'ms' : '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="flex justify-between items-center mt-4 text-sm">
			<span class="text-xs text-[var(--color-text-muted)]">Showing {offset + 1}-{Math.min(offset + limit, total)} of {total} records</span>
			<div class="flex items-center gap-2">
				<button onclick={prevPage} disabled={offset === 0} class="px-3 py-1.5 rounded border border-[var(--color-border)] text-xs disabled:opacity-30 hover:bg-[var(--color-border)]/30">Prev</button>
				<span class="text-xs text-[var(--color-text-muted)]">Page {currentPage()} of {totalPages()}</span>
				<button onclick={nextPage} disabled={offset + limit >= total} class="px-3 py-1.5 rounded border border-[var(--color-border)] text-xs disabled:opacity-30 hover:bg-[var(--color-border)]/30">Next</button>
			</div>
		</div>
	{/if}
</div>
