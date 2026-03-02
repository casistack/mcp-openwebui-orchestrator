<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Send, Clock, AlertCircle, Zap } from '@lucide/svelte';

	interface Endpoint { id: string; name: string; slug: string; transport: string; namespaceId: string; isActive: boolean; authType: string | null; }
	interface CallHistoryEntry { id: number; endpoint: string; method: string; params: string; status: 'success' | 'error'; response: string; duration: number; timestamp: Date; }

	let endpoints = $state<Endpoint[]>([]);
	let selectedEndpoint = $state<Endpoint | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let method = $state('tools/list');
	let paramsJson = $state('{}');
	let apiKey = $state('');
	let sending = $state(false);

	let response = $state<string | null>(null);
	let responseStatus = $state<'success' | 'error' | null>(null);
	let responseDuration = $state(0);

	let history = $state<CallHistoryEntry[]>([]);
	let historyCounter = 0;

	const methods = [
		{ value: 'initialize', label: 'initialize', defaultParams: '{}' },
		{ value: 'tools/list', label: 'tools/list', defaultParams: '{}' },
		{ value: 'tools/call', label: 'tools/call', defaultParams: '{"name": "tool_name", "arguments": {}}' },
		{ value: 'ping', label: 'ping', defaultParams: '{}' },
	];

	async function load() {
		try { const result = await trpc.endpoints.list.query(); endpoints = (result as unknown as Endpoint[]).filter(e => e.isActive); }
		catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed to load endpoints'; }
		loading = false;
	}

	onMount(load);

	function selectMethod(m: string) { method = m; const preset = methods.find(p => p.value === m); if (preset) paramsJson = preset.defaultParams; }

	async function sendRequest() {
		if (!selectedEndpoint) return;
		let params: Record<string, unknown>;
		try { params = JSON.parse(paramsJson); } catch { error = 'Invalid JSON in parameters'; return; }

		sending = true; error = null; response = null; responseStatus = null;
		const start = performance.now();
		const slug = selectedEndpoint.slug;

		try {
			const url = `/mcp/${slug}/mcp`;
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey}`;

			const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
			const duration = Math.round(performance.now() - start);
			responseDuration = duration;

			const text = await res.text();
			if (res.ok) {
				try { const parsed = JSON.parse(text); response = JSON.stringify(parsed, null, 2); responseStatus = parsed.error ? 'error' : 'success'; }
				catch { response = text; responseStatus = 'success'; }
			} else { response = text; responseStatus = 'error'; }

			history = [{ id: ++historyCounter, endpoint: selectedEndpoint.name, method, params: paramsJson, status: responseStatus ?? 'error', response: response ?? '', duration, timestamp: new Date() }, ...history].slice(0, 50);
		} catch (e: unknown) {
			const duration = Math.round(performance.now() - start);
			responseDuration = duration;
			response = e instanceof Error ? e.message : 'Request failed';
			responseStatus = 'error';
			history = [{ id: ++historyCounter, endpoint: selectedEndpoint.name, method, params: paramsJson, status: 'error', response: response ?? '', duration, timestamp: new Date() }, ...history].slice(0, 50);
		}
		sending = false;
	}

	function loadFromHistory(entry: CallHistoryEntry) { method = entry.method; paramsJson = entry.params; response = entry.response; responseStatus = entry.status; responseDuration = entry.duration; }
</script>

<div>
	<div class="mb-6">
		<h2 class="text-2xl font-bold tracking-tight">Inspector</h2>
		<p class="text-sm text-muted-foreground">Test MCP tool calls against your endpoints</p>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4"><AlertCircle class="size-4" /><AlertDescription>{error} <Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button></AlertDescription></Alert>
	{/if}

	{#if loading}
		<div class="space-y-4">
			<Card.Root><Card.Content class="p-6"><Skeleton class="h-32 w-full" /></Card.Content></Card.Root>
			<Card.Root><Card.Content class="p-6"><Skeleton class="h-48 w-full" /></Card.Content></Card.Root>
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2 space-y-4">
				<Card.Root>
					<Card.Header class="pb-3"><Card.Title class="text-sm">Endpoint</Card.Title></Card.Header>
					<Card.Content class="space-y-3">
						<select
							onchange={(e) => { const ep = endpoints.find(ep => ep.id === (e.target as HTMLSelectElement).value); selectedEndpoint = ep ?? null; }}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<option value="">Select an endpoint...</option>
							{#each endpoints as ep}
								<option value={ep.id} selected={selectedEndpoint?.id === ep.id}>{ep.name} ({ep.transport}) {ep.authType !== 'none' ? '- auth: ' + ep.authType : ''}</option>
							{/each}
						</select>
						{#if selectedEndpoint?.authType !== 'none' && selectedEndpoint}
							<div class="space-y-2">
								<Label for="insp-key">API Key / Bearer Token</Label>
								<Input id="insp-key" bind:value={apiKey} type="password" placeholder="mcp_..." class="font-mono" />
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header class="pb-3"><Card.Title class="text-sm">Request</Card.Title></Card.Header>
					<Card.Content class="space-y-3">
						<div>
							<Label class="mb-2 block">Method</Label>
							<div class="flex gap-1 flex-wrap">
								{#each methods as m}
									<Button variant={method === m.value ? 'default' : 'outline'} size="sm" onclick={() => selectMethod(m.value)}>{m.label}</Button>
								{/each}
							</div>
						</div>
						<div class="space-y-2">
							<Label for="insp-params">Parameters (JSON)</Label>
							<textarea bind:value={paramsJson} id="insp-params" rows="6" spellcheck="false" class="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"></textarea>
						</div>
						<Button onclick={sendRequest} disabled={!selectedEndpoint || sending}>
							<Send class="size-4 mr-2" />{sending ? 'Sending...' : 'Send Request'}
						</Button>
					</Card.Content>
				</Card.Root>

				{#if response !== null}
					<Card.Root>
						<Card.Header class="pb-2">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<Card.Title class="text-sm">Response</Card.Title>
									<Badge variant={responseStatus === 'success' ? 'default' : 'destructive'}>{responseStatus}</Badge>
								</div>
								<span class="text-xs text-muted-foreground font-mono">{responseDuration}ms</span>
							</div>
						</Card.Header>
						<Card.Content>
							<pre class="text-sm font-mono overflow-auto max-h-96 bg-muted/50 rounded-md p-4">{response}</pre>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>

			<div>
				<p class="text-xs font-semibold text-muted-foreground uppercase mb-2">Request History</p>
				{#if history.length === 0}
					<Card.Root>
						<Card.Content class="p-4">
							<p class="text-sm text-muted-foreground">No requests yet. Send a request to see history.</p>
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="space-y-1.5 max-h-[calc(100vh-200px)] overflow-auto">
						{#each history as entry}
							<Card.Root class="cursor-pointer hover:border-muted-foreground/50 transition-colors" onclick={() => loadFromHistory(entry)}>
								<Card.Content class="p-3">
									<div class="flex items-center justify-between mb-1">
										<span class="font-mono text-xs">{entry.method}</span>
										<span class="flex items-center gap-1.5">
											<span class="size-1.5 rounded-full {entry.status === 'success' ? 'bg-success' : 'bg-destructive'}"></span>
											<span class="text-xs text-muted-foreground">{entry.duration}ms</span>
										</span>
									</div>
									<div class="text-xs text-muted-foreground truncate">{entry.endpoint}</div>
								</Card.Content>
							</Card.Root>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
