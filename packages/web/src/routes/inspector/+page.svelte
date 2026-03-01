<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';

	interface Endpoint {
		id: string;
		name: string;
		slug: string;
		transport: string;
		namespaceId: string;
		isActive: boolean;
		authType: string | null;
	}

	interface CallHistoryEntry {
		id: number;
		endpoint: string;
		method: string;
		params: string;
		status: 'success' | 'error';
		response: string;
		duration: number;
		timestamp: Date;
	}

	let endpoints = $state<Endpoint[]>([]);
	let selectedEndpoint = $state<Endpoint | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Request form
	let method = $state('tools/list');
	let paramsJson = $state('{}');
	let apiKey = $state('');
	let sending = $state(false);

	// Response
	let response = $state<string | null>(null);
	let responseStatus = $state<'success' | 'error' | null>(null);
	let responseDuration = $state(0);

	// History
	let history = $state<CallHistoryEntry[]>([]);
	let historyCounter = 0;

	const methods = [
		{ value: 'initialize', label: 'initialize', defaultParams: '{}' },
		{ value: 'tools/list', label: 'tools/list', defaultParams: '{}' },
		{ value: 'tools/call', label: 'tools/call', defaultParams: '{"name": "tool_name", "arguments": {}}' },
		{ value: 'ping', label: 'ping', defaultParams: '{}' },
	];

	async function load() {
		try {
			const result = await trpc.endpoints.list.query();
			endpoints = (result as unknown as Endpoint[]).filter(e => e.isActive);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load endpoints';
		}
		loading = false;
	}

	onMount(load);

	function selectMethod(m: string) {
		method = m;
		const preset = methods.find(p => p.value === m);
		if (preset) paramsJson = preset.defaultParams;
	}

	async function sendRequest() {
		if (!selectedEndpoint) return;

		let params: Record<string, unknown>;
		try {
			params = JSON.parse(paramsJson);
		} catch {
			error = 'Invalid JSON in parameters';
			return;
		}

		sending = true;
		error = null;
		response = null;
		responseStatus = null;

		const start = performance.now();
		const slug = selectedEndpoint.slug;
		const transport = selectedEndpoint.transport;

		try {
			let url: string;
			let fetchOpts: RequestInit;

			if (transport === 'streamable-http') {
				url = `/mcp/${slug}/mcp`;
			} else {
				// For SSE endpoints, use the messages endpoint (requires session)
				// Fall back to streamable-http style call for inspector
				url = `/mcp/${slug}/mcp`;
			}

			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (apiKey.trim()) {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}

			fetchOpts = {
				method: 'POST',
				headers,
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: Date.now(),
					method,
					params,
				}),
			};

			const res = await fetch(url, fetchOpts);
			const duration = Math.round(performance.now() - start);
			responseDuration = duration;

			const text = await res.text();
			if (res.ok) {
				try {
					const parsed = JSON.parse(text);
					response = JSON.stringify(parsed, null, 2);
					responseStatus = parsed.error ? 'error' : 'success';
				} catch {
					response = text;
					responseStatus = 'success';
				}
			} else {
				response = text;
				responseStatus = 'error';
			}

			// Add to history
			history = [{
				id: ++historyCounter,
				endpoint: selectedEndpoint.name,
				method,
				params: paramsJson,
				status: responseStatus ?? 'error',
				response: response ?? '',
				duration,
				timestamp: new Date(),
			}, ...history].slice(0, 50);

		} catch (e: unknown) {
			const duration = Math.round(performance.now() - start);
			responseDuration = duration;
			response = e instanceof Error ? e.message : 'Request failed';
			responseStatus = 'error';

			history = [{
				id: ++historyCounter,
				endpoint: selectedEndpoint.name,
				method,
				params: paramsJson,
				status: 'error',
				response: response ?? '',
				duration,
				timestamp: new Date(),
			}, ...history].slice(0, 50);
		}

		sending = false;
	}

	function loadFromHistory(entry: CallHistoryEntry) {
		method = entry.method;
		paramsJson = entry.params;
		response = entry.response;
		responseStatus = entry.status;
		responseDuration = entry.duration;
	}
</script>

<div>
	<div class="mb-6">
		<h2 class="text-2xl font-bold">Inspector</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">Test MCP tool calls against your endpoints</p>
	</div>

	{#if error}
		<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)]">
			{error}
			<button onclick={() => error = null} class="ml-2 underline">dismiss</button>
		</div>
	{/if}

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading endpoints...</p>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: Request builder -->
			<div class="lg:col-span-2 space-y-4">
				<!-- Endpoint selector -->
				<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
					<label class="block mb-3">
						<span class="text-xs text-[var(--color-text-muted)] uppercase font-semibold">Endpoint</span>
						<select
							onchange={(e) => {
								const ep = endpoints.find(ep => ep.id === (e.target as HTMLSelectElement).value);
								selectedEndpoint = ep ?? null;
							}}
							class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
						>
							<option value="">Select an endpoint...</option>
							{#each endpoints as ep}
								<option value={ep.id} selected={selectedEndpoint?.id === ep.id}>
									{ep.name} ({ep.transport}) {ep.authType !== 'none' ? '- auth: ' + ep.authType : ''}
								</option>
							{/each}
						</select>
					</label>

					{#if selectedEndpoint?.authType !== 'none' && selectedEndpoint}
						<label class="block">
							<span class="text-xs text-[var(--color-text-muted)] uppercase font-semibold">API Key / Bearer Token</span>
							<input
								bind:value={apiKey}
								type="password"
								placeholder="mcp_..."
								class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-primary)]"
							/>
						</label>
					{/if}
				</div>

				<!-- Method + Params -->
				<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
					<div class="flex items-center gap-2 mb-3">
						<span class="text-xs text-[var(--color-text-muted)] uppercase font-semibold">Method</span>
						<div class="flex gap-1 flex-wrap">
							{#each methods as m}
								<button
									onclick={() => selectMethod(m.value)}
									class="px-2.5 py-1 text-xs rounded-md transition-colors border"
									class:bg-[var(--color-primary)]={method === m.value}
									class:border-[var(--color-primary)]={method === m.value}
									class:text-white={method === m.value}
									class:bg-transparent={method !== m.value}
									class:border-[var(--color-border)]={method !== m.value}
									class:text-[var(--color-text-muted)]={method !== m.value}
									class:hover:border-[var(--color-text-muted)]={method !== m.value}
								>{m.label}</button>
							{/each}
						</div>
					</div>

					<label class="block mb-3">
						<span class="text-xs text-[var(--color-text-muted)] uppercase font-semibold">Parameters (JSON)</span>
						<textarea
							bind:value={paramsJson}
							rows="6"
							class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-primary)] resize-y"
							spellcheck="false"
						></textarea>
					</label>

					<button
						onclick={sendRequest}
						disabled={!selectedEndpoint || sending}
						class="bg-[var(--color-primary)] text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{sending ? 'Sending...' : 'Send Request'}
					</button>
				</div>

				<!-- Response -->
				{#if response !== null}
					<div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
						<div class="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
							<div class="flex items-center gap-2">
								<span class="text-xs font-semibold text-[var(--color-text-muted)] uppercase">Response</span>
								<span class="w-2 h-2 rounded-full"
									class:bg-[var(--color-success)]={responseStatus === 'success'}
									class:bg-[var(--color-error)]={responseStatus === 'error'}
								></span>
								<span class="text-xs"
									class:text-[var(--color-success)]={responseStatus === 'success'}
									class:text-[var(--color-error)]={responseStatus === 'error'}
								>{responseStatus}</span>
							</div>
							<span class="text-xs text-[var(--color-text-muted)]">{responseDuration}ms</span>
						</div>
						<pre class="p-4 text-sm font-mono overflow-auto max-h-96 text-[var(--color-text)]">{response}</pre>
					</div>
				{/if}
			</div>

			<!-- Right: History -->
			<div>
				<h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2">Request History</h3>
				{#if history.length === 0}
					<div class="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-border)]">
						<p class="text-sm text-[var(--color-text-muted)]">No requests yet. Send a request to see history.</p>
					</div>
				{:else}
					<div class="space-y-1.5 max-h-[calc(100vh-200px)] overflow-auto">
						{#each history as entry}
							<button
								onclick={() => loadFromHistory(entry)}
								class="w-full text-left bg-[var(--color-surface)] rounded-lg p-3 border border-[var(--color-border)] hover:border-[var(--color-text-muted)] transition-colors"
							>
								<div class="flex items-center justify-between mb-1">
									<span class="font-mono text-xs">{entry.method}</span>
									<span class="flex items-center gap-1.5">
										<span class="w-1.5 h-1.5 rounded-full"
											class:bg-[var(--color-success)]={entry.status === 'success'}
											class:bg-[var(--color-error)]={entry.status === 'error'}
										></span>
										<span class="text-xs text-[var(--color-text-muted)]">{entry.duration}ms</span>
									</span>
								</div>
								<div class="text-xs text-[var(--color-text-muted)] truncate">{entry.endpoint}</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
