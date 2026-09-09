<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { CheckCircle2, ExternalLink, LoaderCircle, Plug, RefreshCw, ShieldCheck, Users, XCircle } from '@lucide/svelte';

	type AccessWorkspace = {
		id:string; name:string; permission:string; status:string;
		systemEnabled:boolean; workspaceEnabled:boolean; permissionAllowed:boolean; memberEnabled:boolean;
		mcpAllowed:boolean; reason:string;
	};
	type Member = { user_id:string; username:string; permission:string; system_role?:string; mcp_enabled?:boolean };
	type Detail = {
		workspace:{id:string;name:string;status:string;systemEnabled:boolean;workspaceEnabled:boolean};
		currentUser:{id:string;username:string;role:string;memberEnabled:boolean;permissionAllowed:boolean;allowed:boolean;reason:string};
		members:Member[]; canManageWorkspace:boolean; canManageMembers:boolean; engineHost:string; resource:string;
	};

	let workspaces=$state<AccessWorkspace[]>([]), selectedId=$state(''), detail=$state<Detail|null>(null);
	let loading=$state(true), busy=$state(''), error=$state(''), notice=$state('');
	const reasonLabel=(reason:string)=>({
		allowed:'Ready for MCP', workspace_not_active:'Workspace is not active', mcp_system_blocked:'System MCP is blocked',
		workspace_mcp_disabled:'Workspace MCP is disabled', mcp_use_permission_denied:'mcp_use permission is denied',
		member_mcp_disabled:'Member MCP access is disabled'
	}[reason]||reason.replaceAll('_',' '));
	const selected=()=>workspaces.find((item)=>item.id===selectedId)||null;

	async function loadDetail(id=selectedId){
		if(!id){detail=null;return;}
		detail=await api.get<Detail>(`/mcp/workspaces/${encodeURIComponent(id)}/access`);
	}
	async function load(){
		loading=true;error='';
		try{
			const summary=await api.get<{workspaces:AccessWorkspace[]}>('/mcp/access');
			workspaces=summary.workspaces||[];
			if(!selectedId||!workspaces.some((item)=>item.id===selectedId)) selectedId=workspaces.find((item)=>item.mcpAllowed)?.id||workspaces[0]?.id||'';
			await loadDetail();
		}catch(err){error=err instanceof ApiError?err.message:err instanceof Error?err.message:'Could not load MCP access';}
		finally{loading=false;}
	}
	async function choose(id:string){selectedId=id;notice='';error='';try{await loadDetail(id);}catch(err){error=err instanceof Error?err.message:'Could not load workspace access';}}
	async function patch(body:any,key:string){
		if(!selectedId)return;busy=key;error='';notice='';
		try{
			detail=await api.patch<Detail>(`/mcp/workspaces/${encodeURIComponent(selectedId)}/access`,body);
			const summary=await api.get<{workspaces:AccessWorkspace[]}>('/mcp/access');workspaces=summary.workspaces||[];
			notice='MCP access updated.';
		}catch(err){error=err instanceof ApiError?err.message:err instanceof Error?err.message:'MCP access update failed';}
		finally{busy='';}
	}
	onMount(load);
</script>

<svelte:head><title>MCP Access & Workspaces · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div><p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">MCP · Panel</p><h1 class="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck class="size-6"/>Access & Workspaces</h1><p class="mt-1 max-w-3xl text-sm text-muted-foreground">One place to see exactly why a workspace is or is not available to MCP and ChatGPT. All required gates must pass.</p></div>
		<div class="flex gap-2"><Button variant="outline" onclick={load} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button><a href="https://orbitfsengine.vercel.app/engines/mcp" target="_blank" rel="noreferrer"><Button variant="outline">Engine Host <ExternalLink class="size-4"/></Button></a></div>
	</div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if notice}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>{/if}
	{#if loading}<Card><CardContent class="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle class="size-5 animate-spin"/>Loading workspace access…</CardContent></Card>
	{:else if workspaces.length===0}<Card><CardContent class="p-8 text-center text-sm text-muted-foreground">No accessible workspaces were found for this account.</CardContent></Card>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
			<Card class="h-fit"><CardHeader><CardTitle>Workspaces</CardTitle><CardDescription>{workspaces.filter((item)=>item.mcpAllowed).length} usable · {workspaces.length} visible</CardDescription></CardHeader><CardContent class="space-y-2">{#each workspaces as item}<button class="w-full rounded-lg border p-3 text-left {selectedId===item.id?'border-primary bg-primary/5':'hover:bg-muted/30'}" onclick={()=>choose(item.id)}><div class="flex items-start justify-between gap-2"><div class="min-w-0"><strong class="block truncate text-sm">{item.name}</strong><span class="text-xs text-muted-foreground">{item.permission} · {reasonLabel(item.reason)}</span></div>{#if item.mcpAllowed}<CheckCircle2 class="size-4 shrink-0 text-emerald-500"/>{:else}<XCircle class="size-4 shrink-0 text-muted-foreground"/>{/if}</div></button>{/each}</CardContent></Card>

			<div class="space-y-4">
				{#if detail}
					<Card><CardHeader><div class="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{detail.workspace.name}</CardTitle><CardDescription>Final MCP result is calculated from the workspace, permission and member gates below.</CardDescription></div><Badge variant={detail.currentUser.allowed?'success':'secondary'}>{detail.currentUser.allowed?'Usable in MCP':'Blocked'}</Badge></div></CardHeader><CardContent class="space-y-4">
						<div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
							<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">System MCP</p><p class="mt-1 font-medium">{detail.workspace.systemEnabled?'Allowed':'Blocked'}</p></div>
							<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Workspace MCP</p><p class="mt-1 font-medium">{detail.workspace.workspaceEnabled?'Enabled':'Disabled'}</p></div>
							<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">mcp_use permission</p><p class="mt-1 font-medium">{detail.currentUser.permissionAllowed?'Allowed':'Denied'}</p></div>
							<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Member MCP</p><p class="mt-1 font-medium">{detail.currentUser.memberEnabled?'Enabled':'Disabled'}</p></div>
						</div>
						<div class="rounded-lg border p-3 text-sm"><strong>Current result</strong><p class="mt-1 text-muted-foreground">{reasonLabel(detail.currentUser.reason)}</p></div>
						{#if detail.canManageWorkspace}<div class="flex flex-wrap gap-2"><Button onclick={()=>patch({workspaceEnabled:!detail?.workspace.workspaceEnabled},'workspace')} disabled={busy==='workspace'||!detail.workspace.systemEnabled}>{detail.workspace.workspaceEnabled?'Disable Workspace MCP':'Enable Workspace MCP'}</Button>{#if !detail.workspace.systemEnabled}<span class="self-center text-xs text-muted-foreground">System MCP must be allowed from Workspace Manager first.</span>{/if}</div>{/if}
					</CardContent></Card>

					<Card><CardHeader><div class="flex items-center gap-2"><Users class="size-5"/><div><CardTitle>Member MCP access</CardTitle><CardDescription>Member MCP is an explicit gate in addition to the workspace role's mcp_use permission.</CardDescription></div></div></CardHeader><CardContent class="space-y-2">
						{#each detail.members as member}<div class="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><strong class="text-sm">{member.username}</strong><p class="text-xs text-muted-foreground">{member.permission}{member.system_role&&member.system_role!=='user'?` · ${member.system_role}`:''}</p></div><div class="flex items-center gap-2"><Badge variant={member.mcp_enabled?'success':'secondary'}>{member.mcp_enabled?'MCP enabled':'MCP disabled'}</Badge>{#if detail.canManageMembers}<Button size="sm" variant="outline" onclick={()=>patch({memberUserId:member.user_id,memberEnabled:!member.mcp_enabled},`member-${member.user_id}`)} disabled={busy===`member-${member.user_id}`}>{member.mcp_enabled?'Disable':'Enable'}</Button>{/if}</div></div>{/each}
						{#if detail.members.length===0}<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No member records are visible.</p>{/if}
					</CardContent></Card>

					<Card><CardHeader><CardTitle>What ChatGPT needs</CardTitle><CardDescription>The Panel and Engine Host should agree on these same gates.</CardDescription></CardHeader><CardContent class="grid gap-2 text-sm md:grid-cols-5"><div class="rounded-md border p-3"><b>1</b><p class="text-muted-foreground">Workspace active</p></div><div class="rounded-md border p-3"><b>2</b><p class="text-muted-foreground">System MCP allowed</p></div><div class="rounded-md border p-3"><b>3</b><p class="text-muted-foreground">Workspace MCP enabled</p></div><div class="rounded-md border p-3"><b>4</b><p class="text-muted-foreground">mcp_use allowed</p></div><div class="rounded-md border p-3"><b>5</b><p class="text-muted-foreground">Member MCP enabled</p></div></CardContent></Card>
				{/if}
			</div>
		</div>
	{/if}
</div>
