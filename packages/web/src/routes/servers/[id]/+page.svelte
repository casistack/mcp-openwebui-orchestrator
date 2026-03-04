<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import ScrollArea from '$lib/components/ui/scroll-area/scroll-area.svelte';
	import { ArrowLeft, Play, Square, RotateCcw, Plus, Trash2, Eye, EyeOff, AlertCircle, Server, Key, Activity, FileText, Shield } from '@lucide/svelte';

	interface ServerDetail {
		id: string; name: string; displayName: string; transport: string; status: string;
		command?: string | null; args?: string[] | null; cwd?: string | null; url?: string | null;
		proxyType?: string | null; needsProxy?: boolean;
		createdAt?: string | null; updatedAt?: string | null;
	}
	interface Connection { serverId: string; status: string; toolCount: number; lastPingMs: number | null; lastError: string | null; }
	interface RuntimeInfo { serverId: string; status: string; pid: number | null; port: number | null; proxyType: string | null; startedAt: string | null; restartCount: number; healthy: boolean; lastError: string | null; }
	interface EnvVar { id: string; key: string; isSecret: boolean; createdAt: string | null; updatedAt: string | null; }
	interface LogEntry { stream: string; message: string; createdAt: string | null; }
	interface HealthRecord { healthy: boolean; responseTime: number | null; checkedAt: string; error: string | null; }
	interface HealthAlert { id: string; serverId: string; alertType: string; severity: string; message: string; remediation: string | null; resolvedAt: string | null; createdAt: string; }

	let serverId = $derived($page.params.id);
	let server = $state<ServerDetail | null>(null);
	let connection = $state<Connection | null>(null);
	let runtime = $state<RuntimeInfo | null>(null);
	let runtimeEnabled = $state(false);
	let envVars = $state<EnvVar[]>([]);
	let logs = $state<LogEntry[]>([]);
	let healthHistory = $state<HealthRecord[]>([]);
	let alerts = $state<HealthAlert[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let actionLoading = $state(false);

	// Env var form
	let showEnvForm = $state(false);
	let envKey = $state('');
	let envValue = $state('');
	let envIsSecret = $state(true);
	let envSaving = $state(false);
	let envError = $state<string | null>(null);

	// Tab state
	let activeTab = $state<'overview' | 'env' | 'logs' | 'health' | 'alerts'>('overview');

	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		await loadAll();
		refreshInterval = setInterval(loadAll, 15000);
	});

	onDestroy(() => { if (refreshInterval) clearInterval(refreshInterval); });

	async function loadAll() {
		try {
			const [srv, conns, rtEnabled] = await Promise.all([
				trpc.servers.get.query({ id: serverId }),
				trpc.connections.list.query().catch(() => []),
				trpc.runtime.enabled.query().catch(() => ({ enabled: false })),
			]);
			server = srv as ServerDetail;
			connection = (conns as Connection[]).find(c => c.serverId === serverId) ?? null;
			runtimeEnabled = (rtEnabled as { enabled: boolean }).enabled;

			if (runtimeEnabled) {
				const running = await trpc.runtime.listRunning.query() as RuntimeInfo[];
				runtime = running.find(r => r.serverId === serverId) ?? null;
			}

			await Promise.all([
				loadEnvVars(),
				loadLogs(),
				loadHealth(),
				loadAlerts(),
			]);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load server details';
		}
		loading = false;
	}

	async function loadEnvVars() {
		try { envVars = await trpc.serverEnvVars.list.query({ serverId }) as EnvVar[]; }
		catch { envVars = []; }
	}

	async function loadLogs() {
		if (!runtimeEnabled) return;
		try { logs = await trpc.runtime.logs.query({ serverId, limit: 200 }) as LogEntry[]; }
		catch { logs = []; }
	}

	async function loadHealth() {
		try { healthHistory = (await trpc.health.timeSeries.query({ serverId, hours: 24 })) as HealthRecord[]; }
		catch { healthHistory = []; }
	}

	async function loadAlerts() {
		try { alerts = (await trpc.alerts.forServer.query({ serverId, limit: 20 })) as HealthAlert[]; }
		catch { alerts = []; }
	}

	async function handleRuntimeAction(action: 'start' | 'stop' | 'restart') {
		actionLoading = true;
		try {
			if (action === 'start') await trpc.runtime.start.mutate({ serverId });
			else if (action === 'stop') await trpc.runtime.stop.mutate({ serverId });
			else await trpc.runtime.restart.mutate({ serverId });
			await loadAll();
		} catch (e: unknown) { error = e instanceof Error ? e.message : `Failed to ${action}`; }
		actionLoading = false;
	}

	async function addEnvVar() {
		if (!envKey.trim()) return;
		envSaving = true;
		envError = null;
		try {
			await trpc.serverEnvVars.set.mutate({ serverId, key: envKey.trim(), value: envValue, isSecret: envIsSecret });
			envKey = ''; envValue = ''; envIsSecret = true; showEnvForm = false;
			await loadEnvVars();
		} catch (e: unknown) { envError = e instanceof Error ? e.message : 'Failed to add env var'; }
		envSaving = false;
	}

	async function deleteEnvVar(key: string) {
		try {
			await trpc.serverEnvVars.delete.mutate({ serverId, key });
			await loadEnvVars();
		} catch (e: unknown) { envError = e instanceof Error ? e.message : 'Failed to delete env var'; }
	}

	function connStatus(): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		if (!connection) return { label: 'disconnected', variant: 'outline' };
		if (connection.status === 'connected') return { label: 'connected', variant: 'default' };
		if (connection.status === 'connecting' || connection.status === 'reconnecting') return { label: connection.status, variant: 'secondary' };
		return { label: connection.status || 'error', variant: 'destructive' };
	}

	function rtStatus(): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		if (!runtime) return { label: 'stopped', variant: 'outline' };
		if (runtime.status === 'running' && runtime.healthy) return { label: 'running', variant: 'default' };
		if (runtime.status === 'running' || runtime.status === 'starting') return { label: runtime.status, variant: 'secondary' };
		return { label: runtime.status, variant: 'destructive' };
	}

	function isRunning(): boolean {
		return !!runtime && (runtime.status === 'running' || runtime.status === 'starting');
	}

	const tabs = [
		{ id: 'overview' as const, label: 'Overview', icon: Server },
		{ id: 'env' as const, label: 'Environment', icon: Key },
		{ id: 'logs' as const, label: 'Logs', icon: FileText },
		{ id: 'health' as const, label: 'Health', icon: Activity },
		{ id: 'alerts' as const, label: 'Alerts', icon: Shield },
	];
</script>

<div>
	<div class="flex items-center gap-3 mb-6">
		<Button variant="ghost" size="icon" href="/servers"><ArrowLeft class="size-4" /></Button>
		<div class="flex-1">
			<h2 class="text-2xl font-bold tracking-tight">{server?.displayName || server?.name || serverId}</h2>
			<p class="text-sm text-muted-foreground font-mono">{serverId}</p>
		</div>
		{#if runtimeEnabled}
			<div class="flex gap-2">
				{#if isRunning()}
					<Button variant="outline" size="sm" disabled={actionLoading} onclick={() => handleRuntimeAction('stop')}>
						<Square class="size-4 mr-1 text-destructive" />Stop
					</Button>
					<Button variant="outline" size="sm" disabled={actionLoading} onclick={() => handleRuntimeAction('restart')}>
						<RotateCcw class="size-4 mr-1" />Restart
					</Button>
				{:else}
					<Button variant="outline" size="sm" disabled={actionLoading} onclick={() => handleRuntimeAction('start')}>
						<Play class="size-4 mr-1 text-green-600" />Start
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error} <Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button></AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<div class="grid gap-4">
			<Skeleton class="h-32 w-full" />
			<Skeleton class="h-64 w-full" />
		</div>
	{:else if !server}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<AlertCircle class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">Server not found</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Status summary cards -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Connection</p>
					{@const cs = connStatus()}
					<Badge variant={cs.variant}>{cs.label}</Badge>
				</Card.Content>
			</Card.Root>
			{#if runtimeEnabled}
				<Card.Root>
					<Card.Content class="p-4">
						<p class="text-xs text-muted-foreground mb-1">Runtime</p>
						{@const rs = rtStatus()}
						<Badge variant={rs.variant}>{rs.label}</Badge>
						{#if runtime?.port}<span class="text-xs font-mono ml-2">:{runtime.port}</span>{/if}
					</Card.Content>
				</Card.Root>
			{/if}
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Tools</p>
					<p class="text-xl font-bold">{connection?.toolCount ?? 0}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="p-4">
					<p class="text-xs text-muted-foreground mb-1">Latency</p>
					<p class="text-xl font-bold font-mono">{connection?.lastPingMs ? `${connection.lastPingMs}ms` : '-'}</p>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Tab navigation -->
		<div class="flex gap-1 border-b mb-4">
			{#each tabs as tab}
				<button
					class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => activeTab = tab.id}
				>
					<tab.icon class="size-4 inline-block mr-1 -mt-0.5" />{tab.label}
					{#if tab.id === 'alerts' && alerts.filter(a => !a.resolvedAt).length > 0}
						<Badge variant="destructive" class="ml-1 text-[10px] px-1 py-0">{alerts.filter(a => !a.resolvedAt).length}</Badge>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Tab content -->
		{#if activeTab === 'overview'}
			<Card.Root>
				<Card.Header><Card.Title class="text-sm">Server Configuration</Card.Title></Card.Header>
				<Card.Content>
					<div class="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
						<div>
							<p class="text-muted-foreground text-xs">Transport</p>
							<p class="font-medium">{server.transport}</p>
						</div>
						<div>
							<p class="text-muted-foreground text-xs">Proxy Type</p>
							<p class="font-medium">{server.proxyType ?? 'mcpo'}</p>
						</div>
						{#if server.command}
							<div class="col-span-2">
								<p class="text-muted-foreground text-xs">Command</p>
								<p class="font-mono text-xs bg-muted rounded px-2 py-1 mt-1 break-all">{server.command}{server.args?.length ? ` ${server.args.join(' ')}` : ''}</p>
							</div>
						{/if}
						{#if server.url}
							<div class="col-span-2">
								<p class="text-muted-foreground text-xs">URL</p>
								<p class="font-mono text-xs bg-muted rounded px-2 py-1 mt-1 break-all">{server.url}</p>
							</div>
						{/if}
						{#if server.cwd}
							<div class="col-span-2">
								<p class="text-muted-foreground text-xs">Working Directory</p>
								<p class="font-mono text-xs">{server.cwd}</p>
							</div>
						{/if}
						<div>
							<p class="text-muted-foreground text-xs">Needs Proxy</p>
							<p class="font-medium">{server.needsProxy ? 'Yes' : 'No'}</p>
						</div>
						{#if runtime}
							<div>
								<p class="text-muted-foreground text-xs">PID</p>
								<p class="font-mono">{runtime.pid ?? '-'}</p>
							</div>
							<div>
								<p class="text-muted-foreground text-xs">Restart Count</p>
								<p class="font-medium">{runtime.restartCount}</p>
							</div>
							{#if runtime.startedAt}
								<div>
									<p class="text-muted-foreground text-xs">Started At</p>
									<p class="text-xs">{new Date(runtime.startedAt).toLocaleString()}</p>
								</div>
							{/if}
							{#if runtime.lastError}
								<div class="col-span-2">
									<p class="text-muted-foreground text-xs">Last Error</p>
									<p class="text-xs text-destructive">{runtime.lastError}</p>
								</div>
							{/if}
						{/if}
					</div>
				</Card.Content>
			</Card.Root>

		{:else if activeTab === 'env'}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between">
					<Card.Title class="text-sm">Environment Variables</Card.Title>
					<Button variant="outline" size="sm" onclick={() => showEnvForm = !showEnvForm}>
						<Plus class="size-4 mr-1" />{showEnvForm ? 'Cancel' : 'Add Variable'}
					</Button>
				</Card.Header>
				<Card.Content>
					{#if envError}
						<Alert variant="destructive" class="mb-3">
							<AlertCircle class="size-4" />
							<AlertDescription>{envError}</AlertDescription>
						</Alert>
					{/if}

					{#if showEnvForm}
						<div class="border rounded-md p-4 mb-4 space-y-3">
							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-1">
									<Label for="env-key">Key</Label>
									<Input id="env-key" bind:value={envKey} placeholder="API_KEY" />
								</div>
								<div class="space-y-1">
									<Label for="env-value">Value</Label>
									<Input id="env-value" bind:value={envValue} type={envIsSecret ? 'password' : 'text'} placeholder="secret-value" />
								</div>
							</div>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<Switch bind:checked={envIsSecret} id="env-secret" />
									<Label for="env-secret" class="text-sm">Secret (encrypted)</Label>
								</div>
								<Button size="sm" disabled={envSaving || !envKey.trim()} onclick={addEnvVar}>
									{envSaving ? 'Saving...' : 'Save'}
								</Button>
							</div>
						</div>
					{/if}

					{#if envVars.length === 0}
						<p class="text-sm text-muted-foreground text-center py-6">No environment variables configured</p>
					{:else}
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Key</Table.Head>
									<Table.Head>Value</Table.Head>
									<Table.Head>Type</Table.Head>
									<Table.Head class="text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each envVars as envVar}
									<Table.Row>
										<Table.Cell class="font-mono text-xs">{envVar.key}</Table.Cell>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{#if envVar.isSecret}
												<span class="flex items-center gap-1"><EyeOff class="size-3" />encrypted</span>
											{:else}
												<span class="flex items-center gap-1"><Eye class="size-3" />plain text</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											<Badge variant={envVar.isSecret ? 'default' : 'secondary'} class="text-xs">
												{envVar.isSecret ? 'secret' : 'plain'}
											</Badge>
										</Table.Cell>
										<Table.Cell class="text-right">
											<Button variant="ghost" size="icon" class="size-7" onclick={() => deleteEnvVar(envVar.key)}>
												<Trash2 class="size-3 text-destructive" />
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{/if}
				</Card.Content>
			</Card.Root>

		{:else if activeTab === 'logs'}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between">
					<Card.Title class="text-sm">Runtime Logs</Card.Title>
					<Button variant="outline" size="sm" onclick={loadLogs}>
						<RotateCcw class="size-3 mr-1" />Refresh
					</Button>
				</Card.Header>
				<Card.Content>
					{#if !runtimeEnabled}
						<p class="text-sm text-muted-foreground text-center py-6">Runtime service not enabled</p>
					{:else if logs.length === 0}
						<p class="text-sm text-muted-foreground text-center py-6">No logs available</p>
					{:else}
						<ScrollArea class="h-[500px] rounded-md border p-3 bg-muted/50">
							<pre class="text-xs font-mono whitespace-pre-wrap">{#each logs as log}<span class={log.stream === 'stderr' ? 'text-red-500' : 'text-muted-foreground'}>{log.message}
</span>{/each}</pre>
						</ScrollArea>
					{/if}
				</Card.Content>
			</Card.Root>

		{:else if activeTab === 'health'}
			<Card.Root>
				<Card.Header><Card.Title class="text-sm">Health History (24h)</Card.Title></Card.Header>
				<Card.Content>
					{#if healthHistory.length === 0}
						<p class="text-sm text-muted-foreground text-center py-6">No health data yet</p>
					{:else}
						{@const times = healthHistory.map(h => h.responseTime ?? 0)}
						{@const maxTime = Math.max(...times, 1)}
						{@const healthyCount = healthHistory.filter(h => h.healthy).length}
						{@const uptimePct = ((healthyCount / healthHistory.length) * 100).toFixed(1)}

						<div class="grid grid-cols-3 gap-4 mb-4">
							<div class="text-center">
								<p class="text-2xl font-bold">{uptimePct}%</p>
								<p class="text-xs text-muted-foreground">Uptime</p>
							</div>
							<div class="text-center">
								<p class="text-2xl font-bold font-mono">{Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms</p>
								<p class="text-xs text-muted-foreground">Avg Response</p>
							</div>
							<div class="text-center">
								<p class="text-2xl font-bold font-mono">{Math.round(maxTime)}ms</p>
								<p class="text-xs text-muted-foreground">Max Response</p>
							</div>
						</div>

						<svg viewBox="0 0 400 100" class="w-full mb-4" style="max-height: 120px;">
							<line x1="5" y1="5" x2="395" y2="5" stroke="hsl(var(--border))" stroke-width="0.5" />
							<line x1="5" y1="50" x2="395" y2="50" stroke="hsl(var(--border))" stroke-width="0.5" />
							<line x1="5" y1="95" x2="395" y2="95" stroke="hsl(var(--border))" stroke-width="0.5" />
							<polyline
								points={healthHistory.map((d, i) => {
									const x = 5 + (i / Math.max(healthHistory.length - 1, 1)) * 390;
									const y = 5 + 90 - ((d.responseTime ?? 0) / maxTime) * 90;
									return `${x.toFixed(1)},${y.toFixed(1)}`;
								}).join(' ')}
								fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" stroke-linejoin="round"
							/>
						</svg>

						<svg viewBox="0 0 400 20" class="w-full" style="max-height: 24px;">
							{#each healthHistory as d, i}
								<circle
									cx={5 + (i / Math.max(healthHistory.length - 1, 1)) * 390}
									cy="10" r="2.5"
									fill={d.healthy ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
									opacity="0.8"
								/>
							{/each}
						</svg>
						<div class="flex justify-between text-[10px] text-muted-foreground mt-1">
							<span>24h ago</span><span>now</span>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

		{:else if activeTab === 'alerts'}
			<Card.Root>
				<Card.Header><Card.Title class="text-sm">Alerts</Card.Title></Card.Header>
				<Card.Content>
					{#if alerts.length === 0}
						<p class="text-sm text-muted-foreground text-center py-6">No alerts for this server</p>
					{:else}
						<div class="space-y-2">
							{#each alerts as alert}
								<div class="flex items-center justify-between py-2 px-3 rounded border text-sm {alert.resolvedAt ? 'opacity-50' : ''}">
									<div class="flex items-center gap-2 min-w-0">
										<Badge variant={alert.severity === 'critical' || alert.severity === 'high' ? 'destructive' : alert.severity === 'medium' ? 'secondary' : 'outline'} class="text-xs shrink-0">{alert.severity}</Badge>
										<Badge variant="outline" class="text-xs shrink-0">{alert.alertType}</Badge>
										<span class="text-xs truncate">{alert.message}</span>
									</div>
									<div class="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
										{#if alert.resolvedAt}
											<Badge variant="outline" class="text-xs">resolved</Badge>
										{/if}
										<span>{new Date(alert.createdAt).toLocaleString()}</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
