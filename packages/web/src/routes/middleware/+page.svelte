<script lang="ts">
	import { onMount } from 'svelte';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Separator } from '$lib/components/ui/separator';
	import { Filter, Plus, Trash2, GripVertical, AlertCircle, Pencil } from '@lucide/svelte';

	const STEP_TYPES = [
		{ id: 'request-logger', label: 'Request Logger', description: 'Log all incoming requests to audit log' },
		{ id: 'tool-call-logger', label: 'Tool Call Logger', description: 'Log tool calls with argument metadata' },
		{ id: 'rate-limiter', label: 'Rate Limiter', description: 'Limit request rate per user, tool, or namespace' },
		{ id: 'content-filter', label: 'Content Filter', description: 'Block requests matching regex patterns' },
		{ id: 'request-transform', label: 'Request Transform', description: 'Modify headers or body fields' },
		{ id: 'response-transform', label: 'Response Transform', description: 'Transform response data' },
		{ id: 'header-injector', label: 'Header Injector', description: 'Inject headers into proxied requests' },
	] as const;

	interface Namespace { id: string; name: string; slug: string; }
	interface Step { id: string; name: string; type: string; config: Record<string, unknown>; enabled: boolean; order: number; }

	let namespaces = $state<Namespace[]>([]);
	let selectedNamespace = $state<string>('');
	let steps = $state<Step[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAddDialog = $state(false);
	let showEditDialog = $state(false);
	let editingStep = $state<Step | null>(null);
	let addForm = $state({
		name: '',
		type: 'request-logger' as string,
		configJson: '{}',
		enabled: true,
	});

	onMount(async () => {
		try {
			const ns = await trpc.namespaces.list.query();
			namespaces = ns as Namespace[];
			if (namespaces.length > 0) {
				selectedNamespace = namespaces[0].id;
				await loadSteps();
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('Not authenticated') || msg.includes('UNAUTHORIZED')) {
				window.location.href = '/login';
				return;
			}
			error = 'Failed to load namespaces';
		}
		loading = false;
	});

	async function loadSteps() {
		if (!selectedNamespace) return;
		try {
			const result = await trpc.middleware.listSteps.query({ namespaceId: selectedNamespace });
			steps = result as Step[];
		} catch {
			steps = [];
		}
	}

	async function handleNamespaceChange() {
		await loadSteps();
	}

	async function handleAddStep() {
		error = null;
		try {
			let config = {};
			try { config = JSON.parse(addForm.configJson); } catch { error = 'Invalid JSON in config'; return; }

			await trpc.middleware.createStep.mutate({
				namespaceId: selectedNamespace,
				name: addForm.name,
				type: addForm.type as any,
				config,
				enabled: addForm.enabled,
			});
			showAddDialog = false;
			addForm = { name: '', type: 'request-logger', configJson: '{}', enabled: true };
			await loadSteps();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to add step';
		}
	}

	async function handleUpdateStep() {
		if (!editingStep) return;
		error = null;
		try {
			let config = {};
			try { config = JSON.parse(addForm.configJson); } catch { error = 'Invalid JSON in config'; return; }

			await trpc.middleware.updateStep.mutate({
				stepId: editingStep.id,
				name: addForm.name,
				type: addForm.type as any,
				config,
				enabled: addForm.enabled,
			});
			showEditDialog = false;
			editingStep = null;
			await loadSteps();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to update step';
		}
	}

	async function handleDeleteStep(stepId: string) {
		try {
			await trpc.middleware.deleteStep.mutate({ stepId });
			await loadSteps();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to delete step';
		}
	}

	async function handleToggleEnabled(step: Step) {
		try {
			await trpc.middleware.updateStep.mutate({
				stepId: step.id,
				enabled: !step.enabled,
			});
			await loadSteps();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to toggle step';
		}
	}

	async function moveStep(stepId: string, direction: 'up' | 'down') {
		const idx = steps.findIndex(s => s.id === stepId);
		if (idx === -1) return;
		const newIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (newIdx < 0 || newIdx >= steps.length) return;

		const ids = steps.map(s => s.id);
		[ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];

		try {
			await trpc.middleware.reorderSteps.mutate({
				namespaceId: selectedNamespace,
				stepIds: ids,
			});
			await loadSteps();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to reorder';
		}
	}

	function openEditDialog(step: Step) {
		editingStep = step;
		addForm = {
			name: step.name,
			type: step.type,
			configJson: JSON.stringify(step.config, null, 2),
			enabled: step.enabled,
		};
		showEditDialog = true;
	}

	function stepTypeLabel(type: string): string {
		return STEP_TYPES.find(t => t.id === type)?.label ?? type;
	}

	function stepTypeVariant(type: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		if (type === 'rate-limiter' || type === 'content-filter') return 'destructive';
		if (type === 'request-logger' || type === 'tool-call-logger') return 'secondary';
		return 'outline';
	}

	function configSummary(step: Step): string {
		const c = step.config;
		switch (step.type) {
			case 'rate-limiter':
				return `${c.maxRequests ?? 100} req / ${((c.windowMs as number) ?? 60000) / 1000}s (by ${c.keyBy ?? 'user'})`;
			case 'content-filter':
				return `${((c.blockedPatterns as string[]) ?? []).length} patterns`;
			case 'header-injector':
				return `${Object.keys((c.headers as Record<string, string>) ?? {}).length} headers`;
			case 'request-transform':
				return `${((c.transforms as unknown[]) ?? []).length} transforms`;
			default:
				return '';
		}
	}
</script>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h2 class="text-2xl font-bold tracking-tight">Middleware Pipeline</h2>
			<p class="text-sm text-muted-foreground">Configure request processing steps per namespace</p>
		</div>
	</div>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}
				<Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	{#if loading}
		<Card.Root><Card.Content class="p-6"><Skeleton class="h-40 w-full" /></Card.Content></Card.Root>
	{:else if namespaces.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
				<Filter class="size-10 text-muted-foreground mb-3" />
				<p class="text-sm text-muted-foreground">No namespaces found. Create a namespace first to configure middleware.</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="flex items-center gap-4 mb-6">
			<div class="space-y-1">
				<Label for="ns-select">Namespace</Label>
				<select
					id="ns-select"
					bind:value={selectedNamespace}
					onchange={handleNamespaceChange}
					class="flex h-9 w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{#each namespaces as ns}
						<option value={ns.id}>{ns.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex-1"></div>
			<Button size="sm" onclick={() => { addForm = { name: '', type: 'request-logger', configJson: '{}', enabled: true }; showAddDialog = true; }}>
				<Plus class="size-4 mr-1" /> Add Step
			</Button>
		</div>

		{#if steps.length === 0}
			<Card.Root>
				<Card.Content class="flex flex-col items-center justify-center py-10 text-center">
					<Filter class="size-10 text-muted-foreground mb-3" />
					<p class="text-sm text-muted-foreground mb-3">No pipeline steps configured for this namespace.</p>
					<Button size="sm" onclick={() => showAddDialog = true}>
						<Plus class="size-4 mr-1" /> Add First Step
					</Button>
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="space-y-3">
				{#each steps as step, idx}
					<Card.Root class={!step.enabled ? 'opacity-50' : ''}>
						<Card.Content class="p-4 flex items-center gap-4">
							<div class="flex flex-col gap-1">
								<button
									class="text-muted-foreground hover:text-foreground disabled:opacity-30"
									disabled={idx === 0}
									onclick={() => moveStep(step.id, 'up')}
								>
									<GripVertical class="size-4 rotate-180" />
								</button>
								<button
									class="text-muted-foreground hover:text-foreground disabled:opacity-30"
									disabled={idx === steps.length - 1}
									onclick={() => moveStep(step.id, 'down')}
								>
									<GripVertical class="size-4" />
								</button>
							</div>

							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<span class="font-medium text-sm">{step.name}</span>
									<Badge variant={stepTypeVariant(step.type)} class="text-xs">{stepTypeLabel(step.type)}</Badge>
									{#if !step.enabled}
										<Badge variant="outline" class="text-xs">Disabled</Badge>
									{/if}
								</div>
								{#if configSummary(step)}
									<p class="text-xs text-muted-foreground font-mono">{configSummary(step)}</p>
								{/if}
							</div>

							<div class="flex items-center gap-2">
								<Switch
									checked={step.enabled}
									onCheckedChange={() => handleToggleEnabled(step)}
								/>
								<Button variant="ghost" size="icon" onclick={() => openEditDialog(step)}>
									<Pencil class="size-4" />
								</Button>
								<Button variant="ghost" size="icon" onclick={() => handleDeleteStep(step.id)}>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</div>
						</Card.Content>
					</Card.Root>
				{/each}
			</div>

			<p class="text-xs text-muted-foreground mt-4">
				Steps execute top-to-bottom. Rate limiters and content filters can block requests before they reach the MCP server.
			</p>
		{/if}
	{/if}
</div>

<!-- Add Step Dialog -->
<Dialog.Root bind:open={showAddDialog}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Add Pipeline Step</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleAddStep(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="step-name">Name</Label>
				<Input id="step-name" bind:value={addForm.name} required placeholder="e.g. Rate limit API calls" />
			</div>

			<div class="space-y-2">
				<Label for="step-type">Type</Label>
				<select bind:value={addForm.type} id="step-type" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					{#each STEP_TYPES as st}
						<option value={st.id}>{st.label} - {st.description}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-2">
				<Label for="step-config">Configuration (JSON)</Label>
				<textarea
					id="step-config"
					bind:value={addForm.configJson}
					rows={6}
					class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					placeholder={addForm.type === 'rate-limiter'
						? '{\n  "maxRequests": 100,\n  "windowMs": 60000,\n  "keyBy": "user"\n}'
						: addForm.type === 'content-filter'
						? '{\n  "blockedPatterns": ["password", "secret"]\n}'
						: addForm.type === 'header-injector'
						? '{\n  "headers": {\n    "X-Custom": "value"\n  }\n}'
						: '{}'}
				></textarea>
			</div>

			<div class="flex items-center gap-3">
				<Switch bind:checked={addForm.enabled} id="step-enabled" />
				<Label for="step-enabled">Enabled</Label>
			</div>

			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showAddDialog = false}>Cancel</Button>
				<Button type="submit">Add Step</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Edit Step Dialog -->
<Dialog.Root bind:open={showEditDialog}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit Pipeline Step</Dialog.Title>
		</Dialog.Header>
		<form onsubmit={(e) => { e.preventDefault(); handleUpdateStep(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="edit-name">Name</Label>
				<Input id="edit-name" bind:value={addForm.name} required />
			</div>

			<div class="space-y-2">
				<Label for="edit-type">Type</Label>
				<select bind:value={addForm.type} id="edit-type" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
					{#each STEP_TYPES as st}
						<option value={st.id}>{st.label}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-2">
				<Label for="edit-config">Configuration (JSON)</Label>
				<textarea
					id="edit-config"
					bind:value={addForm.configJson}
					rows={6}
					class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				></textarea>
			</div>

			<div class="flex items-center gap-3">
				<Switch bind:checked={addForm.enabled} id="edit-enabled" />
				<Label for="edit-enabled">Enabled</Label>
			</div>

			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => showEditDialog = false}>Cancel</Button>
				<Button type="submit">Save Changes</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
