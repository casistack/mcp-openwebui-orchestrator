<script lang="ts">
	import '../app.css';

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'grid' },
		{ href: '/servers', label: 'Servers', icon: 'server' },
		{ href: '/namespaces', label: 'Namespaces', icon: 'layers' },
		{ href: '/endpoints', label: 'Endpoints', icon: 'globe' },
		{ href: '/api-keys', label: 'API Keys', icon: 'key' },
		{ href: '/health', label: 'Health', icon: 'heart' },
		{ href: '/audit', label: 'Audit Log', icon: 'clipboard' },
		{ href: '/settings', label: 'Settings', icon: 'settings' },
	];

	let { children } = $props();
</script>

<div class="flex h-screen">
	<!-- Sidebar -->
	<nav class="w-60 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col">
		<div class="p-4 border-b border-[var(--color-border)]">
			<h1 class="text-lg font-bold text-white">MCP Platform</h1>
			<p class="text-xs text-[var(--color-text-muted)]">Server Management</p>
		</div>

		<ul class="flex-1 py-2">
			{#each navItems as item}
				<li>
					<a
						href={item.href}
						class="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-border)] transition-colors"
					>
						<span class="w-5 text-center">{item.icon.charAt(0).toUpperCase()}</span>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>

		<div class="p-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
			v0.1.0
		</div>
	</nav>

	<!-- Main content -->
	<main class="flex-1 overflow-auto p-6">
		{@render children()}
	</main>
</div>
