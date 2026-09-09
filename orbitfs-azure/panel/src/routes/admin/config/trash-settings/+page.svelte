<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '$lib/components/ui';
	import { Trash2, LoaderCircle, Save } from '@lucide/svelte';
	let retentionDays = $state<number | null>(null);
	let loading = $state(true), saving = $state(false), emptying = $state(false), confirm = $state(false);
	let error = $state(''), result = $state('');
	async function load() {
		loading = true; error = '';
		try { retentionDays = (await api.get<{ retentionDays: number }>('/system/trash-config')).retentionDays; }
		catch (e) { error = e instanceof ApiError ? e.message : 'Failed to load'; }
		finally { loading = false; }
	}
	async function save(e: Event) {
		e.preventDefault(); if (retentionDays == null) return; saving = true; error = '';
		try { retentionDays = (await api.post<{ retentionDays: number }>('/system/trash-config', { retentionDays })).retentionDays; result = 'Saved.'; }
		catch (e) { error = e instanceof ApiError ? e.message : 'Save failed'; }
		finally { saving = false; }
	}
	async function emptyTrash() {
		emptying = true; error = '';
		try { await api.post('/trash/empty'); result = 'Trash emptied.'; confirm = false; }
		catch (e) { error = e instanceof ApiError ? e.message : 'Empty failed'; }
		finally { emptying = false; }
	}
	load();
</script><div class="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><Trash2 class="size-5" />Trash settings</h1>
		<p class="text-sm text-muted-foreground">Retention and manual purge for the main workspace trash.</p></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	<Card><CardHeader><CardTitle>Retention</CardTitle><CardDescription>How long deleted files remain before removal.</CardDescription></CardHeader><CardContent>
		{#if loading}<LoaderCircle class="size-5 animate-spin" />{:else}
		<form class="flex items-end gap-2" onsubmit={save}><div class="space-y-1.5"><label for="days" class="text-sm font-medium">Retention days</label>
			<Input id="days" type="number" min="1" bind:value={retentionDays} /></div><Button type="submit" disabled={saving}>
			{#if saving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}Save</Button></form>{/if}
	</CardContent></Card>
	<Card class="border-destructive/30"><CardHeader><CardTitle>Empty trash</CardTitle><CardDescription>Permanently removes everything currently in trash.</CardDescription></CardHeader><CardContent>
		{#if confirm}<div class="flex gap-2"><Button variant="destructive" onclick={emptyTrash} disabled={emptying}>
			{#if emptying}<LoaderCircle class="size-4 animate-spin" />{/if}Confirm empty</Button><Button variant="outline" onclick={() => (confirm = false)}>Cancel</Button></div>
		{:else}<Button variant="outline" onclick={() => (confirm = true)}>Empty trash</Button>{/if}
		{#if result}<p class="mt-3 text-sm text-success">{result}</p>{/if}
	</CardContent></Card>
</div>