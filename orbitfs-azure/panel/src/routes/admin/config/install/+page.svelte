<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { Button, Card, CardContent } from '$lib/components/ui';
	import { CheckCircle2, Cloud, Database, LoaderCircle, Settings, XCircle } from '@lucide/svelte';
	type SetupConfig={setupComplete:boolean;config:Record<string,string|number|boolean>;steps:Record<string,{complete?:boolean;title?:string;description?:string}>;notes:string[]};
	let loading=$state(true),error=$state('');
	let model=$state<SetupConfig|null>(null);
	let tests=$state<Record<string,{ok:boolean;message:string;status?:number}>>({});
	onMount(load);
	async function load(){loading=true;error='';try{model=await api.get<SetupConfig>('/setup/config');}catch(err){error=err instanceof ApiError?err.message:'Could not load cloud configuration';}finally{loading=false;}}
	async function test(target:string){tests={...tests,[target]:{ok:false,message:'Testing…'}};try{tests={...tests,[target]:await api.post('/setup/test-link',{target}) as any};}catch(err){tests={...tests,[target]:{ok:false,message:err instanceof ApiError?err.message:'Test failed'}};}}
</script>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><Settings class="size-5" />Panel deployment</h1><p class="text-sm text-muted-foreground">Base OrbitFS runtime and storage for the Vercel/Supabase edition.</p></div>
	{#if loading}<Card><CardContent class="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading deployment…</CardContent></Card>
	{:else if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
	{:else if model}
		<div class="grid gap-3 md:grid-cols-2">
			<Card><CardContent class="space-y-2 p-5"><div class="flex items-center gap-2 font-medium"><Cloud class="size-4" />Vercel runtime</div><p class="break-all font-mono text-xs">{model.config.publicOrigin}</p><p class="text-xs text-muted-foreground">API base: {model.config.apiBase} · deploy mode: {model.config.deployMode}</p></CardContent></Card>
			<Card><CardContent class="space-y-2 p-5"><div class="flex items-center gap-2 font-medium"><Database class="size-4" />Supabase data layer</div><p class="text-sm text-muted-foreground">{model.config.storageRoot}</p><p class="text-xs text-muted-foreground">Workspace and system state are stored in Supabase rather than a persistent VPS filesystem.</p></CardContent></Card>
		</div>
		<Card><CardContent class="space-y-4 p-5"><h2 class="font-semibold">Connectivity checks</h2><div class="flex flex-wrap gap-2"><Button variant="outline" onclick={() => test('license')}>Test licence API</Button><Button variant="outline" onclick={() => test('storage')}>Test Supabase Storage</Button></div>{#each Object.entries(tests) as [key,result]}<p class="flex items-center gap-2 text-sm {result.ok?'text-success':'text-destructive'}">{#if result.ok}<CheckCircle2 class="size-4" />{:else}<XCircle class="size-4" />{/if}{key}: {result.message}</p>{/each}</CardContent></Card>
		<Card><CardContent class="space-y-2 p-5"><h2 class="font-semibold">Base Panel notes</h2>{#each model.notes as note}<p class="text-sm text-muted-foreground">{note}</p>{/each}</CardContent></Card>
	{/if}
</div>