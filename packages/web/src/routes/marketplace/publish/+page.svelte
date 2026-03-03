<script lang="ts">
	import { goto } from '$app/navigation';
	import { trpc } from '$lib/trpc';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { AlertCircle, ArrowLeft } from '@lucide/svelte';

	const categories = [
		{ id: 'data-knowledge', label: 'Data & Knowledge' },
		{ id: 'web-search', label: 'Web & Search' },
		{ id: 'code-dev-tools', label: 'Code & Dev Tools' },
		{ id: 'ai-ml', label: 'AI & ML' },
		{ id: 'productivity', label: 'Productivity' },
		{ id: 'communication', label: 'Communication' },
		{ id: 'media', label: 'Media' },
		{ id: 'system-infrastructure', label: 'System & Infrastructure' },
	];

	let error = $state<string | null>(null);
	let submitting = $state(false);
	let form = $state({
		name: '',
		slug: '',
		shortDescription: '',
		description: '',
		category: 'code-dev-tools',
		tags: '',
		transport: 'stdio' as 'stdio' | 'sse' | 'streamable-http',
		command: '',
		args: '',
		url: '',
		proxyType: 'mcpo',
		needsProxy: true,
		version: '1.0.0',
	});

	function generateSlug() {
		form.slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	async function handleSubmit() {
		error = null;
		submitting = true;
		try {
			const config: Record<string, unknown> = { proxyType: form.proxyType, needsProxy: form.needsProxy };
			if (form.transport === 'stdio') {
				config.command = form.command;
				if (form.args.trim()) config.args = form.args.split(' ');
			} else {
				config.url = form.url;
			}

			const result = await trpc.marketplace.create.mutate({
				name: form.name,
				slug: form.slug,
				shortDescription: form.shortDescription || undefined,
				description: form.description || undefined,
				category: form.category,
				tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
				transport: form.transport,
				config,
				version: form.version,
			});

			goto(`/marketplace/${(result as { slug: string }).slug}`);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to publish listing';
		}
		submitting = false;
	}
</script>

<div class="max-w-2xl mx-auto">
	<a href="/marketplace" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
		<ArrowLeft class="size-4" /> Back to Marketplace
	</a>

	<h2 class="text-2xl font-bold tracking-tight mb-2">Publish to Marketplace</h2>
	<p class="text-sm text-muted-foreground mb-6">Share your MCP server with the community</p>

	{#if error}
		<Alert variant="destructive" class="mb-4">
			<AlertCircle class="size-4" />
			<AlertDescription>{error}
				<Button variant="link" class="ml-2 h-auto p-0 text-destructive" onclick={() => error = null}>dismiss</Button>
			</AlertDescription>
		</Alert>
	{/if}

	<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
		<Card.Root>
			<Card.Content class="p-6 space-y-4">
				<h3 class="font-semibold">Basic Information</h3>

				<div class="space-y-2">
					<Label for="name">Server Name</Label>
					<Input id="name" bind:value={form.name} required oninput={generateSlug} placeholder="My MCP Server" />
				</div>

				<div class="space-y-2">
					<Label for="slug">URL Slug</Label>
					<Input id="slug" bind:value={form.slug} required placeholder="my-mcp-server" />
					<p class="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only</p>
				</div>

				<div class="space-y-2">
					<Label for="short-desc">Short Description</Label>
					<Input id="short-desc" bind:value={form.shortDescription} placeholder="One-line summary of what this server does" />
				</div>

				<div class="space-y-2">
					<Label for="description">Full Description</Label>
					<textarea
						id="description"
						bind:value={form.description}
						placeholder="Detailed description, usage examples, etc."
						rows={6}
						class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					></textarea>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="category">Category</Label>
						<select bind:value={form.category} id="category" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
							{#each categories as cat}
								<option value={cat.id}>{cat.label}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<Label for="version">Version</Label>
						<Input id="version" bind:value={form.version} placeholder="1.0.0" />
					</div>
				</div>

				<div class="space-y-2">
					<Label for="tags">Tags (comma-separated)</Label>
					<Input id="tags" bind:value={form.tags} placeholder="memory, vector-db, knowledge-graph" />
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Content class="p-6 space-y-4">
				<h3 class="font-semibold">Server Configuration</h3>

				<div class="space-y-2">
					<Label for="transport">Transport</Label>
					<select bind:value={form.transport} id="transport" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
						<option value="stdio">stdio</option>
						<option value="sse">SSE</option>
						<option value="streamable-http">Streamable HTTP</option>
					</select>
				</div>

				{#if form.transport === 'stdio'}
					<div class="space-y-2">
						<Label for="command">Command</Label>
						<Input id="command" bind:value={form.command} placeholder="npx -y @modelcontextprotocol/server-memory" />
					</div>
					<div class="space-y-2">
						<Label for="args">Arguments (space-separated)</Label>
						<Input id="args" bind:value={form.args} placeholder="--flag value" />
					</div>
				{:else}
					<div class="space-y-2">
						<Label for="url">URL</Label>
						<Input id="url" bind:value={form.url} placeholder="http://localhost:8080/sse" />
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="proxy-type">Proxy Type</Label>
						<select bind:value={form.proxyType} id="proxy-type" class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
							<option value="mcpo">MCPO</option>
							<option value="mcp-bridge">MCP Bridge</option>
						</select>
					</div>
					<div class="flex items-end gap-3 pb-1">
						<Switch bind:checked={form.needsProxy} id="needs-proxy" />
						<Label for="needs-proxy">Needs proxy</Label>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<div class="flex justify-end gap-3">
			<a href="/marketplace"><Button variant="outline" type="button">Cancel</Button></a>
			<Button type="submit" disabled={submitting}>
				{submitting ? 'Publishing...' : 'Publish Server'}
			</Button>
		</div>
	</form>
</div>
