<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { tick } from 'svelte';
	import { Button } from '$lib/components/ui';
	import { ChevronRight, File, Folder, FolderOpen, FolderPlus, FolderSearch, LoaderCircle, X } from '@lucide/svelte';

	type Entry = { name: string; type: 'dir' | 'file' };
	type Mode = 'any' | 'folder';

	let {
		value = $bindable(''),
		workspaceId,
		mode = 'any',
		disabled = false,
		placeholder = 'Choose a file or folder'
	}: {
		value?: string;
		workspaceId?: string | null;
		mode?: Mode;
		disabled?: boolean;
		placeholder?: string;
	} = $props();

	let open = $state(false);
	let path = $state('');
	let entries = $state<Entry[]>([]);
	let loading = $state(false);
	let error = $state('');
	let canCreateFolder = $state(false);
	let creatingFolder = $state(false);
	let newFolderName = $state('');
	let createBusy = $state(false);
	let dialog = $state<HTMLElement | null>(null);
	let returnFocus: HTMLElement | null = null;

	const breadcrumbs = $derived(
		path
			? path.split('/').filter(Boolean).map((part, index, all) => ({
					label: part,
					path: all.slice(0, index + 1).join('/')
				}))
			: []
	);

	function join(base: string, name: string) {
		return base ? `${base}/${name}` : name;
	}

	const displayValue = $derived(
		value ? value.split('/').filter(Boolean).pop() || value : placeholder
	);

	async function showPicker() {
		returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		if (value) {
			const parts = value.split('/').filter(Boolean);
			path = mode === 'folder' ? value : parts.slice(0, -1).join('/');
		} else {
			path = '';
		}
		error = '';
		open = true;
		await tick();
		dialog?.focus();
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const headers = workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined;
			const result = await api.get<{ entries: Entry[]; folderPermissions?: { create?: boolean } }>(
				`/files?subpath=${encodeURIComponent(path)}`,
				headers
			);
			canCreateFolder = result.folderPermissions?.create === true;
			entries = [...result.entries].sort((left, right) =>
				left.type === right.type
					? left.name.localeCompare(right.name)
					: left.type === 'dir' ? -1 : 1
			);
		} catch (err) {
			entries = [];
			canCreateFolder = false;
			error = err instanceof ApiError ? err.message : 'Could not load this folder';
		} finally {
			loading = false;
		}
	}

	async function createFolder() {
		const name = newFolderName.trim();
		if (!name || !canCreateFolder || createBusy) return;
		createBusy = true;
		error = '';
		try {
			await api.post('/mkdir', { path: join(path, name) });
			newFolderName = '';
			creatingFolder = false;
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not create folder';
		} finally {
			createBusy = false;
		}
	}

	async function closePicker() {
		open = false;
		await tick();
		returnFocus?.focus();
		returnFocus = null;
	}

	async function pick(selectedPath: string) {
		value = selectedPath;
		await closePicker();
	}

	function handleDialogKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closePicker();
			return;
		}
		if (event.key !== 'Tab' || !dialog) return;
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		if (!open) return;
		path;
		workspaceId;
		load();
	});

	$effect(() => {
		if (!open) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	});
</script>

<div class="flex w-full min-w-0 max-w-full gap-2 overflow-hidden">
	<Button
		type="button"
		variant="outline"
		class="w-0 min-w-0 flex-1 justify-start overflow-hidden"
		disabled={disabled}
		onclick={showPicker}
		title={value ? `/${value}` : placeholder}
	>
		<FolderSearch class="size-4 shrink-0" />
		<span class="min-w-0 flex-1 truncate text-left">{displayValue}</span>
	</Button>
	{#if value && !disabled}
		<Button type="button" variant="ghost" size="icon" aria-label="Clear selected path" onclick={() => (value = '')}>
			<X class="size-4" />
		</Button>
	{/if}
</div>

{#if open}
	<button type="button" class="fixed inset-0 z-[90] bg-black/60" aria-label="Close picker" onclick={closePicker}></button>
	<div
		bind:this={dialog}
		class="fixed top-1/2 left-1/2 z-[100] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-label={mode === 'folder' ? 'Choose folder' : 'Choose file or folder'}
		tabindex="-1"
		onkeydown={handleDialogKey}
	>
			<header class="flex items-center justify-between border-b border-border p-3">
				<div>
					<h2 class="text-sm font-semibold">{mode === 'folder' ? 'Choose folder' : 'Choose file or folder'}</h2>
					<p class="text-xs text-muted-foreground">Workspace filesystem</p>
				</div>
				<Button type="button" variant="ghost" size="icon" aria-label="Close picker" onclick={closePicker}>
					<X class="size-4" />
				</Button>
			</header>

			<nav class="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs">
				<button class="font-medium hover:text-primary" onclick={() => (path = '')}>Workspace root</button>
				{#each breadcrumbs as crumb (crumb.path)}
					<ChevronRight class="size-3 text-muted-foreground" />
					<button class="max-w-36 truncate hover:text-primary" onclick={() => (path = crumb.path)}>{crumb.label}</button>
				{/each}
			</nav>

			<div class="min-h-52 flex-1 overflow-y-auto p-2">
				{#if loading}
					<div class="grid place-items-center py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" /></div>
				{:else if error}
					<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
				{:else if entries.length === 0}
					<div class="grid place-items-center gap-2 py-16 text-sm text-muted-foreground">
						<FolderOpen class="size-7" />This folder is empty.
					</div>
				{:else}
					{#each entries as entry (entry.name)}
						{@const fullPath = join(path, entry.name)}
						<div class="group flex items-center gap-1 rounded-md hover:bg-accent">
							<button
								class="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm"
								onclick={() => entry.type === 'dir' ? (path = fullPath) : pick(fullPath)}
								disabled={mode === 'folder' && entry.type === 'file'}
							>
								{#if entry.type === 'dir'}<Folder class="size-4 shrink-0 text-primary" />{:else}<File class="size-4 shrink-0 text-muted-foreground" />{/if}
								<span class="truncate">{entry.name}</span>
							</button>
							{#if entry.type === 'dir'}
								<Button type="button" variant="ghost" size="sm" class="mr-1" onclick={() => pick(fullPath)}>Select</Button>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			{#if canCreateFolder}
				<div class="border-t border-border p-3">
					{#if creatingFolder}
						<form class="flex items-center gap-2" onsubmit={(event) => { event.preventDefault(); createFolder(); }}>
							<FolderPlus class="size-4 shrink-0 text-muted-foreground" />
							<input class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" bind:value={newFolderName} placeholder="Folder name" disabled={createBusy} />
							<Button type="submit" size="sm" disabled={createBusy || !newFolderName.trim()}>{createBusy ? 'Creating?' : 'Create'}</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => { creatingFolder = false; newFolderName = ''; }} disabled={createBusy}>Cancel</Button>
						</form>
					{:else}
						<Button type="button" variant="outline" size="sm" onclick={() => (creatingFolder = true)}><FolderPlus class="size-4" />Create folder</Button>
					{/if}
				</div>
			{/if}

			<footer class="flex items-center justify-between gap-3 border-t border-border p-3">
				<span class="min-w-0 truncate text-xs text-muted-foreground">/{path}</span>
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={closePicker}>Cancel</Button>
					<Button type="button" onclick={() => pick(path)}>{path ? 'Select current folder' : 'Select workspace root'}</Button>
				</div>
			</footer>
	</div>
{/if}
