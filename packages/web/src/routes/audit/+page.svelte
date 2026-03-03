<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ClipboardList, AlertCircle, ChevronLeft, ChevronRight, BarChart3 } from '@lucide/svelte';

	interface AuditEntry {
		id: string; userId: string | null; action: string; resource: string;
		resourceId: string | null; status: string; ipAddress: string | null;
		durationMs: number | null; createdAt: string; details?: Record<string, unknown>;
	}

	interface ToolStat { toolName: string; totalCalls: number; successCalls: number; failedCalls: number; avgDurationMs: number; }

	let logs = $state<AuditEntry[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let offset = $state(0);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let actionFilter = $state('all');
	let statusFilter = $state('all');
	let toolStats = $state<ToolStat[]>([]);
	const limit = 50;

	async function load() {
		loading = true;
		try {
			const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (searchQuery.trim()) params.set('search', searchQuery.trim());
			if (actionFilter !== 'all') params.set('action', actionFilter);
			if (statusFilter !== 'all') params.set('status', statusFilter);
			const res = await fetch(`/api/v1/admin/audit-logs?${params}`);
			if (res.ok) { const data = await res.json(); logs = data.auditLogs; total = data.total; }
			else if (res.status === 403) error = 'Insufficient permissions. Admin access required.';
		} catch { error = 'Failed to load'; }
		loading = false;
	}

	onMount(async () => {
		load();
		trpc.audit.perToolStats.query().then(r => { toolStats = r; }).catch(() => {});
	});

	function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'success': return 'default';
			case 'denied': return 'destructive';
			case 'failure': return 'secondary';
			default: return 'outline';
		}
	}

	function actionCategory(action: string): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		if (action.startsWith('tools/') || action.startsWith('tool.')) return { label: 'tools', variant: 'default' };
		if (action.startsWith('server.')) return { label: 'server', variant: 'secondary' };
		if (action.startsWith('namespace.')) return { label: 'namespace', variant: 'outline' };
		if (action.startsWith('auth.') || action.startsWith('user.')) return { label: 'auth', variant: 'destructive' };
		return { label: 'system', variant: 'outline' };
	}

	function prevPage() { offset = Math.max(0, offset - limit); load(); }
	function nextPage() { if (offset + limit < total) { offset += limit; load(); } }
	function handleSearch() { offset = 0; load(); }
	function totalPages(): number { return Math.max(1, Math.ceil(total / limit)); }
	function currentPage(): number { return Math.floor(offset / limit) + 1; }
</script>

<div>
	<div class="flex justify-between items-center mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Audit Log</h2>
			<p class="text-sm text-muted-foreground">Track all platform activity</p>
		</div>
		<Badge variant="outline">{total} entries</Badge>
	</div>

	{#if error}<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error}</AlertDescription></Alert>{/if}

	{#if toolStats.length > 0}
		<Card.Root class="mb-6">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<BarChart3 class="size-4" />
					Tool Usage (24h)
				</Card.Title>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Tool</Table.Head>
							<Table.Head class="text-right">Calls</Table.Head>
							<Table.Head class="text-right">Success</Table.Head>
							<Table.Head class="text-right">Failed</Table.Head>
							<Table.Head class="text-right">Error Rate</Table.Head>
							<Table.Head class="text-right">Avg Duration</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each toolStats.slice(0, 10) as stat}
							<Table.Row class="text-sm">
								<Table.Cell class="font-mono text-xs">{stat.toolName}</Table.Cell>
								<Table.Cell class="text-right font-medium">{stat.totalCalls}</Table.Cell>
								<Table.Cell class="text-right text-green-600 dark:text-green-400">{stat.successCalls}</Table.Cell>
								<Table.Cell class="text-right text-red-600 dark:text-red-400">{stat.failedCalls}</Table.Cell>
								<Table.Cell class="text-right">
									{#if stat.totalCalls > 0}
										<Badge variant={stat.failedCalls / stat.totalCalls > 0.1 ? 'destructive' : 'outline'} class="text-xs">
											{Math.round((stat.failedCalls / stat.totalCalls) * 100)}%
										</Badge>
									{:else}
										-
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right font-mono text-xs">{stat.avgDurationMs}ms</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="flex flex-wrap gap-3 mb-4">
		<div class="flex-1 min-w-[200px]">
			<Input bind:value={searchQuery} onkeydown={(e) => { if (e.key === 'Enter') handleSearch(); }} placeholder="Search actions, resources..." />
		</div>
		<select bind:value={actionFilter} onchange={handleSearch} class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
			<option value="all">All actions</option>
			<option value="tools">Tool calls</option>
			<option value="server">Server events</option>
			<option value="namespace">Namespace events</option>
			<option value="auth">Auth events</option>
		</select>
		<select bind:value={statusFilter} onchange={handleSearch} class="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
			<option value="all">All statuses</option>
			<option value="success">Success</option>
			<option value="failure">Failure</option>
			<option value="denied">Denied</option>
		</select>
	</div>

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-60 w-full" /></Card.Content></Card.Root>
	{:else if logs.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<ClipboardList class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No audit log entries{searchQuery ? ' matching your search' : ''}.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Timestamp</Table.Head>
							<Table.Head>User</Table.Head>
							<Table.Head>Action</Table.Head>
							<Table.Head>Resource</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Duration</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each logs as entry}
							{@const cat = actionCategory(entry.action)}
							<Table.Row class="text-xs">
								<Table.Cell class="whitespace-nowrap text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</Table.Cell>
								<Table.Cell class="text-muted-foreground">{entry.userId?.slice(0, 8) ?? 'system'}...</Table.Cell>
								<Table.Cell>
									<span class="inline-flex items-center gap-1.5">
										<Badge variant={cat.variant} class="text-[10px]">{cat.label}</Badge>
										<span class="font-mono">{entry.action}</span>
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="font-mono">{entry.resource}</span>
									{#if entry.resourceId}<span class="text-muted-foreground">/{entry.resourceId.slice(0, 8)}</span>{/if}
								</Table.Cell>
								<Table.Cell><Badge variant={statusVariant(entry.status)}>{entry.status}</Badge></Table.Cell>
								<Table.Cell class="text-muted-foreground font-mono">{entry.durationMs ? entry.durationMs + 'ms' : '-'}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<div class="flex justify-between items-center mt-4">
			<span class="text-xs text-muted-foreground">Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={prevPage} disabled={offset === 0}><ChevronLeft class="size-4" /></Button>
				<span class="text-xs text-muted-foreground">Page {currentPage()} of {totalPages()}</span>
				<Button variant="outline" size="sm" onclick={nextPage} disabled={offset + limit >= total}><ChevronRight class="size-4" /></Button>
			</div>
		</div>
	{/if}
</div>
