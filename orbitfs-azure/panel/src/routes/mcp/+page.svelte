<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { workspace } from '$lib/workspace.svelte';
	import { auth } from '$lib/auth.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { BookOpen, BrainCircuit, ExternalLink, Folder, Library, ListTree, Plug, Settings, ShieldCheck, Sparkles } from '@lucide/svelte';

	let addon:any=$state(null),health:any=$state(null),access:any=$state(null),readiness:any=$state(null),error=$state(''),loading=$state(true);
	const currentId=()=>workspace.currentId||workspace.current?.id||'';
	const withWorkspace=(path:string)=>currentId()?`${path}?workspaceId=${encodeURIComponent(currentId())}`:path;
	const knowledgeLink=()=>currentId()?`/knowledge-setup?workspace=${encodeURIComponent(currentId())}`:'/knowledge-setup';
	const libraryLink=()=>currentId()?`/library?workspace=${encodeURIComponent(currentId())}`:'/library';
	const engineManageUrl=$derived(String(addon?.engineManageUrl||''));
	const engineConnectionsUrl=$derived(engineManageUrl?`${engineManageUrl}/connections`:'');

	async function refresh(){
		loading=true;error='';readiness=null;
		try{
			if(!workspace.loaded)await workspace.load();
			const [status,accessData]=await Promise.all([
				api.get<any>('/addons/status'),
				api.get<any>('/mcp/access').catch(()=>null)
			]);
			addon=(status.addons||[]).find((item:any)=>item.id==='mcp')||null;
			access=(accessData?.workspaces||[]).find((item:any)=>item.id===currentId())||null;
			if(currentId()){
				[health,readiness]=await Promise.all([
					api.get<any>(`/workspaces/${encodeURIComponent(currentId())}/knowledge-architecture/health`).catch(()=>null),
					api.get<any>(`/mcp/workspaces/${encodeURIComponent(currentId())}/readiness`).catch(()=>null)
				]);
			}
		}catch(err){error=err instanceof Error?err.message:'Unable to load MCP workspace status';}
		finally{loading=false;}
	}
	onMount(refresh);
</script>

<svelte:head><title>MCP · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">MCP · PANEL</p>
			<h1 class="flex items-center gap-2 text-2xl font-semibold"><Plug class="size-6"/>OrbitFS MCP</h1>
			<p class="mt-1 max-w-3xl text-sm text-muted-foreground">Normal MCP setup and workspace controls live here: Access, OSS, Projects, CCS, Context Library, Startup and MCP settings. Engine Console is only for backend runtime, OAuth/client internals, diagnostics and monitoring.</p>
		</div>
		{#if auth.isAdmin&&engineManageUrl}<a href={engineManageUrl} target="_blank" rel="noreferrer"><Button variant="outline">Engine Console <ExternalLink class="size-4"/></Button></a>{/if}
	</div>

	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}

	<Card>
		<CardHeader><CardTitle>Workspace</CardTitle><CardDescription>MCP configuration is workspace-scoped and follows the same permissions as the rest of OrbitFS.</CardDescription></CardHeader>
		<CardContent class="flex flex-wrap items-center gap-3">
			<select class="min-w-64 rounded-md border bg-background px-3 py-2 text-sm" value={currentId()} onchange={async(e)=>{workspace.select(e.currentTarget.value);await refresh();}}>
				{#each workspace.workspaces as item}<option value={item.id}>{item.name}</option>{/each}
			</select>
			{#if addon}<Badge variant={addon.attached?'success':'secondary'}>{addon.attached?'Attached':'Not attached'}</Badge><Badge variant={addon.setupComplete?'success':'secondary'}>{addon.setupComplete?'Ready':'Engine setup required'}</Badge>{/if}
			{#if access}<Badge variant={access.mcpAllowed?'success':'secondary'}>{access.mcpAllowed?'MCP access ready':'MCP access blocked'}</Badge>{/if}
			{#if health?.setup}<Badge variant={health.setup.ok?'success':'secondary'}>Knowledge rev {health.setup.revision||0}</Badge>{/if}
		</CardContent>
	</Card>

	{#if readiness}
		<Card>
			<CardHeader><div class="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Workspace readiness</CardTitle><CardDescription>Panel-side MCP access and context setup.</CardDescription></div><Badge variant={readiness.status==='blocked'?'destructive':readiness.status==='ready'?'success':'secondary'}>{readiness.status==='blocked'?'Blocked':readiness.status==='ready'?'Ready':'Ready · recommendations'}</Badge></div></CardHeader>
			<CardContent class="space-y-4">
				<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
					<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">Access</span><p class="mt-1 font-medium">{readiness.access?.ready?'Ready':'Blocked'}</p></div>
					<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">Knowledge</span><p class="mt-1 font-medium">{readiness.knowledge?.ready?'Ready':'Needs setup'}</p></div>
					<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">CCS bundles</span><p class="mt-1 font-medium">{readiness.context?.bundles?.enabled||0} enabled</p></div>
					<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">Projects</span><p class="mt-1 font-medium">{readiness.context?.projects?.total||0}</p></div>
					<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">OSS</span><p class="mt-1 font-medium">{readiness.startup?.configured?'Configured':'Not configured'}</p></div>
				</div>
				{#if readiness.blockers?.length}<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3"><strong class="text-sm">Must fix</strong><ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{#each readiness.blockers as item}<li>{item}</li>{/each}</ul></div>{/if}
				{#if readiness.recommendations?.length}<div class="rounded-lg border p-3"><strong class="text-sm">Recommended</strong><ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{#each readiness.recommendations as item}<li>{item}</li>{/each}</ul></div>{/if}
			</CardContent>
		</Card>
	{/if}

	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
		<a href="/mcp/access" class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><ShieldCheck class="size-5 text-primary"/><CardTitle>Access & Workspaces</CardTitle><CardDescription>Control which users and workspaces can use MCP.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Manage access →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/oss')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Sparkles class="size-5 text-primary"/><CardTitle>Startup System (OSS)</CardTitle><CardDescription>Choose startup strength, projects, profiles, bundles and startup behaviour.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Manage OSS →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/projects')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Folder class="size-5 text-primary"/><CardTitle>Projects</CardTitle><CardDescription>Project instructions, AI behaviour and project-linked context.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Manage projects →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/ccs')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><ListTree class="size-5 text-primary"/><CardTitle>Context Bundles (CCS)</CardTitle><CardDescription>Build reusable context groups from Library knowledge and Profiles.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Manage CCS →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/context-library')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Library class="size-5 text-primary"/><CardTitle>Context Library</CardTitle><CardDescription>Browse and manage reusable MCP context from Panel-owned data.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open Context Library →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/startup')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><BookOpen class="size-5 text-primary"/><CardTitle>Startup Defaults</CardTitle><CardDescription>Default startup selections and startup-specific MCP behaviour.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open Startup →</span></CardContent></Card></a>
		<a href={withWorkspace('/mcp/system')} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Settings class="size-5 text-primary"/><CardTitle>MCP Settings</CardTitle><CardDescription>Workspace MCP behaviour, search/context settings and normal user-facing configuration.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open settings →</span></CardContent></Card></a>
		<a href={libraryLink()} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><Library class="size-5 text-primary"/><CardTitle>Library</CardTitle><CardDescription>Canonical workspace knowledge and Profiles.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Open Library →</span></CardContent></Card></a>
		<a href={knowledgeLink()} class="block"><Card class="h-full transition-colors hover:bg-muted/30"><CardHeader><BrainCircuit class="size-5 text-primary"/><CardTitle>Knowledge Setup</CardTitle><CardDescription>Authority, scope, lifecycle, routing and priority for MCP knowledge.</CardDescription></CardHeader><CardContent><span class="text-sm font-medium">Configure knowledge →</span></CardContent></Card></a>
	</div>

	{#if auth.isAdmin&&engineManageUrl}
		<Card><CardHeader><CardTitle>Engine Console</CardTitle><CardDescription>Owner/admin technical console only: MCP transport, OAuth clients, sessions, runtime controls, logs, diagnostics and backend monitoring.</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><a href={engineManageUrl} target="_blank" rel="noreferrer"><Button variant="outline">Open MCP Engine Console <ExternalLink class="size-4"/></Button></a>{#if engineConnectionsUrl}<a href={engineConnectionsUrl} target="_blank" rel="noreferrer"><Button variant="outline">Connections <ExternalLink class="size-4"/></Button></a>{/if}</CardContent></Card>
	{/if}
</div>
