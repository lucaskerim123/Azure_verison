<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge } from '$lib/components/ui';
	import { FileLock, Plus, Pencil, Trash2, X, LoaderCircle, Search } from '@lucide/svelte';
	import PathPicker from '$lib/components/path-picker.svelte';

	const ACTIONS = ['read', 'write', 'download', 'move', 'delete', 'create', 'share'] as const;
	type Action = (typeof ACTIONS)[number];
	type Permissions = Record<Action, boolean>;
	type Rule = { path: string; permissions: Permissions };

	function emptyPermissions(): Permissions {
		return { read: true, write: false, download: false, move: false, delete: false, create: false, share: false };
	}

	let rules = $state<Rule[]>([]);
	let loading = $state(true);
	let error = $state('');

	let formOpen = $state(false);
	let editingPath = $state<string | null>(null);
	let formPath = $state('');
	let formPermissions = $state<Permissions>(emptyPermissions());
	let saving = $state(false);
	let formError = $state('');

	let deletingPath = $state<string | null>(null);
	let deleteBusy = $state<string | null>(null);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api.get<{ rules: Rule[] }>('/file-permissions');
			rules = res.rules;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load rules';
		} finally {
			loading = false;
		}
	}
	load();

	function openCreate() {
		editingPath = null;
		formPath = '';
		formPermissions = emptyPermissions();
		formError = '';
		formOpen = true;
	}

	function openEdit(rule: Rule) {
		editingPath = rule.path;
		formPath = rule.path;
		formPermissions = { ...rule.permissions };
		formError = '';
		formOpen = true;
	}

	async function submit(e: Event) {
		e.preventDefault();
		formError = '';
		saving = true;
		try {
			await api.post('/file-permissions', { path: formPath.trim(), permissions: formPermissions });
			formOpen = false;
			await load();
		} catch (err) {
			formError = err instanceof ApiError ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function remove(path: string) {
		deleteBusy = path;
		deletingPath = null;
		try {
			await api.delete(`/file-permissions?path=${encodeURIComponent(path)}`);
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Delete failed';
		} finally {
			deleteBusy = null;
		}
	}

	// --- Effective permissions lookup --------------------------------------
	let lookupPath = $state('');
	let lookupResult = $state<Permissions | null>(null);
	let lookupLoading = $state(false);
	let lookupError = $state('');

	async function runLookup(e: Event) {
		e.preventDefault();
		lookupLoading = true;
		lookupError = '';
		lookupResult = null;
		try {
			const res = await api.get<{ path: string; permissions: Permissions }>(
				`/file-permissions/effective?path=${encodeURIComponent(lookupPath.trim())}`
			);
			lookupResult = res.permissions;
		} catch (err) {
			lookupError = err instanceof ApiError ? err.message : 'Lookup failed';
		} finally {
			lookupLoading = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
				<FileLock class="size-5 text-muted-foreground" />
				File permissions
			</h1>
			<p class="text-sm text-muted-foreground">
				Per-path rules for the <code>viewer</code> role on the Public Workspace. Folder rules inherit to
				children; the most specific matching path wins. Admins bypass all rules.
			</p>
		</div>
		<Button size="sm" onclick={openCreate}><Plus />New rule</Button>
	</div>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Search class="size-4 text-muted-foreground" />
				Check effective permissions
			</CardTitle>
			<CardDescription>See what the <code>user</code> role can actually do at a given path, after inheritance.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			<form class="flex flex-wrap items-end gap-2" onsubmit={runLookup}>
				<div class="min-w-56 flex-1 space-y-1.5">
					<label for="lookup-path" class="text-sm font-medium">Path</label>
					<PathPicker bind:value={lookupPath} workspaceId="admin-main" placeholder="Choose a file or folder" />
				</div>
				<Button type="submit" size="sm" disabled={lookupLoading}>
					{#if lookupLoading}<LoaderCircle class="size-4 animate-spin" />{:else}Check{/if}
				</Button>
			</form>
			{#if lookupError}<p class="text-sm text-destructive">{lookupError}</p>{/if}
			{#if lookupResult}
				<div class="flex flex-wrap gap-1.5">
					{#each ACTIONS as action (action)}
						<Badge variant={lookupResult[action] ? 'success' : 'secondary'}>{action}</Badge>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if error}
		<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{error}
		</div>
	{/if}

	{#if formOpen}
		<Card>
			<CardContent class="space-y-3 pt-4">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{editingPath ? `Edit rule: ${editingPath || '/'}` : 'New rule'}</h2>
					<button class="text-muted-foreground hover:text-foreground" onclick={() => (formOpen = false)} aria-label="Close">
						<X class="size-4" />
					</button>
				</div>
				<form class="space-y-3" onsubmit={submit}>
					<div class="space-y-1.5">
						<label for="rule-path" class="text-sm font-medium">Path</label>
						<PathPicker
							bind:value={formPath}
							workspaceId="admin-main"
							disabled={!!editingPath}
							placeholder="Choose a file or folder"
						/>
					</div>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{#each ACTIONS as action (action)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" bind:checked={formPermissions[action]} />
								{action}
							</label>
						{/each}
					</div>
					{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}
					<div class="flex gap-2">
						<Button type="submit" size="sm" disabled={saving}>
							{#if saving}<LoaderCircle class="size-4 animate-spin" />{/if}
							Save
						</Button>
						<Button type="button" variant="outline" size="sm" onclick={() => (formOpen = false)}>Cancel</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}

	<div class="overflow-hidden rounded-lg border border-border bg-card">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-16 text-muted-foreground">
				<LoaderCircle class="size-5 animate-spin" />
				Loading&hellip;
			</div>
		{:else if rules.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
				<FileLock class="size-8" />
				<p class="text-sm">No rules yet — the <code>user</code> role can access everything by default.</p>
			</div>
		{:else}
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-muted-foreground">
						<th class="px-4 py-2 font-medium">Path</th>
						<th class="hidden px-4 py-2 font-medium md:table-cell">Allowed</th>
						<th class="px-4 py-2 font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#each rules as rule (rule.path)}
						<tr class="group border-b border-border last:border-0 hover:bg-accent/40">
							<td class="px-4 py-2 font-mono text-xs">{rule.path || '/'}</td>
							<td class="hidden px-4 py-2 text-xs text-muted-foreground md:table-cell">
								{ACTIONS.filter((a) => rule.permissions[a]).join(', ') || 'none'}
							</td>
							<td class="px-4 py-2">
								<div class="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<button
										class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
										aria-label="Edit"
										onclick={() => openEdit(rule)}
									>
										<Pencil class="size-4" />
									</button>
									{#if deletingPath === rule.path}
										<button
											class="flex h-7 items-center gap-1 rounded-md bg-destructive/15 px-2 text-xs font-medium text-destructive"
											onclick={() => remove(rule.path)}
											disabled={deleteBusy === rule.path}
										>
											{#if deleteBusy === rule.path}<LoaderCircle class="size-3.5 animate-spin" />{:else}Confirm{/if}
										</button>
										<button
											class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
											onclick={() => (deletingPath = null)}
											aria-label="Cancel"
										>
											<X class="size-4" />
										</button>
									{:else}
										<button
											class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
											aria-label="Delete"
											onclick={() => (deletingPath = rule.path)}
										>
											<Trash2 class="size-4" />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
