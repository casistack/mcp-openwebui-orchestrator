<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ModeWatcher, toggleMode, mode as modeState } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import {
		LayoutDashboard, HeartPulse, Server, Layers, Globe,
		Search, Lightbulb, KeyRound, ClipboardList, Settings,
		Sun, Moon, Command, Store, Plus, Filter, Shield, Lock,
		FolderOpen, BarChart3, Activity
	} from '@lucide/svelte';

	let authChecked = $state(false);
	let authenticated = $state(false);

	onMount(async () => {
		if (page.url.pathname === '/login') {
			authChecked = true;
			return;
		}
		try {
			const res = await fetch('/api/auth/get-session', { credentials: 'include' });
			if (res.ok) {
				const data = await res.json();
				if (data?.session) {
					authenticated = true;
					authChecked = true;
					return;
				}
			}
		} catch {
			// Session check failed
		}
		authChecked = true;
		goto('/login');
	});

	const navSections = [
		{
			label: 'Overview',
			items: [
				{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
				{ href: '/health', label: 'Health', icon: HeartPulse },
			],
		},
		{
			label: 'Infrastructure',
			items: [
				{ href: '/servers', label: 'Servers', icon: Server },
				{ href: '/namespaces', label: 'Namespaces', icon: Layers },
				{ href: '/endpoints', label: 'Endpoints', icon: Globe },
			{ href: '/middleware', label: 'Middleware', icon: Filter },
			],
		},
		{
			label: 'Marketplace',
			items: [
				{ href: '/marketplace', label: 'Browse', icon: Store },
				{ href: '/marketplace/publish', label: 'Publish', icon: Plus },
				{ href: '/marketplace/collections', label: 'Collections', icon: FolderOpen },
				{ href: '/marketplace/analytics', label: 'Analytics', icon: BarChart3 },
			],
		},
		{
			label: 'Tools',
			items: [
				{ href: '/explorer', label: 'Explorer', icon: Search },
				{ href: '/inspector', label: 'Inspector', icon: Lightbulb },
			],
		},
		{
			label: 'Security',
			items: [
				{ href: '/api-keys', label: 'API Keys', icon: KeyRound },
				{ href: '/tool-permissions', label: 'Tool Permissions', icon: Shield },
			{ href: '/oauth-tokens', label: 'OAuth Tokens', icon: Lock },
			{ href: '/audit', label: 'Audit Log', icon: ClipboardList },
			],
		},
		{
			label: 'System',
			items: [
				{ href: '/system', label: 'Metrics', icon: Activity },
				{ href: '/settings', label: 'Settings', icon: Settings },
			],
		},
	];

	let { children } = $props();

	let isLoginPage = $derived(page.url.pathname === '/login');

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path.startsWith(href);
	}
</script>

<ModeWatcher defaultMode="dark" />
<Toaster />

{#if isLoginPage}
	{@render children()}
{:else if !authChecked}
	<div class="flex items-center justify-center h-screen">
		<div class="animate-pulse text-muted-foreground text-sm">Loading...</div>
	</div>
{:else if !authenticated}
	<div class="flex items-center justify-center h-screen">
		<div class="text-muted-foreground text-sm">Redirecting to login...</div>
	</div>
{:else}
	<Sidebar.SidebarProvider>
		<Sidebar.Sidebar collapsible="icon" variant="sidebar">
			<Sidebar.SidebarHeader>
				<Sidebar.SidebarMenu>
					<Sidebar.SidebarMenuItem>
						<Sidebar.SidebarMenuButton size="lg" class="pointer-events-none">
							<div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
								<Command class="size-4" />
							</div>
							<div class="grid flex-1 text-left text-sm leading-tight">
								<span class="truncate font-semibold">MCP Platform</span>
								<span class="truncate text-xs text-muted-foreground">Enterprise</span>
							</div>
						</Sidebar.SidebarMenuButton>
					</Sidebar.SidebarMenuItem>
				</Sidebar.SidebarMenu>
			</Sidebar.SidebarHeader>

			<Sidebar.SidebarContent>
				{#each navSections as section}
					<Sidebar.SidebarGroup>
						<Sidebar.SidebarGroupLabel>{section.label}</Sidebar.SidebarGroupLabel>
						<Sidebar.SidebarGroupContent>
							<Sidebar.SidebarMenu>
								{#each section.items as item}
									{@const active = isActive(item.href)}
									<Sidebar.SidebarMenuItem>
										<Sidebar.SidebarMenuButton
											isActive={active}
											tooltipContent={item.label}
										>
											{#snippet child({ props })}
												<a href={item.href} {...props}>
													<item.icon class="size-4" />
													<span>{item.label}</span>
												</a>
											{/snippet}
										</Sidebar.SidebarMenuButton>
									</Sidebar.SidebarMenuItem>
								{/each}
							</Sidebar.SidebarMenu>
						</Sidebar.SidebarGroupContent>
					</Sidebar.SidebarGroup>
				{/each}
			</Sidebar.SidebarContent>

			<Sidebar.SidebarFooter>
				<Sidebar.SidebarMenu>
					<Sidebar.SidebarMenuItem>
						<Sidebar.SidebarMenuButton onclick={toggleMode} tooltipContent="Toggle theme">
							{#if modeState.current === 'light'}
								<Moon class="size-4" />
								<span>Dark mode</span>
							{:else}
								<Sun class="size-4" />
								<span>Light mode</span>
							{/if}
						</Sidebar.SidebarMenuButton>
					</Sidebar.SidebarMenuItem>
				</Sidebar.SidebarMenu>
				<div class="px-2 pb-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">v0.1.0</div>
			</Sidebar.SidebarFooter>

			<Sidebar.SidebarRail />
		</Sidebar.Sidebar>

		<Sidebar.SidebarInset>
			<header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<Sidebar.SidebarTrigger class="-ml-1" />
				<Separator orientation="vertical" class="mr-2 !h-4" />
				<span class="text-sm font-medium text-muted-foreground truncate">
					{page.url.pathname === '/' ? 'Dashboard' : page.url.pathname.slice(1).split('/')[0].replace(/-/g, ' ').replace(/^\w/, (c: string) => c.toUpperCase())}
				</span>
			</header>
			<main class="flex-1 overflow-auto p-6">
				{@render children()}
			</main>
		</Sidebar.SidebarInset>
	</Sidebar.SidebarProvider>
{/if}
