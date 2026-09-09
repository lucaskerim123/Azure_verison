<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { workspace } from '$lib/workspace.svelte';
	import { auth } from '$lib/auth.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { Database, ExternalLink, FileOutput, Library, RefreshCw, Settings } from '@lucide/svelte';

	let addon:any=$state(null),status:any=$state(null),loading=$state(true),error=$state('');
	const availableWorkspaces=$derived(workspace.workspaces.filter((item:any)=>
		item.permission==='owner'||item.management_permissions?.sorter_view===true||item.management_permissions?.converter_view===true
	));
	const currentId=()=>availableWorkspaces.some((item:any)=>item.id===workspace.currentId)?workspace.currentId:(availableWorkspaces[0]?.id||'');
	const reviewCount=$derived((status?.processing?.review?.length||0)+(status?.queue?.length||0));
	const engineManageUrl=$derived(String(addon?.engineManageUrl||''));

	async function refresh(){
		loading=true;error='';
		try{
			if(!workspace.loaded)await workspace.load();
			const id=currentId();
			if(id&&workspace.currentId!==id)workspace.select(id);
			const addons=await api.get<any>('/addons/status');
			addon=(addons.addons||[]).find((item:any)=>item.id==='apex')||null;
			status=id?await api.get<any>(`/addons/apex/workspaces/${encodeURIComponent(id)}/status`):null;
		}catch(err){error=err instanceof ApiError?err.message:err instanceof Error?err.message:'Unable to load APEX';}
		finally{loading=false;}
	}
	onMount(refresh);
</script>

<svelte:head><title>APEX · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div><p class="text-xs font-semibold uppercase tracking-[.16em] text-primary">APEX · PANEL</p><h1 class="mt-1 text-2xl font-semibold">APEX Converter & Knowledge Sorter</h1><p class="mt-1 max-w-3xl text-sm text-muted-foreground">Convert documents, sort and route Knowledge, review changes and control normal workspace behaviour here. Backend runtime, hard configuration, diagnostics and monitoring live on Engine Console.</p></div>
		<div class="flex flex-wrap gap-2"><Button variant="outline" onclick={refresh} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button>{#if auth.isAdmin&&engineManageUrl}<a href={engineManageUrl} target="_blank" rel="noreferrer"><Button variant="outline">Engine Console <ExternalLink class="size-4"/></Button></a>{/if}</div>
	</div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}

	{#if availableWorkspaces.length===0}
		<Card><CardContent class="p-8 text-center text-sm text-muted-foreground">No workspace with APEX access is available to this account.</CardContent></Card>
	{:else}
		<Card><CardHeader><CardTitle>Workspace</CardTitle><CardDescription>Choose which workspace APEX Converter and Knowledge Sorter should use.</CardDescription></CardHeader><CardContent class="flex flex-wrap items-center gap-3"><select class="min-w-64 rounded-md border bg-background px-3 py-2 text-sm" value={currentId()} onchange={async(e)=>{workspace.select(e.currentTarget.value);await refresh();}}>{#each availableWorkspaces as item}<option value={item.id}>{item.name}</option>{/each}</select>{#if addon}<Badge variant={addon.licensed?'success':'destructive'}>{addon.licensed?'Licensed':'Licence required'}</Badge><Badge variant={addon.attached?'success':'secondary'}>{addon.attached?'Attached':'Not attached'}</Badge><Badge variant={addon.setupComplete?'success':'secondary'}>{addon.setupComplete?'Ready':'Engine setup required'}</Badge>{/if}{#if reviewCount>0}<Badge variant="secondary">{reviewCount} review item{reviewCount===1?'':'s'}</Badge>{/if}</CardContent></Card>

		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			<a href="/library/import" class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><FileOutput class="size-5 text-primary"/><CardTitle>Converter</CardTitle><CardDescription>Upload PDF, DOCX, TXT, Markdown, HTML, CSV or JSON and convert it through the APEX processing pipeline.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open Converter →</span></CardContent></Card></a>
			<a href="/knowledge-setup" class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Database class="size-5 text-primary"/><CardTitle>Knowledge Sorter</CardTitle><CardDescription>Control active/reference knowledge, project/profile scope, authority, routing and priority.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Configure sorter →</span></CardContent></Card></a>
			<a href="/library" class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Library class="size-5 text-primary"/><CardTitle>Library & Knowledge</CardTitle><CardDescription>View source files, final Knowledge, revisions, metadata and Panel-owned approval state.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open Library →</span></CardContent></Card></a>
			<a href="/sorter-converter/master-control" class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Settings class="size-5 text-primary"/><CardTitle>APEX Settings</CardTitle><CardDescription>Normal converter defaults and Knowledge sorter settings that belong to the Panel experience.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open settings →</span></CardContent></Card></a>
		</div>

		{#if status?.queue?.length}
			<Card><CardHeader><CardTitle>Knowledge approval queue</CardTitle><CardDescription>Panel-side review for changes to existing authoritative Knowledge.</CardDescription></CardHeader><CardContent class="space-y-2">{#each status.queue as item}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><strong class="text-sm">{item.summary||'APEX Knowledge request'}</strong><Badge variant="outline">{item.status}</Badge></div>{#if item.reason}<p class="mt-1 text-xs text-muted-foreground">{item.reason}</p>{/if}</div>{/each}</CardContent></Card>
		{/if}

		{#if auth.isAdmin&&engineManageUrl}
			<Card><CardHeader><CardTitle>Engine Console</CardTitle><CardDescription>Administrator/owner technical console for runtime, hard configuration, queues, logs, diagnostics and client/backend monitoring.</CardDescription></CardHeader><CardContent><a href={engineManageUrl} target="_blank" rel="noreferrer"><Button variant="outline">Open APEX Engine Console <ExternalLink class="size-4"/></Button></a></CardContent></Card>
		{/if}
	{/if}
</div>
