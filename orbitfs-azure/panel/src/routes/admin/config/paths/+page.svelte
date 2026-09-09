<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { FolderCog, LoaderCircle } from '@lucide/svelte';
	type PathField = { key:string; label:string; value:string; exists:boolean };
	let fields = $state<PathField[]>([]);
	let loading = $state(true);
	let error = $state('');
	async function load(){
		loading=true; error='';
		try { fields=(await api.get<{fields:PathField[]}>('/config/paths')).fields; }
		catch(err){ error=err instanceof ApiError ? err.message : 'Failed to load cloud storage locations'; }
		finally{ loading=false; }
	}
	load();
</script>

<div class="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><FolderCog class="size-5" />Cloud storage locations</h1><p class="text-sm text-muted-foreground">The Vercel edition uses logical workspace paths backed by Supabase records and object storage. These locations are deployment-managed, not local drive paths.</p></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	{#if loading}<div class="flex justify-center py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" /></div>
	{:else}
		<Card><CardHeader><CardTitle>Storage mapping</CardTitle><CardDescription>Read-only infrastructure currently used by OrbitFS.</CardDescription></CardHeader><CardContent class="space-y-3">
			{#each fields as field (field.key)}
				<div class="rounded-lg border bg-background/40 p-3"><div class="flex items-center justify-between gap-3"><span class="font-medium">{field.label}</span><span class="text-xs {field.exists ? 'text-success' : 'text-warning'}">{field.exists ? 'Available' : 'Unavailable'}</span></div><div class="mt-1 break-all font-mono text-xs text-muted-foreground">{field.value}</div></div>
			{/each}
		</CardContent></Card>
	{/if}
</div>