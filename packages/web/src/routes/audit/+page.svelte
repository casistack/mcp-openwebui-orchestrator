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
	const limit = 50;

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/v1/admin/audit-logs?limit=${limit}&offset=${offset}`);
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
			case 'success': return 'text-[var(--color-success)]';
			case 'denied': return 'text-[var(--color-error)]';
			case 'failure': return 'text-[var(--color-warning)]';
			default: return 'text-[var(--color-text-muted)]';
		}
	}

	function prevPage() { offset = Math.max(0, offset - limit); load(); }
	function nextPage() { if (offset + limit < total) { offset += limit; load(); } }
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<h2 class="text-2xl font-bold">Audit Log</h2>
		<span class="text-sm text-[var(--color-text-muted)]">{total} total entries</span>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">{error}</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading...</p>
	{:else if logs.length === 0}
		<div class="bg-[var(--color-surface)] rounded-lg p-8 text-center border border-[var(--color-border)]">
			<p class="text-[var(--color-text-muted)]">No audit log entries.</p>
		</div>
	{:else}
		<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
			<table class="w-full text-sm">
				<thead class="border-b border-[var(--color-border)]">
					<tr class="text-left text-[var(--color-text-muted)]">
						<th class="p-3">Time</th>
						<th class="p-3">Action</th>
						<th class="p-3">Resource</th>
						<th class="p-3">Status</th>
						<th class="p-3">User</th>
						<th class="p-3">Duration</th>
					</tr>
				</thead>
				<tbody>
					{#each logs as entry}
						<tr class="border-b border-[var(--color-border)] last:border-0 text-xs">
							<td class="p-3 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
							<td class="p-3 font-mono">{entry.action}</td>
							<td class="p-3">
								{entry.resource}
								{#if entry.resourceId}
									<span class="text-[var(--color-text-muted)]">/{entry.resourceId}</span>
								{/if}
							</td>
							<td class="p-3 {statusColor(entry.status)}">{entry.status}</td>
							<td class="p-3 text-[var(--color-text-muted)]">{entry.userId?.slice(0, 8) ?? '-'}...</td>
							<td class="p-3 text-[var(--color-text-muted)]">{entry.durationMs ? entry.durationMs + 'ms' : '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="flex justify-between items-center mt-4 text-sm">
			<span class="text-[var(--color-text-muted)]">Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
			<div class="flex gap-2">
				<button onclick={prevPage} disabled={offset === 0} class="px-3 py-1 rounded border border-[var(--color-border)] text-sm disabled:opacity-30">Prev</button>
				<button onclick={nextPage} disabled={offset + limit >= total} class="px-3 py-1 rounded border border-[var(--color-border)] text-sm disabled:opacity-30">Next</button>
			</div>
		</div>
	{/if}
</div>
