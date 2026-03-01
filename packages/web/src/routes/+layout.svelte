<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	const navSections = [
		{
			label: 'Overview',
			items: [
				{ href: '/', label: 'Dashboard', icon: 'dashboard' },
				{ href: '/health', label: 'Health', icon: 'health' },
			],
		},
		{
			label: 'Infrastructure',
			items: [
				{ href: '/servers', label: 'Servers', icon: 'server' },
				{ href: '/namespaces', label: 'Namespaces', icon: 'namespace' },
				{ href: '/endpoints', label: 'Endpoints', icon: 'endpoint' },
			],
		},
		{
			label: 'Tools',
			items: [
				{ href: '/explorer', label: 'Explorer', icon: 'explorer' },
				{ href: '/inspector', label: 'Inspector', icon: 'inspector' },
			],
		},
		{
			label: 'Security',
			items: [
				{ href: '/api-keys', label: 'API Keys', icon: 'key' },
				{ href: '/audit', label: 'Audit Log', icon: 'audit' },
			],
		},
		{
			label: 'System',
			items: [
				{ href: '/settings', label: 'Settings', icon: 'settings' },
			],
		},
	];

	let { children } = $props();
	let sidebarOpen = $state(true);
	let darkMode = $state(true);
	let mobileMenuOpen = $state(false);

	onMount(() => {
		const saved = localStorage.getItem('mcp-dark-mode');
		darkMode = saved !== 'false';
		applyTheme();
	});

	function toggleDarkMode() {
		darkMode = !darkMode;
		localStorage.setItem('mcp-dark-mode', String(darkMode));
		applyTheme();
	}

	function applyTheme() {
		document.documentElement.classList.toggle('light', !darkMode);
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path.startsWith(href);
	}

	const iconPaths: Record<string, string> = {
		dashboard: 'M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5zm0 6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5zM4 13a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2z',
		health: 'M3.172 5.172a4 4 0 0 1 5.656 0L10 6.343l1.172-1.171a4 4 0 1 1 5.656 5.656L10 17.657l-6.828-6.829a4 4 0 0 1 0-5.656z',
		server: 'M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm14 1a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM2 13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2zm14 1a1 1 0 1 0-2 0 1 1 0 0 0 2 0z',
		namespace: 'M7 3a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H7zM4 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1H4V7zM2 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4z',
		endpoint: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM4.332 8.027a6.012 6.012 0 0 1 1.912-2.706C6.512 5.73 6.974 7 7.632 8H4.332zM15.668 8h-3.3c.658-1 1.12-2.27 1.388-2.679a6.012 6.012 0 0 1 1.912 2.706z',
		explorer: 'M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 8a6 6 0 1 1 10.89 3.476l4.817 4.817a1 1 0 0 1-1.414 1.414l-4.816-4.816A6 6 0 0 1 2 8z',
		inspector: 'M11 3a1 1 0 1 0-2 0v1a1 1 0 1 0 2 0V3zm4.657.757a1 1 0 0 0-1.414-1.414l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707zM18 10a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zM5.05 6.464A1 1 0 1 0 6.464 5.05l-.707-.707a1 1 0 0 0-1.414 1.414l.707.707zM5 10a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zm3 6v-1h4v1a2 2 0 1 1-4 0zm4-2c.015-.34.208-.646.477-.859a4 4 0 1 0-4.954 0c.27.213.462.519.477.859h4z',
		key: 'M18 8a6 6 0 0 1-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1 1 18 8zm-6-4a1 1 0 1 0 0 2 2 2 0 0 1 2 2 1 1 0 1 0 2 0 4 4 0 0 0-4-4z',
		audit: 'M9 2a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2H9zM4 5a2 2 0 0 1 2-2 3 3 0 0 0 3 3h2a3 3 0 0 0 3-3 2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm5 3a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2H9zm0 4a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H9z',
		settings: 'M11.49 3.17a1.43 1.43 0 0 1 2.78.36l.13 1.28a1.07 1.07 0 0 0 1.17.92l1.28-.13a1.43 1.43 0 0 1 1.18 2.35l-.93.89a1.07 1.07 0 0 0 .04 1.49l.93.89a1.43 1.43 0 0 1-1.18 2.35l-1.28-.13a1.07 1.07 0 0 0-1.17.92l-.13 1.28a1.43 1.43 0 0 1-2.78.36l-.49-1.18a1.07 1.07 0 0 0-1.25-.6l-1.18.49a1.43 1.43 0 0 1-1.95-1.64l.36-1.24a1.07 1.07 0 0 0-.59-1.27L5.2 10.8a1.43 1.43 0 0 1 .36-2.78l1.28-.13a1.07 1.07 0 0 0 .92-1.17L7.63 5.44a1.43 1.43 0 0 1 2.35-1.18l.89.93a1.07 1.07 0 0 0 1.49-.04z M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
	};
</script>

<div class="flex h-screen">
	<!-- Mobile overlay -->
	{#if mobileMenuOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div class="fixed inset-0 bg-black/50 z-40 lg:hidden" onclick={() => mobileMenuOpen = false}></div>
	{/if}

	<!-- Sidebar -->
	<nav
		class="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-all duration-200 z-50
			{sidebarOpen ? 'w-60' : 'w-16'}
			max-lg:fixed max-lg:inset-y-0 max-lg:left-0
			{mobileMenuOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}
			lg:relative lg:translate-x-0"
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-3 border-b border-[var(--color-border)]">
			{#if sidebarOpen}
				<div class="min-w-0">
					<h1 class="text-base font-bold truncate">MCP Platform</h1>
				</div>
			{/if}
			<button onclick={toggleSidebar} class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors flex-shrink-0" title="Toggle sidebar">
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
					{#if sidebarOpen}
						<path fill-rule="evenodd" d="M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z" clip-rule="evenodd" />
					{:else}
						<path fill-rule="evenodd" d="M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z" clip-rule="evenodd" />
					{/if}
				</svg>
			</button>
		</div>

		<!-- Nav sections -->
		<div class="flex-1 overflow-y-auto py-2">
			{#each navSections as section}
				{#if sidebarOpen}
					<div class="px-3 pt-3 pb-1">
						<span class="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{section.label}</span>
					</div>
				{:else}
					<div class="pt-3 pb-1 flex justify-center">
						<span class="w-5 border-t border-[var(--color-border)]"></span>
					</div>
				{/if}
				{#each section.items as item}
					{@const active = isActive(item.href)}
					<a
						href={item.href}
						class="flex items-center gap-3 mx-2 px-2 py-2 rounded-md text-sm transition-colors
							{active
								? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium'
								: 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/50'}"
						title={sidebarOpen ? undefined : item.label}
						onclick={() => mobileMenuOpen = false}
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 flex-shrink-0">
							<path d={iconPaths[item.icon] ?? iconPaths.dashboard} />
						</svg>
						{#if sidebarOpen}
							<span>{item.label}</span>
						{/if}
					</a>
				{/each}
			{/each}
		</div>

		<!-- Footer -->
		<div class="border-t border-[var(--color-border)] p-2">
			<button
				onclick={toggleDarkMode}
				class="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/50 transition-colors"
				title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 flex-shrink-0">
					{#if darkMode}
						<path fill-rule="evenodd" d="M10 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm4 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm-.464 4.95l.707.707a1 1 0 0 0 1.414-1.414l-.707-.707a1 1 0 0 0-1.414 1.414zm2.12-10.607a1 1 0 0 1 0 1.414l-.706.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zM17 11a1 1 0 1 0 0-2h-1a1 1 0 1 0 0 2h1zm-7 4a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zM5.05 6.464A1 1 0 1 0 6.465 5.05l-.708-.707a1 1 0 0 0-1.414 1.414l.707.707zM5 11a1 1 0 1 0 0-2H4a1 1 0 0 0 0 2h1z" clip-rule="evenodd" />
					{:else}
						<path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586z" />
					{/if}
				</svg>
				{#if sidebarOpen}
					<span>{darkMode ? 'Light mode' : 'Dark mode'}</span>
				{/if}
			</button>
			{#if sidebarOpen}
				<div class="px-2 py-1 text-[10px] text-[var(--color-text-muted)]">v0.1.0</div>
			{/if}
		</div>
	</nav>

	<!-- Main -->
	<div class="flex-1 flex flex-col min-w-0">
		<!-- Mobile header -->
		<div class="lg:hidden flex items-center gap-3 p-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
			<button onclick={() => mobileMenuOpen = true} class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Open menu">
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
					<path fill-rule="evenodd" d="M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z" clip-rule="evenodd" />
				</svg>
			</button>
			<span class="font-bold">MCP Platform</span>
		</div>

		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
