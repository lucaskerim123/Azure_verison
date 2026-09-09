<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { page } from '$app/state';
	import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Badge } from '$lib/components/ui';
	import { Folder, LoaderCircle, Plus, Trash2, Pencil, X, Save, BrainCircuit, ListTree } from '@lucide/svelte';

	type Workspace = { id: string; name: string; permission: string; management_permissions?: Record<string, boolean> };
	type Project = { id: string; name: string; description?:string; instructions: string; ai_behaviour: string };
	type Bundle = { id: string; name: string; enabled: boolean };
	type BundleAssignment = { bundleId: string; name?: string; required: boolean };
	type KnowledgeProject = { id:string; name:string; description?:string };

	let workspaces = $state<Workspace[]>([]), workspaceId = $state(''), projects = $state<Project[]>([]), bundles = $state<Bundle[]>([]);
	let knowledgeProjects = $state<KnowledgeProject[]>([]), knowledgeItems = $state<any[]>([]);
	let bundleAssignments = $state<BundleAssignment[]>([]), loading = $state(true), saving = $state(false), error = $state(''), notice=$state('');
	let editingId = $state<string | null>(null);
	let form = $state({ name: '', description:'', instructions: '', aiBehaviour: '' });

	const knowledgeUrl=()=>workspaceId?`/knowledge-setup?workspace=${encodeURIComponent(workspaceId)}`:'/knowledge-setup';
	function resetForm(){editingId=null;bundleAssignments=[];form={name:'',description:'',instructions:'',aiBehaviour:''};}
	function matchingKnowledgeProject(project:Project){return knowledgeProjects.find((item)=>item.id===project.id||item.name.trim().toLowerCase()===project.name.trim().toLowerCase())||null;}
	function mappedKnowledgeCount(project:Project){const match=matchingKnowledgeProject(project);return match?knowledgeItems.filter((item)=>item.projectId===match.id).length:0;}

	async function loadProjects(){
		if(!workspaceId)return;loading=true;error='';
		try{
			const [projectData,bundleData,architectureData]=await Promise.all([
				api.get<{projects:Project[]}>(`/mcp/workspaces/${workspaceId}/projects`),
				api.get<{bundles:Bundle[]}>(`/mcp/workspaces/${workspaceId}/context-bundles`),
				api.get<any>(`/workspaces/${workspaceId}/knowledge-architecture`).catch(()=>({architecture:{}}))
			]);
			projects=projectData.projects||[];bundles=(bundleData.bundles||[]).filter((bundle)=>bundle.enabled);
			knowledgeProjects=architectureData.architecture?.projects||[];
			knowledgeItems=[...(architectureData.architecture?.globalItems||[]),...(architectureData.architecture?.projectItems||[])];
		}catch(err){error=err instanceof ApiError?err.message:'Failed to load MCP projects';}
		finally{loading=false;}
	}
	async function load(){
		const data=await api.get<{workspaces:Workspace[];canManageGlobal:boolean}>('/workspaces');
		workspaces=data.canManageGlobal?data.workspaces:data.workspaces.filter((ws)=>ws.permission==='owner'||!!ws.management_permissions?.manage_mcp_projects);
		const requested=page.url.searchParams.get('workspaceId')||'';
		workspaceId=workspaces.some((ws)=>ws.id===requested)?requested:(workspaces[0]?.id||'');
		await loadProjects();
	}
	async function edit(project:Project){
		editingId=project.id;form={name:project.name,description:project.description||'',instructions:project.instructions||'',aiBehaviour:project.ai_behaviour||''};notice='';
		try{bundleAssignments=(await api.get<{assignments:BundleAssignment[]}>(`/mcp/workspaces/${workspaceId}/projects/${project.id}/context-bundles`)).assignments||[];}
		catch(err){error=err instanceof ApiError?err.message:'Failed to load project bundles';}
	}
	function toggleBundle(bundle:Bundle){const exists=bundleAssignments.some((item)=>item.bundleId===bundle.id);bundleAssignments=exists?bundleAssignments.filter((item)=>item.bundleId!==bundle.id):[...bundleAssignments,{bundleId:bundle.id,name:bundle.name,required:true}];}
	async function saveProject(){
		if(!workspaceId||!form.name.trim())return;saving=true;error='';notice='';
		try{
			const payload={...form,items:[]};
			let saved:Project;
			if(editingId)saved=(await api.put<{project:Project}>(`/mcp/workspaces/${workspaceId}/projects/${editingId}`,payload)).project;
			else saved=(await api.post<{project:Project}>(`/mcp/workspaces/${workspaceId}/projects`,payload)).project;
			await api.put(`/mcp/workspaces/${workspaceId}/projects/${saved.id}/context-bundles`,{assignments:bundleAssignments});
			await api.post(`/mcp/workspaces/${workspaceId}/knowledge-project`,{project:{id:saved.id,name:saved.name,description:saved.description||form.description}});
			resetForm();await loadProjects();notice='Project saved and its Knowledge Architecture project definition is aligned. Library knowledge itself remains canonical and is not copied.';
		}catch(err){error=err instanceof Error?err.message:'Project save failed';}
		finally{saving=false;}
	}
	async function remove(projectId:string){
		const project=projects.find((item)=>item.id===projectId);if(!confirm('Delete this MCP project? Its Library knowledge will be moved back to workspace scope, not deleted.'))return;
		try{await api.delete(`/mcp/workspaces/${workspaceId}/projects/${projectId}`);await api.post(`/mcp/workspaces/${workspaceId}/knowledge-project`,{action:'delete',projectId,name:project?.name||''});if(editingId===projectId)resetForm();await loadProjects();notice='Project deleted. Any project-scoped knowledge was preserved and returned to workspace scope.';}catch(err){error=err instanceof Error?err.message:'Project delete failed';}
	}
	load().catch((err)=>{error=err instanceof ApiError?err.message:'Failed to load MCP projects';loading=false;});
</script>

<svelte:head><title>MCP Projects · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">MCP · Panel</p><h1 class="flex items-center gap-2 text-xl font-semibold"><Folder class="size-5"/>Projects</h1><p class="max-w-3xl text-sm text-muted-foreground">Projects define AI behaviour and startup instructions. Their project definition is kept aligned with Knowledge Setup, while canonical knowledge stays in Library and loads through CCS.</p></div><div class="flex gap-2"><a href={knowledgeUrl()}><Button variant="outline"><BrainCircuit class="size-4"/>Knowledge Setup</Button></a><a href="/mcp/ccs"><Button variant="outline"><ListTree class="size-4"/>CCS</Button></a></div></div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if notice}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>{/if}
	{#if workspaces.length===0}<Card><CardContent class="p-5 text-sm text-muted-foreground">No workspace with Manage MCP projects permission is available.</CardContent></Card>{:else}
		<Card><CardHeader><CardTitle>{editingId?'Edit project':'Create project'}</CardTitle><CardDescription>Project context comes from Library knowledge and CCS, never from raw server paths.</CardDescription></CardHeader><CardContent class="space-y-4">
			<label class="space-y-1 text-sm"><span>Workspace</span><select class="w-full rounded-md border bg-background p-2" bind:value={workspaceId} onchange={()=>{resetForm();loadProjects();}}>{#each workspaces as ws}<option value={ws.id}>{ws.name}</option>{/each}</select></label>
			<div class="grid gap-3 md:grid-cols-2"><label class="space-y-1 text-sm"><span>Name</span><Input placeholder="Project name" bind:value={form.name}/></label><label class="space-y-1 text-sm"><span>Description</span><Input placeholder="What this project is for" bind:value={form.description}/></label></div>
			<div class="grid gap-3 md:grid-cols-2"><label class="space-y-1 text-sm"><span>AI behaviour / custom instructions</span><textarea class="min-h-32 w-full rounded-md border bg-background p-2" bind:value={form.aiBehaviour}></textarea></label><label class="space-y-1 text-sm"><span>Startup instructions</span><textarea class="min-h-32 w-full rounded-md border bg-background p-2" bind:value={form.instructions}></textarea></label></div>
			<div class="space-y-2"><p class="text-sm font-medium">Context bundles</p><p class="text-xs text-muted-foreground">Attach CCS bundles containing Library knowledge and Profiles.</p><div class="grid gap-2 sm:grid-cols-2">{#each bundles as bundle}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span class="min-w-0 break-words">{bundle.name}</span><input type="checkbox" checked={bundleAssignments.some((item)=>item.bundleId===bundle.id)} onchange={()=>toggleBundle(bundle)}/></label>{/each}</div>{#if bundles.length===0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No enabled CCS bundles yet.</p>{/if}</div>
			<div class="flex flex-wrap gap-2"><Button onclick={saveProject} disabled={saving||!form.name.trim()}>{#if saving}<LoaderCircle class="size-4 animate-spin"/>{:else if editingId}<Save class="size-4"/>{:else}<Plus class="size-4"/>{/if}{editingId?'Save changes':'Create project'}</Button>{#if editingId}<Button variant="outline" onclick={resetForm}><X class="size-4"/>Cancel</Button>{/if}</div>
		</CardContent></Card>

		<Card><CardHeader><CardTitle>Workspace projects</CardTitle><CardDescription>Knowledge mapping is read from the shared Knowledge Architecture.</CardDescription></CardHeader><CardContent>
			{#if loading}<div class="flex justify-center py-10"><LoaderCircle class="size-5 animate-spin"/></div>{:else if projects.length===0}<p class="text-sm text-muted-foreground">No MCP projects in this workspace.</p>{:else}<div class="space-y-3">{#each projects as project}<div class="rounded-md border p-4 {editingId===project.id?'border-primary/70 bg-primary/5':''}"><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong>{project.name}</strong>{#if matchingKnowledgeProject(project)}<Badge variant="success">Knowledge aligned · {mappedKnowledgeCount(project)}</Badge>{:else}<Badge variant="secondary">Knowledge sync pending</Badge>{/if}</div>{#if project.description}<p class="mt-1 text-sm text-muted-foreground">{project.description}</p>{/if}<div class="mt-3 grid gap-3 md:grid-cols-2"><div><p class="text-xs font-medium uppercase text-muted-foreground">AI behaviour</p><p class="whitespace-pre-wrap text-sm">{project.ai_behaviour||'None'}</p></div><div><p class="text-xs font-medium uppercase text-muted-foreground">Startup instructions</p><p class="whitespace-pre-wrap text-sm">{project.instructions||'None'}</p></div></div></div><div class="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label="Edit project" onclick={()=>edit(project)}><Pencil class="size-4"/></Button><Button variant="ghost" size="icon" aria-label="Delete project" onclick={()=>remove(project.id)}><Trash2 class="size-4"/></Button></div></div></div>{/each}</div>{/if}
		</CardContent></Card>
	{/if}
</div>
