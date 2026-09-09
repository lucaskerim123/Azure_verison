<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button, Input } from '$lib/components/ui';
	import { Link, Copy, Check, X, LoaderCircle } from '@lucide/svelte';

	let { path, filename, onClose }: { path: string; filename: string; onClose: () => void } = $props();

	type ShareLink = { url: string; expiresAt: string };

	let days = $state(7);
	let creating = $state(false);
	let error = $state('');
	let link = $state<ShareLink | null>(null);
	let copied = $state(false);

	async function create() {
		creating = true;
		error = '';
		try {
			link = await api.post<ShareLink>('/share', { path, days });
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not create share link';
		} finally {
			creating = false;
		}
	}

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link.url);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard permission denied — link is still selectable/visible in the input
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
	<div class="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="flex items-center gap-2 text-sm font-semibold">
				<Link class="size-4 text-muted-foreground" />
				Share "{filename}"
			</h2>
			<button class="text-muted-foreground hover:text-foreground" onclick={onClose} aria-label="Close">
				<X class="size-4" />
			</button>
		</div>

		{#if !link}
			<div class="space-y-3">
				<div class="space-y-1.5">
					<label for="share-days" class="text-sm font-medium">Expires after (days)</label>
					<Input id="share-days" type="number" min="1" max="30" bind:value={days} class="w-24" />
				</div>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
				<Button size="sm" onclick={create} disabled={creating}>
					{#if creating}<LoaderCircle class="size-4 animate-spin" />{/if}
					Create link
				</Button>
			</div>
		{:else}
			<div class="space-y-3">
				<div class="flex gap-2">
					<Input readonly value={link.url} class="flex-1 font-mono text-xs" />
					<Button size="sm" variant="outline" onclick={copy}>
						{#if copied}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">Expires {new Date(link.expiresAt).toLocaleString()}</p>
			</div>
		{/if}
	</div>
</div>
