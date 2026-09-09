<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button } from '$lib/components/ui';
	import { Folder, ChevronRight, X, LoaderCircle } from '@lucide/svelte';

	let {
		title = 'Move to…',
		onPick,
		onCancel
	}: { title?: string; onPick: (destination: string) => void; onCancel: () => void } = $props();

	type Entry = { name: string; type: 'dir' | 'file' };

	let path = $state('');
	let dirs = $state<Entry[]>([]);
	let loading = $state(true);
	let error = $state('');

	const breadcrumbs = $derived(
		path
			? path.split('/').filter(Boolean).map((seg, i, arr) => ({ label: seg, path: arr.slice(0, i + 1).join('/') }))
			: []
	);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api.get<{ entries: Entry[] }>(`/files?subpath=${encodeURIComponent(path)}`);
			dirs = res.entries.filter((e) => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load folders';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		path;
		load();
	});
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
	<div class="flex max-h-[70vh] w-full max-w-md flex-col rounded-lg border border-border bg-card shadow-lg">
		<div class="flex items-center justify-between border-b border-border p-3">
			<h2 class="text-sm font-semibold">{title}</h2>
			<button class="text-muted-foreground hover:text-foreground" onclick={onCancel} aria-label="Close">
				<X class="size-4" />
			</button>
		</div>

		<nav class="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
			<button class="hover:text-foreground" onclick={() => (path = '')}>Main workspace</button>
			{#each breadcrumbs as crumb (crumb.path)}
				<ChevronRight class="size-3 shrink-0" />
				<button class="hover:text-foreground" onclick={() => (path = crumb.path)}>{crumb.label}</button>
			{/each}
		</nav>

		<div class="flex-1 overflow-y-auto p-2">
			{#if loading}
				<div class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
					<LoaderCircle class="size-4 animate-spin" />
					Loading&hellip;
				</div>
			{:else if error}
				<p class="p-2 text-sm text-destructive">{error}</p>
			{:else if dirs.length === 0}
				<p class="p-2 text-sm text-muted-foreground">No subfolders here.</p>
			{:else}
				{#each dirs as dir (dir.name)}
					<button
						class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
						onclick={() => (path = path ? `${path}/${dir.name}` : dir.name)}
					>
						<Folder class="size-4 text-muted-foreground" />
						{dir.name}
					</button>
				{/each}
			{/if}
		</div>

		<div class="flex items-center justify-between gap-2 border-t border-border p-3">
			<span class="truncate text-xs text-muted-foreground">/{path}</span>
			<Button size="sm" onclick={() => onPick(path)}>Move here</Button>
		</div>
	</div>
</div>
