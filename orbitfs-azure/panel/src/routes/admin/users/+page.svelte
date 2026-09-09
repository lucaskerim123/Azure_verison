<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { Card, CardContent, Badge, Button, Input } from '$lib/components/ui';
	import { Users, Plus, Pencil, LoaderCircle, X, Ban, ShieldCheck, ChevronDown, ChevronUp, FolderOpen, FileText, Monitor, Network } from '@lucide/svelte';

	type UserPermissions = Record<string, boolean>;
	type WorkspaceRole = { workspaceId: string; workspaceName: string; role: string; files: number };
	type PanelUser = {
		username: string; role: 'owner' | 'admin' | 'user'; status: 'active' | 'inactive' | 'banned';
		email: string | null; protected?: boolean; banReason?: string; permissions: UserPermissions;
		workspaceRoles: WorkspaceRole[]; workspaceCount: number; ownedWorkspaces: number; fileCount: number;
		activeSessions: number; lastIp: string; lastUserAgent: string; lastLoginAt: string | null; loginCount: number;
	};
	type RegistrationMode = 'off' | 'open' | 'approval_queue';
	type RegistrationRequest = { id: string; username: string; email: string | null; status: string; requestedAt: string };
	type RegistrationSettings = {
		mode: RegistrationMode;
		modes: RegistrationMode[];
		defaultPermissions: UserPermissions;
		pendingRequests: RegistrationRequest[];
	};

	let permissionLabels = $state<Record<string, string>>({
		create_workspaces:'Create workspaces', access_public_workspace:'Access public workspace', invite_workspace_members:'Invite workspace members', share_files:'Share files'
	});

	let users = $state<PanelUser[]>([]);
	let capabilities = $state<string[]>([]);
	let permissionDefaults = $state<UserPermissions>({});
	let loading = $state(true);
	let error = $state('');
	let expanded = $state<string | null>(null);
	let formOpen = $state(false);
	let editingUsername = $state<string | null>(null);
	let formUsername = $state('');
	let formPin = $state('');
	let formRole = $state<'owner' | 'admin' | 'user'>('user');
	let formEmail = $state('');
	let formStatus = $state<'active' | 'inactive' | 'banned'>('active');
	let formBanReason = $state('');
	let formPermissions = $state<UserPermissions>({ create_workspaces: true, access_public_workspace: true, invite_workspace_members: true, share_files: true, mcp_use: true, mcp_manage_startup: false, mcp_manage_preset_names: false, mcp_manage_projects: false, mcp_manage_settings: false });
	let formError = $state('');
	let saving = $state(false);
	let banTarget = $state<PanelUser | null>(null);
	let banReason = $state('');
	let banBusy = $state<string | null>(null);
	let registrationMode = $state<RegistrationMode>('off');
	let registrationPermissions = $state<UserPermissions>({});
	let registrationRequests = $state<RegistrationRequest[]>([]);
	let registrationBusy = $state(false);
	let registrationRequestBusy = $state<string | null>(null);
	let registrationError = $state('');
	let registrationSaved = $state('');

	const bannedUsers = $derived(users.filter((user) => user.status === 'banned'));

	async function load() {
		loading = true;
		error = '';
		registrationError = '';
		registrationSaved = '';
		try {
			const [result, registration] = await Promise.all([
				api.get<{ users: PanelUser[]; capabilities: string[]; capabilityLabels?: Record<string,string>; permissionDefaults: UserPermissions }>('/users'),
				api.get<RegistrationSettings>('/registration/settings')
			]);
			users = result.users;
			capabilities = result.capabilities || [];
			permissionLabels = { create_workspaces:'Create workspaces', access_public_workspace:'Access public workspace', invite_workspace_members:'Invite workspace members', share_files:'Share files', ...(result.capabilityLabels || {}) };
			permissionDefaults = result.permissionDefaults || registration.defaultPermissions || {};
			registrationMode = registration.mode;
			registrationPermissions = { ...(registration.defaultPermissions || permissionDefaults) };
			registrationRequests = registration.pendingRequests || [];
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load users';
		} finally {
			loading = false;
		}
	}

	async function saveRegistrationSettings() {
		registrationBusy = true;
		registrationError = '';
		registrationSaved = '';
		try {
			const saved = await api.patch<RegistrationSettings>('/registration/settings', {
				mode: registrationMode,
				defaultPermissions: registrationPermissions
			});
			registrationMode = saved.mode;
			registrationPermissions = { ...saved.defaultPermissions };
			permissionDefaults = { ...saved.defaultPermissions };
			registrationRequests = saved.pendingRequests || [];
			registrationSaved = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
		} catch (err) {
			registrationError = err instanceof ApiError ? err.message : 'Registration settings save failed';
		} finally {
			registrationBusy = false;
		}
	}

	async function resolveRegistrationRequest(requestId: string, action: 'approve' | 'reject') {
		registrationRequestBusy = requestId;
		registrationError = '';
		try {
			await api.post(`/registration/requests/${encodeURIComponent(requestId)}/${action}`);
			await load();
		} catch (err) {
			registrationError = err instanceof ApiError ? err.message : `${action === 'approve' ? 'Approval' : 'Rejection'} failed`;
		} finally {
			registrationRequestBusy = null;
		}
	}

	load();

	function openCreate() {
		editingUsername = null;
		formUsername = '';
		formPin = '';
		formRole = 'user';
		formEmail = '';
		formStatus = 'active';
		formBanReason = '';
		formPermissions = { ...permissionDefaults };
		formError = '';
		formOpen = true;
	}

	function openEdit(user: PanelUser) {
		editingUsername = user.username;
		formUsername = user.username;
		formPin = '';
		formRole = user.role === 'owner' ? 'admin' : user.role;
		formEmail = user.email ?? '';
		formStatus = user.status;
		formBanReason = user.banReason ?? '';
		formPermissions = { ...user.permissions };
		formError = '';
		formOpen = true;
	}

	async function saveUser(event: Event) {
		event.preventDefault();
		formError = '';
		if (!formUsername.trim()) return void (formError = 'Username is required');
		if (!editingUsername && !/^\d{4,10}$/.test(formPin)) return void (formError = 'PIN must be 4-10 digits');
		if (editingUsername && formPin && !/^\d{4,10}$/.test(formPin)) return void (formError = 'New PIN must be 4-10 digits');
		saving = true;
		try {
			await api.post('/users', {
				username: formUsername.trim(), pin: formPin, role: formRole, email: formEmail.trim() || null,
				status: formStatus, banReason: formBanReason.trim(), permissions: formPermissions
			});
			formOpen = false;
			await load();
		} catch (err) {
			formError = err instanceof ApiError ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function banUser() {
		if (!banTarget || !banReason.trim()) return;
		banBusy = banTarget.username;
		try {
			await api.post(`/users/${encodeURIComponent(banTarget.username)}/ban`, { reason: banReason.trim() });
			banTarget = null;
			banReason = '';
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Ban failed';
		} finally {
			banBusy = null;
		}
	}

	async function unbanUser(username: string) {
		banBusy = username;
		try {
			await api.post(`/users/${encodeURIComponent(username)}/unban`);
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Unban failed';
		} finally {
			banBusy = null;
		}
	}

	function formatDate(value: string | null) {
		return value ? new Date(value).toLocaleString() : 'Never';
	}
</script>

<div class="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold"><Users class="size-5" />User management</h1>
			<p class="text-sm text-muted-foreground">Accounts, workspace access, identity information and bans.</p>
		</div>
		<Button size="sm" onclick={openCreate}><Plus />New user</Button>
	</div>

	{#if error}
		<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
	{/if}

	<Card>
		<CardContent class="space-y-4 pt-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 class="text-sm font-semibold">Registration</h2>
					<p class="text-xs text-muted-foreground">Controls normal account creation and default permissions.</p>
				</div>
				<Button size="sm" onclick={saveRegistrationSettings} disabled={registrationBusy || loading}>
					{#if registrationBusy}<LoaderCircle class="size-4 animate-spin" />{/if}
					Save registration
				</Button>
			</div>
			<div class="grid gap-3 md:grid-cols-[220px_1fr]">
				<label class="space-y-1.5 text-sm">
					<span>Registration mode</span>
					<select bind:value={registrationMode} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
						<option value="off">Off</option>
						<option value="open">Open registration</option>
						<option value="approval_queue">Approval queue</option>
					</select>
				</label>
				<fieldset class="rounded-md border p-3" disabled={loading}>
					<legend class="px-1 text-sm font-medium">Default normal-user permissions</legend>
					<div class="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each capabilities as key}
							<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={registrationPermissions[key]} />{permissionLabels[key] || key}</label>
						{/each}
					</div>
				</fieldset>
			</div>
			{#if registrationError}<p class="text-sm text-destructive">{registrationError}</p>{/if}
			{#if registrationSaved}<p class="text-sm text-emerald-400">{registrationSaved}</p>{/if}
			<div class="space-y-2">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending requests</h3>
				{#if registrationRequests.length === 0}
					<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No pending registration requests.</p>
				{:else}
					{#each registrationRequests as request (request.id)}
						<div class="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
							<div>
								<strong class="text-sm">{request.username}</strong>
								<p class="text-xs text-muted-foreground">{request.email || 'No email'} · {formatDate(request.requestedAt)}</p>
							</div>
							<div class="flex gap-2">
								<Button size="sm" onclick={() => resolveRegistrationRequest(request.id, 'approve')} disabled={registrationRequestBusy === request.id}>
									{#if registrationRequestBusy === request.id}<LoaderCircle class="size-4 animate-spin" />{:else}<ShieldCheck />{/if}
									Approve
								</Button>
								<Button size="sm" variant="outline" onclick={() => resolveRegistrationRequest(request.id, 'reject')} disabled={registrationRequestBusy === request.id}>
									<X />
									Reject
								</Button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</CardContent>
	</Card>

	{#if formOpen}
		<Card>
			<CardContent class="space-y-4 pt-4">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{editingUsername ? `Edit ${editingUsername}` : 'Create user'}</h2>
					<button class="text-muted-foreground hover:text-foreground" onclick={() => (formOpen = false)} aria-label="Close"><X class="size-4" /></button>
				</div>
				<form class="space-y-4" onsubmit={saveUser}>
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="space-y-1.5 text-sm"><span>Username</span><Input bind:value={formUsername} disabled={!!editingUsername} /></label>
						<label class="space-y-1.5 text-sm"><span>{editingUsername ? 'New PIN' : 'PIN'}</span><Input type="password" bind:value={formPin} placeholder={editingUsername ? 'Leave blank to keep current PIN' : '4-10 digits'} /></label>
						<label class="space-y-1.5 text-sm"><span>Email</span><Input type="email" bind:value={formEmail} /></label>
						<label class="space-y-1.5 text-sm"><span>Panel role</span>
							<select bind:value={formRole} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="user">User</option><option value="admin">Admin</option></select>
						</label>
						<label class="space-y-1.5 text-sm"><span>Status</span>
							<select bind:value={formStatus} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" disabled={editingUsername === auth.user?.username}><option value="active">Active</option><option value="inactive">Inactive</option><option value="banned">Banned</option></select>
						</label>
						{#if formStatus === 'banned'}<label class="space-y-1.5 text-sm"><span>Ban reason</span><Input bind:value={formBanReason} placeholder="Shown when login is blocked" /></label>{/if}
					</div>
					<fieldset class="rounded-md border p-3" disabled={formRole === 'admin'}>
						<legend class="px-1 text-sm font-medium">Per-user permissions</legend>
						<div class="grid gap-2 pt-2 sm:grid-cols-2">{#each capabilities as key}<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={formPermissions[key]} />{permissionLabels[key] || key}</label>{/each}</div>
					</fieldset>
					{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}
					<div class="flex gap-2"><Button type="submit" size="sm" disabled={saving}>{#if saving}<LoaderCircle class="size-4 animate-spin" />{/if}Save</Button><Button type="button" size="sm" variant="outline" onclick={() => (formOpen = false)}>Cancel</Button></div>
				</form>
			</CardContent>
		</Card>
	{/if}

	<div class="space-y-3">
		{#if loading}
			<div class="flex items-center justify-center gap-2 rounded-lg border py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" />Loading users…</div>
		{:else}
			{#each users as user (user.username)}
				<Card>
					<CardContent class="p-0">
						<div class="flex flex-wrap items-center justify-between gap-3 p-4">
							<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>{user.username}</strong><Badge variant={user.role === 'owner' ? 'success' : user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge><Badge variant={user.status === 'active' ? 'success' : user.status === 'banned' ? 'destructive' : 'secondary'}>{user.status}</Badge></div><p class="mt-1 truncate text-xs text-muted-foreground">{user.email ?? 'No email address'}</p></div>
							<div class="flex flex-wrap gap-2">
								<Button size="sm" variant="outline" onclick={() => openEdit(user)} disabled={user.protected}><Pencil />Edit</Button>
								{#if !user.protected && user.username !== auth.user?.username}{#if user.status === 'banned'}<Button size="sm" variant="outline" onclick={() => unbanUser(user.username)} disabled={banBusy === user.username}><ShieldCheck />Unban</Button>{:else}<Button size="sm" variant="destructive" onclick={() => { banTarget = user; banReason = ''; }}><Ban />Ban</Button>{/if}{/if}
								<Button size="sm" variant="ghost" onclick={() => (expanded = expanded === user.username ? null : user.username)}>{#if expanded === user.username}<ChevronUp />Less{:else}<ChevronDown />Details{/if}</Button>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
							<div class="bg-card p-3"><div class="flex items-center gap-2 text-xs text-muted-foreground"><FolderOpen class="size-4" />Workspaces</div><strong class="mt-1 block text-lg">{user.workspaceCount}</strong><span class="text-xs text-muted-foreground">{user.ownedWorkspaces} owned</span></div>
							<div class="bg-card p-3"><div class="flex items-center gap-2 text-xs text-muted-foreground"><FileText class="size-4" />Files</div><strong class="mt-1 block text-lg">{user.fileCount}</strong><span class="text-xs text-muted-foreground">Accessible files</span></div>
							<div class="bg-card p-3"><div class="flex items-center gap-2 text-xs text-muted-foreground"><Monitor class="size-4" />Sessions</div><strong class="mt-1 block text-lg">{user.activeSessions}</strong><span class="text-xs text-muted-foreground">{user.loginCount} logins</span></div>
							<div class="bg-card p-3"><div class="flex items-center gap-2 text-xs text-muted-foreground"><Network class="size-4" />Last IP</div><strong class="mt-1 block truncate text-sm">{user.lastIp || 'Unknown'}</strong><span class="text-xs text-muted-foreground">{formatDate(user.lastLoginAt)}</span></div>
						</div>
						{#if expanded === user.username}
							<div class="grid gap-3 p-4 lg:grid-cols-2">
								<div class="rounded-md border p-3"><h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace roles</h3>{#if user.workspaceRoles.length}{#each user.workspaceRoles as workspace}<div class="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0"><span class="truncate">{workspace.workspaceName}</span><div class="flex items-center gap-2"><Badge variant="secondary">{workspace.role}</Badge><span class="text-xs text-muted-foreground">{workspace.files} files</span></div></div>{/each}{:else}<p class="text-sm text-muted-foreground">No workspace access.</p>{/if}</div>
								<div class="rounded-md border p-3"><h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identity information</h3><dl class="space-y-3 text-sm"><div><dt class="text-xs text-muted-foreground">Last IP address</dt><dd class="break-all">{user.lastIp || 'Not recorded'}</dd></div><div><dt class="text-xs text-muted-foreground">Browser / device</dt><dd class="break-all text-xs">{user.lastUserAgent || 'Not recorded'}</dd></div><div><dt class="text-xs text-muted-foreground">Last successful login</dt><dd>{formatDate(user.lastLoginAt)}</dd></div></dl></div>
							</div>
						{/if}
					</CardContent>
				</Card>
			{/each}
		{/if}
	</div>

	<Card class="border-destructive/30">
		<CardContent class="space-y-3 pt-4">
			<div class="flex items-center gap-2"><Ban class="size-4 text-destructive" /><div><h2 class="text-sm font-semibold">Ban users</h2><p class="text-xs text-muted-foreground">Blocks login immediately and revokes active sessions.</p></div></div>
			{#if banTarget}<div class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"><p class="text-sm">Ban <strong>{banTarget.username}</strong></p><Input bind:value={banReason} placeholder="Required ban reason" /><div class="flex gap-2"><Button size="sm" variant="destructive" onclick={banUser} disabled={!banReason.trim() || banBusy === banTarget.username}>{#if banBusy === banTarget.username}<LoaderCircle class="size-4 animate-spin" />{/if}Confirm ban</Button><Button size="sm" variant="outline" onclick={() => (banTarget = null)}>Cancel</Button></div></div>{/if}
			{#if bannedUsers.length === 0}<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No banned users.</p>{:else}{#each bannedUsers as user}<div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 p-3"><div><strong>{user.username}</strong><p class="text-xs text-muted-foreground">{user.banReason || 'No reason recorded'}</p><p class="text-xs text-muted-foreground">Last IP: {user.lastIp || 'Unknown'}</p></div><Button size="sm" variant="outline" onclick={() => unbanUser(user.username)} disabled={banBusy === user.username}><ShieldCheck />Unban</Button></div>{/each}{/if}
		</CardContent>
	</Card>
</div>
