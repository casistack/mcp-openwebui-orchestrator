<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { ModeWatcher, toggleMode, mode as modeState } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import {
		LayoutDashboard, HeartPulse, Server, Layers, Globe,
		Search, Lightbulb, KeyRound, ClipboardList, Settings,
		Sun, Moon, Command
	} from '@lucide/svelte';

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
				{ href: '/audit', label: 'Audit Log', icon: ClipboardList },
			],
		},
		{
			label: 'System',
			items: [
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
