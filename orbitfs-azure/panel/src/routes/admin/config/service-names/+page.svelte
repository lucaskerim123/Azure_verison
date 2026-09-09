<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui';
	import { LoaderCircle, ServerCog } from '@lucide/svelte';
	type Field = { key:string; label:string; value:string };
	let fields=$state<Field[]>([]), loading=$state(true), error=$state('');
	async function load(){loading=true;error='';try{fields=(await api.get<{fields:Field[]}>('/config/service-names')).fields;}catch(e){error=e instanceof ApiError?e.message:'Failed to load runtime providers';}finally{loading=false;}}
	load();
</script>

<div class="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><ServerCog class="size-5" />Runtime providers</h1><p class="text-sm text-muted-foreground">The cloud edition does not install or rename Windows services. These are the managed providers currently backing the Panel.</p></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	{#if loading}<div class="flex justify-center py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" /></div>
	{:else}<Card><CardHeader><CardTitle>Managed infrastructure</CardTitle></CardHeader><CardContent class="space-y-3">{#each fields as field (field.key)}<div class="rounded-lg border bg-background/40 p-3"><div class="font-medium">{field.label}</div><div class="mt-1 text-sm text-muted-foreground">{field.value}</div></div>{/each}</CardContent></Card>{/if}
</div>