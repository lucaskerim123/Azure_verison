<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import {
		Folder,
		Sparkles,
		Building2,
		Bell,
		Settings,
		Shield,
		KeyRound,
		Server,
		HardDrive,
		Menu,
		Search,
		LogOut,
		LoaderCircle,
		Puzzle,
		CircleUser,
		FileLock,
		Plug,
		ListTree,
		ScrollText,
		ChevronDown,
		ContactRound,
		Library,
		Users,
		Download
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { api } from '$lib/api';
	import { addons } from '$lib/addons.svelte';
	import { search } from '$lib/search.svelte';
	import WorkspaceSelector from '$lib/workspace-selector.svelte';
	import { workspace } from '$lib/workspace.svelte';

	let { children } = $props();

	const ADDON_ICONS: Record<string, typeof Folder> = {
		Folder,
		Building2,
		ContactRound,
		Sparkles,
		Plug,
		Settings,
		Puzzle,
		Server,
		Users,
		CircleUser,
		ScrollText
	};
	const iconFor = (name?: string) => ADDON_ICONS[name ?? ''] ?? Puzzle;
	const addonPrimaryNav = $derived(
		addons.addons
			.filter((addon) => addon.installed && addon.attached && addon.licensed)
			.flatMap((addon) => addon.frontend?.primaryNavigation ?? [])
			.map((item) => ({ ...item, icon: iconFor(item.icon) }))
	);
	const primaryNav = $derived([
		{ label: 'Library', href: '/library', icon: Library },
		{ label: 'Workspace Manager', href: '/workspaces', icon: Building2 },
		...addonPrimaryNav
	]);

	const coreAdminGroups = [
		{
			label: 'Systems',
			icon: Server,
			items: [
				{ label: 'Service status', href: '/admin/system/service-status', icon: Server },
				{ label: 'Licensing system', href: '/admin/license', icon: KeyRound },
				{ label: 'Message system', href: '/admin/messages', icon: Bell },
				{ label: 'Logs', href: '/admin/system/logs', icon: ScrollText }
			]
		},
		{
			label: 'Configuration',
			icon: Settings,
			items: [
				{ label: 'Runtime & services', href: '/admin/config', icon: Settings },
				{ label: 'Add-on management', href: '/admin/addons', icon: Puzzle },
				{ label: 'Knowledge settings', href: '/library/settings', icon: Library }
			]
		},
		{
			label: 'Administration',
			icon: Shield,
			items: [
				{ label: 'User management', href: '/admin/users', icon: Shield },
				{ label: 'Audit logs', href: '/admin/audit-log', icon: ScrollText }
			]
		}

	];
	const studioGroup = {
		label: 'Studio',
		icon: ScrollText,
		items: [
			{ label: 'Entries', href: '/studio', icon: ScrollText },
			{ label: 'Analysis', href: '/studio/analysis', icon: Sparkles },
			{ label: 'Settings', href: '/admin/studio/settings', icon: Settings, roles: ['owner', 'admin'] },
			{ label: 'Advanced', href: '/admin/studio/advanced', icon: Server, roles: ['owner', 'admin'] }
		]
	};
	const pluginNavigationGroups = $derived(
		addons.navigationGroups().map((group) => ({ ...group, icon: iconFor(group.icon), items: group.items.map((item) => ({ ...item, icon: iconFor(item.icon) })) }))
	);
	const pluginAdminGroups = $derived(
		addons.adminGroups().map((group) => ({ ...group, icon: iconFor(group.icon), items: group.items.map((item) => ({ ...item, icon: iconFor(item.icon) })) }))
	);
	function mergeAdminGroups(...collections: any[][]) {
		const merged = new Map<string, any>();
		for (const groups of collections) for (const group of groups) {
			const current = merged.get(group.label);
			if (!current) { merged.set(group.label, { ...group, items: [...group.items] }); continue; }
			const items = new Map(current.items.map((item: any) => [item.href, item]));
			for (const item of group.items) items.set(item.href, item);
			current.items = [...items.values()];
		}
		return [...merged.values()];
	}
	const adminGroups = $derived((() => {
		const allPluginGroups = [...pluginNavigationGroups, ...pluginAdminGroups];
		const apexGroups = allPluginGroups.filter((group) => group.label === 'Apex System');
		const mcpGroups = allPluginGroups.filter((group) => group.label === 'MCP' || group.label === 'MCP Admin');
		const otherPluginGroups = allPluginGroups.filter((group) => !['Apex System', 'MCP', 'MCP Admin'].includes(group.label));
		return mergeAdminGroups([studioGroup], apexGroups, mcpGroups, coreAdminGroups, otherPluginGroups);
	})());

	let mobileNavOpen = $state(false);
	let expandedGroups = $state<Record<string, boolean>>({});
	type Notice = {
		id: string;
		title: string;
		message: string;
		severity: 'info' | 'warning' | 'critical' | 'system';
		createdAt: string;
		createdBy: string;
		read: boolean;
	};
	let unreadNotifications = $state(0);
	let notificationOpen = $state(false);
	let notificationLoading = $state(false);
	let notificationError = $state('');
	let notifications = $state<Notice[]>([]);
	let canAccessWorkspaceMcp = $state(false);
	let mcpAccessWorkspaces = $state<Array<{ mcpAllowed?: boolean; management_permissions?: Record<string, boolean> }>>([]);
	let workspaceMode = $state(false);
	let apexAccessMode = $state<'admins_only' | 'workspace_owners' | 'workspace_permissions'>('workspace_owners');
	let workspaceAccessWorkspaces = $state<Array<{ permission?: string; management_permissions?: Record<string, boolean> }>>([]);
	let bootstrappedToken = $state<string | null>(null);

	async function loadWorkspaceAddonAccess() {
		try {
			const data = await api.get<{ settings?: { workspaceModeEnabled?: boolean; apexAccessMode?: 'admins_only' | 'workspace_owners' | 'workspace_permissions' }; workspaces: Array<{ permission?: string; management_permissions?: Record<string, boolean> }> }>('/workspaces');
			workspaceMode = true;
			apexAccessMode = data.settings?.apexAccessMode ?? 'workspace_owners';
			workspaceAccessWorkspaces = data.workspaces ?? [];
		} catch {
			workspaceMode = true;
			apexAccessMode = 'workspace_owners';
			workspaceAccessWorkspaces = [];
		}
		try {
			const access = await api.get<{ mcpWorkspaces?: Array<{ mcpAllowed?: boolean; management_permissions?: Record<string, boolean> }> }>('/mcp/access');
			mcpAccessWorkspaces = access.mcpWorkspaces ?? [];
			canAccessWorkspaceMcp = auth.isAdmin || mcpAccessWorkspaces.length > 0;
		} catch {
			mcpAccessWorkspaces = [];
			canAccessWorkspaceMcp = auth.isAdmin;
		}
	}

	async function loadNotificationCount() {
		try {
			unreadNotifications = (await api.get<{ unread: number }>('/notifications')).unread;
		} catch {
			unreadNotifications = 0;
		}
	}

	async function loadNotificationsPanel() {
		notificationLoading = true;
		notificationError = '';
		try {
			const data = await api.get<{ notifications: Notice[]; unread: number }>('/notifications');
			notifications = data.notifications ?? [];
			unreadNotifications = data.unread ?? notifications.filter((n) => !n.read).length;
		} catch (error) {
			notificationError = error instanceof Error ? error.message : 'Failed to load notifications';
		} finally {
			notificationLoading = false;
		}
	}

	async function toggleNotifications() {
		notificationOpen = !notificationOpen;
		if (notificationOpen) await loadNotificationsPanel();
	}

	async function markNotificationRead(notice: Notice) {
		if (notice.read) return;
		await api.post('/notifications/' + notice.id + '/read');
		notice.read = true;
		notifications = [...notifications];
		unreadNotifications = notifications.filter((n) => !n.read).length;
	}

	async function redirectIfLicenceInvalid(refresh = false) {
		if (!auth.isAuthenticated || !auth.isAdmin || page.url.pathname.startsWith('/admin/license'))
			return;
		try {
			const summary = await api.get<{
				enforcement?: boolean;
				reason?: string;
				components?: Record<string, { allowed?: boolean; reason?: string | null }>;
			}>(`/license/status${refresh ? '?refresh=1' : ''}`);
			const panel = summary.components?.orbitfs_base;
			if (summary.enforcement !== false && panel?.allowed !== true) {
				goto(
					`/admin/license?reason=${encodeURIComponent(panel?.reason ?? summary.reason ?? 'panel_invalid')}`
				);
			}
		} catch {
			// Normal API error handling will catch restricted pages.
		}
	}

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		if (href === '/workspaces') return page.url.pathname === '/workspaces';
		return page.url.pathname.startsWith(href);
	}

	function requiredAddon(pathname: string) {
		return addons.routeOwner(pathname);
	}

	function canAccessItem(group: { label: string; roles?: string[] }, item: { permission?: string; roles?: string[] }) {
		if (item.roles?.length && (!auth.user?.role || !item.roles.includes(auth.user.role))) return false;
		if (auth.isAdmin) return true;
		if (group.label === 'MCP' || group.label === 'MCP Admin') {
			if (!item.permission || item.permission === 'mcp_use') return canAccessWorkspaceMcp;
			return mcpAccessWorkspaces.some((workspace) => workspace.mcpAllowed && workspace.management_permissions?.[item.permission!] === true);
		}
		if (group.label === 'Apex System') {
			if (apexAccessMode === 'admins_only') return false;
			if (!item.permission) return workspaceAccessWorkspaces.some((workspace) => workspace.permission === 'owner');
			if (apexAccessMode === 'workspace_owners') {
				return workspaceAccessWorkspaces.some((workspace) => workspace.permission === 'owner' && workspace.management_permissions?.[item.permission!] === true);
			}
			return workspaceAccessWorkspaces.some((workspace) => workspace.management_permissions?.[item.permission!] === true);
		}
		if (item.permission) return workspaceAccessWorkspaces.some((workspace) => workspace.management_permissions?.[item.permission!] === true);
		return workspaceAccessWorkspaces.length > 0;
	}

	function canAccessGroup(group: { label: string; roles?: string[]; items: Array<{ permission?: string; roles?: string[] }> }) {
		if (group.roles?.length && (!auth.user?.role || !group.roles.includes(auth.user.role))) return false;
		return group.items.some((item) => canAccessItem(group, item));
	}

	function groupIsActive(group: { items: Array<{ href: string }> }) {
		return group.items.some((item) => isActive(item.href));
	}

	function groupOpen(group: { label: string; items: Array<{ href: string }> }) {
		return expandedGroups[group.label] ?? groupIsActive(group);
	}

	function toggleGroup(label: string, active: boolean) {
		expandedGroups = { ...expandedGroups, [label]: !(expandedGroups[label] ?? active) };
	}

	const isLoginRoute = $derived(page.url.pathname === '/login');
	const isSetupRoute = $derived(page.url.pathname.startsWith('/setup'));
	const isRegisterRoute = $derived(page.url.pathname.startsWith('/register'));
	const isLicenseRoute = $derived(page.url.pathname === '/license');
	const isPublicRoute = $derived(isLoginRoute || isSetupRoute || isRegisterRoute || isLicenseRoute);
	const isFilesRoute = $derived(false);
	const showWorkspaceSelector = $derived(workspace.enabled && (page.url.pathname.startsWith('/workspaces') || page.url.pathname.startsWith('/library') || page.url.pathname.startsWith('/profiles') || page.url.pathname.startsWith('/studio') || page.url.pathname.startsWith('/sorter-converter')));

	// Search is Files-scoped, but the box lives in the shared header - reset it whenever
	// the user navigates away so it doesn't silently keep filtering a page it can't affect.
	$effect(() => {
		if (!isFilesRoute) search.query = '';
	});

	$effect(() => {
		if (!auth.ready) return;
		if (!auth.isAuthenticated && !isPublicRoute) {
			goto('/login');
		} else if (auth.isAuthenticated && isLoginRoute) {
			goto('/');
		}
	});

	$effect(() => {
		if (!auth.isAuthenticated || !addons.loaded) return;
		const required = requiredAddon(page.url.pathname);
		if (required && !addons.attached(required)) goto(auth.isAdmin ? '/admin/addons' : '/');
	});

	onMount(() => {
		auth.init();
	});

	$effect(() => {
		const token = auth.token;
		if (!token) {
			bootstrappedToken = null;
			return;
		}
		if (bootstrappedToken === token) return;
		bootstrappedToken = token;

		addons.load().then(() => {
			void loadWorkspaceAddonAccess();
		});
		workspace.load();
		loadNotificationCount();
		redirectIfLicenceInvalid(false);
	});

	// Addon/licence state can change out from under this tab - another admin session
	// detaching add-ons, or a licence lapsing server-side - with nothing pushing us an
	// update. Re-check when the tab regains focus (fast path for "I just changed it
	// elsewhere") and on a slow interval as a backstop. addons.load() is safe to call from
	// here: this isn't inside an $effect, so there's no risk of the reactive feedback loop
	// that hit the Files page fetch earlier.
	onMount(() => {
		function resync() {
			if (!auth.isAuthenticated) return;
			addons.load().then(() => {
				void loadWorkspaceAddonAccess();
			});
			if (page.url.pathname.startsWith('/workspaces') || page.url.pathname.startsWith('/library') || page.url.pathname.startsWith('/studio') || page.url.pathname.startsWith('/sorter-converter')) void workspace.load();
			void loadNotificationCount();
			void redirectIfLicenceInvalid(true);
		}
		function onVisible() {
			if (document.visibilityState === 'visible') resync();
		}
		const interval = setInterval(resync, 300_000);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const initials = $derived((auth.user?.username ?? '?').slice(0, 2).toUpperCase());

	async function logout() {
		try {
			await api.post('/logout');
		} catch {
			// ignore - clearing local state regardless
		}
		auth.clear();
		goto('/login');
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if !auth.ready}
	<div class="flex h-dvh items-center justify-center bg-background text-muted-foreground">
		<LoaderCircle class="size-6 animate-spin" />
	</div>
{:else if isPublicRoute || !auth.isAuthenticated}
	{@render children()}
{:else}
	<div class="flex h-dvh w-dvw overflow-hidden bg-background text-foreground">
		<!-- Desktop sidebar -->
		<aside
			class="hidden w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex xl:w-56"
		>
			<div class="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
				<div class="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
					<HardDrive class="size-4" />
				</div>
				<span class="font-semibold tracking-tight">OrbitFS</span>
			</div>

			<nav class="flex-1 space-y-3 overflow-y-auto p-2">
				<div class="space-y-0.5">
					{#each primaryNav as item (item.href)}
						<a
							href={item.href}
							class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors {isActive(
								item.href
							)
								? 'bg-sidebar-accent text-sidebar-accent-foreground'
								: 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}"
						>
							<item.icon class="size-4" />
							{item.label}
						</a>
					{/each}
				</div>

				{#each adminGroups as group (group.label)}
					{#if canAccessGroup(group)}
						<div class="space-y-0.5">
							<button
								type="button"
								class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors {groupIsActive(
									group
								)
									? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
									: 'text-sidebar-foreground hover:bg-sidebar-accent/60'}"
								onclick={() => toggleGroup(group.label, groupIsActive(group))}
								aria-expanded={groupOpen(group)}
							>
								<group.icon class="size-4" />
								<span class="flex-1 text-left">{group.label}</span>
								<ChevronDown
									class="size-4 transition-transform {groupOpen(group) ? 'rotate-180' : ''}"
								/>
							</button>
							{#if groupOpen(group)}
								<div class="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
									{#each group.items as item (item.href)}
										{#if canAccessItem(group, item)}
											<a
												href={item.href}
												class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors {isActive(
													item.href
												)
													? 'bg-sidebar-accent text-sidebar-accent-foreground'
													: 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}"
											>
												<item.icon class="size-4" />
												{item.label}
											</a>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</nav>

			<div class="space-y-0.5 border-t border-sidebar-border p-3">
				<a
					href="/account"
					class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors {isActive(
						'/account'
					)
						? 'bg-sidebar-accent text-sidebar-accent-foreground'
						: 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}"
				>
					<CircleUser class="size-4" />
					User control panel
				</a>
				<button
					class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
					onclick={logout}
				>
					<LogOut class="size-4" />
					Sign out
				</button>
			</div>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Top bar -->
			<header
				class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/30 px-2.5 md:px-4"
			>
				<button
					class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
					onclick={() => (mobileNavOpen = !mobileNavOpen)}
					aria-label="Toggle menu"
				>
					<Menu class="size-5" />
				</button>

				{#if showWorkspaceSelector}
					<WorkspaceSelector />
				{/if}

				{#if isFilesRoute}
					<div class="relative hidden max-w-sm flex-1 md:block">
						<Search
							class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							type="search"
							placeholder="Search files..."
							bind:value={search.query}
							class="h-9 w-full rounded-md border border-input bg-transparent py-1 pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
						/>
					</div>
				{/if}

				<div class="ml-auto flex items-center gap-1.5">
					<button
						type="button"
						class="relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						aria-label="Notifications"
						aria-expanded={notificationOpen}
						onclick={toggleNotifications}
					>
						<Bell class="size-4.5" />
						{#if unreadNotifications > 0}
							<span
								class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-destructive-foreground"
								>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span
							>
						{/if}
					</button>
					<div
						class="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
						title={auth.user?.username}
					>
						{initials}
					</div>
				</div>
			</header>
			{#if notificationOpen}
				<button
					class="fixed inset-0 z-40 bg-transparent"
					aria-label="Close notifications"
					onclick={() => (notificationOpen = false)}
				></button>
				<section
					class="fixed top-16 right-2 left-2 z-50 max-h-[calc(100dvh-5rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl md:right-5 md:left-auto md:w-96"
				>
					<div class="flex items-center justify-between border-b p-3">
						<strong>Notifications</strong><button
							type="button"
							class="rounded-md border px-2 py-1 text-xs"
							onclick={() => (notificationOpen = false)}>Close</button
						>
					</div>
					<div class="max-h-[calc(100dvh-9rem)] space-y-2 overflow-y-auto p-3">
						{#if notificationLoading}<p class="py-8 text-center text-sm text-muted-foreground">
								Loading notifications...
							</p>
						{:else if notificationError}<p
								class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
							>
								{notificationError}
							</p>
						{:else if notifications.length === 0}<p
								class="py-8 text-center text-sm text-muted-foreground"
							>
								No notifications.
							</p>
						{:else}{#each notifications as notice (notice.id)}
								<article
									class="rounded-lg border p-3 text-sm {notice.read
										? 'bg-card'
										: 'border-primary/50 bg-primary/5'}"
								>
									<div class="flex justify-between gap-2">
										<strong>{notice.title}</strong><span class="text-xs text-muted-foreground"
											>{notice.severity}</span
										>
									</div>
									<p class="mt-1 whitespace-pre-wrap text-muted-foreground">{notice.message}</p>
									{#if !notice.read}<button
											type="button"
											class="mt-2 rounded-md border px-2 py-1 text-xs"
											onclick={() => markNotificationRead(notice)}>Mark read</button
										>{/if}
								</article>
							{/each}{/if}
					</div>
				</section>
			{/if}

			<main class="flex-1 overflow-y-auto pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
				{@render children()}
			</main>
		</div>
	</div>

	{#if mobileNavOpen}
		<button
			class="fixed inset-0 z-30 bg-black/60 md:hidden"
			aria-label="Close menu"
			onclick={() => (mobileNavOpen = false)}
		></button>
		<aside
			class="fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-[320px] flex-col border-r border-sidebar-border bg-sidebar p-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sidebar-foreground shadow-2xl md:hidden"
		>
			<div class="mb-3 flex h-12 items-center justify-between border-b border-sidebar-border px-2">
				<span class="font-semibold">OrbitFS menu</span>
				<button
					class="rounded-md px-3 py-2 text-xl leading-none text-muted-foreground hover:bg-sidebar-accent"
					onclick={() => (mobileNavOpen = false)}
					aria-label="Close menu">X</button
				>
			</div>
			<nav class="flex-1 space-y-1 overflow-y-auto">
				{#each primaryNav as item (item.href)}
					<a
						href={item.href}
						onclick={() => (mobileNavOpen = false)}
						class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-semibold {isActive(
							item.href
						)
							? 'bg-sidebar-accent text-sidebar-accent-foreground'
							: 'text-sidebar-foreground hover:bg-sidebar-accent/60'}"
						><item.icon class="size-4" />{item.label}</a
					>
				{/each}
				{#each adminGroups as group (group.label)}
					{#if canAccessGroup(group)}
						<div class="space-y-0.5">
							<button
								type="button"
								class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-semibold {groupIsActive(
									group
								)
									? 'bg-sidebar-accent/70'
									: 'hover:bg-sidebar-accent/60'}"
								onclick={() => toggleGroup(group.label, groupIsActive(group))}
								><group.icon class="size-4" /><span class="flex-1 text-left">{group.label}</span
								><ChevronDown
									class="size-4 transition-transform {groupOpen(group) ? 'rotate-180' : ''}"
								/></button
							>
							{#if groupOpen(group)}<div
									class="ml-4 space-y-0.5 border-l border-sidebar-border pl-2"
								>
									{#each group.items as item (item.href)}{#if canAccessItem(group, item)}<a
												href={item.href}
												onclick={() => (mobileNavOpen = false)}
												class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm {isActive(
													item.href
												)
													? 'bg-sidebar-accent text-sidebar-accent-foreground'
													: 'text-muted-foreground hover:bg-sidebar-accent/60'}"
												><item.icon class="size-4" />{item.label}</a
											>{/if}{/each}
								</div>{/if}
						</div>
					{/if}
				{/each}
			</nav>
		</aside>
	{/if}

	<!-- Mobile bottom nav -->
	<nav
		class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-sidebar-border bg-sidebar/98 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.35)] md:hidden"
	>
		{#each primaryNav as item (item.href)}
			<a
				href={item.href}
				class="flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium leading-tight {isActive(
					item.href
				)
					? 'text-primary'
					: 'text-muted-foreground'}"
			>
				<item.icon class="size-5 shrink-0" />
				<span class="max-w-full truncate text-center">{item.label === 'Workspace Manager' ? 'Workspaces' : item.label}</span>
			</a>
		{/each}
		<button
			type="button"
			onclick={() => (mobileNavOpen = true)}
			class="flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium leading-tight {mobileNavOpen ||
			page.url.pathname.startsWith('/admin')
				? 'text-primary'
				: 'text-muted-foreground'}"
		>
			<Menu class="size-5 shrink-0" />
			<span>More</span>
		</button>
	</nav>
{/if}
