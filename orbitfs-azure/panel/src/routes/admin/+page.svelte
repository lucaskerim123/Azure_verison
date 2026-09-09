<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, FileKey, KeyRound, ScrollText, Settings, Shield, Users, UsersRound, Boxes } from '@lucide/svelte';
	let data = $state<any>(null);
	let error = $state('');
	onMount(async () => {
		const response = await fetch('/api/admin', { cache: 'no-store' });
		const payload = await response.json();
		if (!response.ok) error = payload.error || 'Could not load administration'; else data = payload;
	});
	const cards = [
		{ href: '/admin/users', label: 'Users', description: 'Accounts, roles and status', icon: Users },
		{ href: '/admin/usergroups', label: 'User groups', description: 'Group membership', icon: UsersRound },
		{ href: '/admin/workspaces', label: 'Workspace members', description: 'Workspace access and roles', icon: Boxes },
		{ href: '/admin/file-permissions', label: 'File permissions', description: 'Path-level access rules', icon: FileKey },
		{ href: '/admin/audit-log', label: 'Audit log', description: 'Base System activity history', icon: ScrollText },
		{ href: '/admin/config', label: 'Settings', description: 'Global Base System settings', icon: Settings },
		{ href: '/admin/license', label: 'License', description: 'License state and metadata', icon: KeyRound },
		{ href: '/admin/messages', label: 'Notifications', description: 'Send system messages', icon: Bell }
	];
</script>
<div class="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
	<header><div class="flex items-center gap-2 text-primary"><Shield class="size-5" /><p class="text-xs font-semibold uppercase tracking-[0.16em]">Administration</p></div><h1 class="mt-1 text-2xl font-semibold tracking-tight">Base System administration</h1><p class="mt-1 text-sm text-muted-foreground">Manage users, permissions, workspaces, settings and system records.</p></header>
	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>{/if}
	<div class="grid gap-3 sm:grid-cols-3"><div class="rounded-xl border bg-card p-4"><p class="text-xs text-muted-foreground">Users</p><p class="mt-1 text-2xl font-semibold">{data?.users?.length ?? '—'}</p></div><div class="rounded-xl border bg-card p-4"><p class="text-xs text-muted-foreground">Groups</p><p class="mt-1 text-2xl font-semibold">{data?.groups?.length ?? '—'}</p></div><div class="rounded-xl border bg-card p-4"><p class="text-xs text-muted-foreground">Workspaces</p><p class="mt-1 text-2xl font-semibold">{data?.workspaces?.length ?? '—'}</p></div></div>
	<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{#each cards as card}<a href={card.href} class="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/30"><card.icon class="size-5 text-primary" /><h2 class="mt-3 font-semibold">{card.label}</h2><p class="mt-1 text-sm text-muted-foreground">{card.description}</p></a>{/each}</div>
</div>
