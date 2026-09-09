<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button } from '$lib/components/ui';
	import { ShieldCheck, X, LoaderCircle, RotateCcw } from '@lucide/svelte';

	type Permissions = Record<string, boolean>;
	type PermissionResponse = {
		path: string;
		roles: string[];
		actions: string[];
		effective: Record<string, Permissions>;
		explicit: Record<string, Permissions>;
	};

	let { path, kind, onClose, onSaved }: {
		path: string;
		kind: 'file' | 'folder';
		onClose: () => void;
		onSaved?: () => void;
	} = $props();

	const roleLabels: Record<string, string> = {
		editor: 'Editors',
		contributor: 'Contributors',
		viewer: 'Viewers'
	};
	const actionLabels: Record<string, string> = {
		read: 'View / open',
		write: 'Edit contents',
		download: 'Download',
		move: 'Move or rename',
		delete: 'Move to trash',
		create: 'Create inside',
		share: 'Create share links'
	};

	let data = $state<PermissionResponse | null>(null);
	let selectedRole = $state('viewer');
	let values = $state<Permissions>({});
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let saved = $state(false);

	function selectRole(role: string) {
		selectedRole = role;
		values = { ...(data?.explicit[role] ?? data?.effective[role] ?? {}) };
		saved = false;
	}

	function setAction(action: string, enabled: boolean) {
		values = { ...values, [action]: enabled };
		saved = false;
	}
	async function load() {
		loading = true;
		error = '';
		try {
			data = await api.get<PermissionResponse>(`/path-permissions?path=${encodeURIComponent(path)}`);
			selectRole(selectedRole);
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load permissions';
		} finally {
			loading = false;
		}
	}

	async function save() {
		saving = true;
		error = '';
		try {
			await api.put('/path-permissions', { path, role: selectedRole, permissions: values });
			await load();
			saved = true;
			onSaved?.();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to save permissions';
		} finally {
			saving = false;
		}
	}
	async function reset() {
		saving = true;
		error = '';
		try {
			await api.delete(`/path-permissions?path=${encodeURIComponent(path)}&role=${encodeURIComponent(selectedRole)}`);
			await load();
			saved = true;
			onSaved?.();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to reset permissions';
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		path;
		load();
	});
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4">
	<div class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:max-h-[92vh]">
		<header class="flex items-center gap-3 border-b border-border px-4 py-3">
			<div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
				<ShieldCheck class="size-5" />
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold">Permissions</h2>
				<p class="truncate text-xs text-muted-foreground">{kind}: {path || 'Workspace root'}</p>
			</div>
			<button class="flex size-8 items-center justify-center rounded-md hover:bg-accent" onclick={onClose} aria-label="Close permissions">
				<X class="size-4" />
			</button>
		</header>

		{#if loading}
			<div class="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
				<LoaderCircle class="size-5 animate-spin" />Loading permissions…
			</div>
		{:else if error && !data}
			<div class="p-5 text-sm text-destructive">{error}</div>
		{:else if data}
			<div class="flex gap-1 overflow-x-auto border-b border-border px-3 pt-3">
				{#each data.roles as role}
					<button
						class="whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-xs {selectedRole === role ? 'border-border bg-card font-medium' : 'border-transparent text-muted-foreground'}"
						onclick={() => selectRole(role)}
					>{roleLabels[role] ?? role}</button>
				{/each}
			</div>
			<div class="flex-1 overflow-y-auto p-4">
				<p class="mb-3 text-xs text-muted-foreground">
					{kind === 'folder' ? 'These rules also apply to items inside this folder unless a deeper rule overrides them.' : 'These rules apply to this file only.'}
				</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each data.actions as action}
						<label class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
							<span class="text-sm">{actionLabels[action] ?? action}</span>
							<input
								type="checkbox"
								checked={Boolean(values[action])}
								onchange={(event) => setAction(action, event.currentTarget.checked)}
							/>
						</label>
					{/each}
				</div>
				{#if error}<p class="mt-3 text-sm text-destructive">{error}</p>{/if}
				{#if saved}<p class="mt-3 text-sm text-emerald-400">Permissions updated.</p>{/if}
			</div>

			<footer class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
				<Button variant="ghost" size="sm" onclick={reset} disabled={saving || !data.explicit[selectedRole]}>
					<RotateCcw class="size-4" />Use inherited defaults
				</Button>
				<div class="ml-auto flex gap-2">
					<Button variant="outline" size="sm" onclick={onClose}>Cancel</Button>
					<Button size="sm" onclick={save} disabled={saving}>
						{#if saving}<LoaderCircle class="size-4 animate-spin" />{/if}Save permissions
					</Button>
				</div>
			</footer>
		{/if}
	</div>
</div>
