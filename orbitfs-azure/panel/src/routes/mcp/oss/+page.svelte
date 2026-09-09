<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { page } from '$app/state';
	import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '$lib/components/ui';
	import { BrainCircuit, Library, ListTree, LoaderCircle, Save } from '@lucide/svelte';

	const presetKeys=['low','medium','high','custom1','custom2'] as const;
	type PresetKey=typeof presetKeys[number];
	type Workspace={id:string;name:string;permission:string;management_permissions?:Record<string,boolean>};
	type Project={id:string;name:string};
	type Profile={id:string;name:string;type?:string};
	type ProfileBundle={id:string;name:string;description?:string;profileIds:string[]};
	type Bundle={id:string;name:string;enabled:boolean;entryCount?:number};
	type BundleAssignment={bundleId:string;name?:string;required:boolean};
	type Preset={projectId:string|null;profileIds:string[];profileBundleIds:string[]};
	type PresetMetadata={preset:PresetKey;displayName:string;defaultDisplayName:string};

	const defaultName=(key:PresetKey)=>key==='custom1'?'Custom 1':key==='custom2'?'Custom 2':key[0].toUpperCase()+key.slice(1);
	const blankPresets=()=>Object.fromEntries(presetKeys.map((key)=>[key,{projectId:null,profileIds:[],profileBundleIds:[]}])) as Record<PresetKey,Preset>;
	const blankAssignments=()=>Object.fromEntries(presetKeys.map((key)=>[key,[]])) as Record<PresetKey,BundleAssignment[]>;
	const blankMetadata=()=>Object.fromEntries(presetKeys.map((key)=>[key,{preset:key,displayName:defaultName(key),defaultDisplayName:defaultName(key)}])) as Record<PresetKey,PresetMetadata>;

	let workspaces=$state<Workspace[]>([]),workspaceId=$state(''),projects=$state<Project[]>([]),profiles=$state<Profile[]>([]),profileBundles=$state<ProfileBundle[]>([]),bundles=$state<Bundle[]>([]);
	let canManageGlobal=$state(false),activePreset=$state<PresetKey>('medium'),startupStrength=$state<PresetKey>('medium'),startupInstructions=$state(''),startupAiBehaviour=$state(''),startupProjectIds=$state<string[]>([]);
	let defaultProfileIds=$state<string[]>([]),defaultProfileBundleIds=$state<string[]>([]),presets=$state<Record<PresetKey,Preset>>(blankPresets()),bundleAssignments=$state<Record<PresetKey,BundleAssignment[]>>(blankAssignments()),presetMetadata=$state<Record<PresetKey,PresetMetadata>>(blankMetadata());
	let legacyDefaultCount=$state(0),legacyPresetCount=$state(0),loading=$state(true),saving=$state(false),error=$state(''),notice=$state(''),knowledgeHealth:any=$state(null);

	const selectedWorkspace=()=>workspaces.find((item)=>item.id===workspaceId);
	const canManageStartup=()=>canManageGlobal||selectedWorkspace()?.permission==='owner'||!!selectedWorkspace()?.management_permissions?.manage_mcp_startup;
	const canManageNames=()=>canManageGlobal||selectedWorkspace()?.permission==='owner'||!!selectedWorkspace()?.management_permissions?.manage_mcp_preset_names;
	const presetLabel=(key:PresetKey)=>presetMetadata[key]?.displayName||defaultName(key);
	const knowledgeUrl=()=>workspaceId?`/knowledge-setup?workspace=${encodeURIComponent(workspaceId)}`:'/knowledge-setup';
	const libraryUrl=()=>workspaceId?`/library?workspace=${encodeURIComponent(workspaceId)}`:'/library';
	function toggle(list:string[],id:string){return list.includes(id)?list.filter((item)=>item!==id):[...list,id];}
	function toggleBundle(bundle:Bundle){const current=bundleAssignments[activePreset];const exists=current.some((item)=>item.bundleId===bundle.id);bundleAssignments={...bundleAssignments,[activePreset]:exists?current.filter((item)=>item.bundleId!==bundle.id):[...current,{bundleId:bundle.id,name:bundle.name,required:true}]};}

	async function loadWorkspace(){
		if(!workspaceId)return;loading=true;error='';notice='';
		try{
			const [projectData,startupData,presetData,bundleData,assignmentData,profileData,metadataData,healthData]=await Promise.all([
				api.get<any>(`/mcp/workspaces/${workspaceId}/projects`),
				api.get<any>(`/mcp/workspaces/${workspaceId}/startup`),
				api.get<any>(`/mcp/workspaces/${workspaceId}/presets`),
				api.get<any>(`/mcp/workspaces/${workspaceId}/context-bundles`),
				api.get<any>(`/mcp/workspaces/${workspaceId}/preset-bundles`),
				api.get<any>(`/profiles/${workspaceId}/catalog`),
				api.get<any>(`/mcp/workspaces/${workspaceId}/preset-metadata`),
				api.get<any>(`/workspaces/${workspaceId}/knowledge-architecture/health`).catch(()=>null)
			]);
			projects=projectData.projects||[];bundles=(bundleData.bundles||[]).filter((item:Bundle)=>item.enabled);profiles=profileData.profiles||[];profileBundles=profileData.profileBundles||[];knowledgeHealth=healthData;
			startupStrength=(startupData.startup?.strength||'medium') as PresetKey;startupInstructions=startupData.startup?.instructions||'';startupAiBehaviour=startupData.startup?.aiBehaviour||'';startupProjectIds=startupData.startup?.projectIds||[];defaultProfileIds=startupData.startup?.defaultProfileIds||[];defaultProfileBundleIds=startupData.startup?.defaultProfileBundleIds||[];legacyDefaultCount=(startupData.startup?.defaultItems||[]).length;
			legacyPresetCount=0;presets=blankPresets();for(const key of presetKeys){const stored=presetData.presets?.[key]||{};legacyPresetCount+=(stored.items||[]).length;presets[key]={projectId:stored.projectId||null,profileIds:stored.profileIds||[],profileBundleIds:stored.profileBundleIds||[]};}
			bundleAssignments=Object.fromEntries(presetKeys.map((key)=>[key,assignmentData.assignments?.[key]||[]])) as Record<PresetKey,BundleAssignment[]>;
			presetMetadata=Object.fromEntries(presetKeys.map((key)=>[key,metadataData.metadata?.[key]||blankMetadata()[key]])) as Record<PresetKey,PresetMetadata>;
		}catch(err){error=err instanceof ApiError?err.message:'Failed to load OSS';}
		finally{loading=false;}
	}
	async function load(){const data=await api.get<{workspaces:Workspace[];canManageGlobal:boolean}>('/workspaces');canManageGlobal=data.canManageGlobal===true;workspaces=canManageGlobal?data.workspaces:data.workspaces.filter((ws)=>ws.permission==='owner'||!!ws.management_permissions?.manage_mcp_startup||!!ws.management_permissions?.manage_mcp_preset_names);const requested=page.url.searchParams.get('workspaceId')||'';workspaceId=workspaces.some((ws)=>ws.id===requested)?requested:(workspaces[0]?.id||'');await loadWorkspace();}
	async function saveAll(){
		if(!workspaceId)return;saving=true;error='';notice='';
		try{
			const tasks:Promise<unknown>[]=[];
			if(canManageStartup()){
				tasks.push(api.put(`/mcp/workspaces/${workspaceId}/startup`,{strength:startupStrength,instructions:startupInstructions,aiBehaviour:startupAiBehaviour,projectIds:startupProjectIds}));
				tasks.push(api.put(`/mcp/workspaces/${workspaceId}/default-items`,{items:[]}));
				tasks.push(api.put(`/mcp/workspaces/${workspaceId}/default-profiles`,{profileIds:defaultProfileIds,profileBundleIds:defaultProfileBundleIds}));
				tasks.push(api.put(`/mcp/workspaces/${workspaceId}/presets`,{presets:Object.fromEntries(presetKeys.map((key)=>[key,{...presets[key],items:[]}]))}));
				tasks.push(api.put(`/mcp/workspaces/${workspaceId}/preset-bundles`,{assignments:bundleAssignments}));
			}
			if(canManageNames())tasks.push(api.put(`/mcp/workspaces/${workspaceId}/preset-metadata`,{metadata:presetMetadata}));
			const results=await Promise.allSettled(tasks);const failed=results.filter((item)=>item.status==='rejected');if(failed.length)throw (failed[0] as PromiseRejectedResult).reason;
			await loadWorkspace();notice='OSS saved. Startup now uses Projects, Profiles and CCS bundles; legacy direct path loading has been retired.';
		}catch(err){error=err instanceof Error?err.message:'Failed to save OSS';}
		finally{saving=false;}
	}
	load().catch((err)=>{error=err instanceof ApiError?err.message:'Failed to load workspaces';loading=false;});
</script>

<svelte:head><title>OSS · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">MCP · Panel</p><h1 class="flex items-center gap-2 text-xl font-semibold"><ListTree class="size-5"/>OrbitFS Startup System (OSS)</h1><p class="max-w-3xl text-sm text-muted-foreground">Choose what MCP loads at startup. In v2, OSS selects Projects, Profiles and CCS bundles; canonical knowledge comes from Library / Knowledge Setup.</p></div><div class="flex gap-2"><a href={libraryUrl()}><Button variant="outline"><Library class="size-4"/>Library</Button></a><a href={knowledgeUrl()}><Button variant="outline"><BrainCircuit class="size-4"/>Knowledge Setup</Button></a></div></div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if notice}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>{/if}
	{#if legacyDefaultCount+legacyPresetCount>0}<div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><div class="flex items-center gap-2"><Badge variant="secondary">Legacy</Badge><b>{legacyDefaultCount+legacyPresetCount} direct file/folder startup reference(s) detected</b></div><p class="mt-1 text-muted-foreground">The cloud version does not load server filesystem paths. Saving OSS v2 will clear those path references; move the knowledge into Library/CCS first if it still matters.</p></div>{/if}
	{#if workspaces.length===0}<Card><CardContent class="p-5 text-sm text-muted-foreground">No workspace with MCP startup permissions is available.</CardContent></Card>{:else}
		<Card><CardHeader><CardTitle>Workspace startup</CardTitle><CardDescription>These settings apply whenever MCP startup is explicitly run for this workspace.</CardDescription></CardHeader><CardContent class="space-y-4">
			<label class="space-y-1 text-sm"><span>Workspace</span><select class="w-full rounded-md border bg-background p-2" bind:value={workspaceId} onchange={loadWorkspace}>{#each workspaces as ws}<option value={ws.id}>{ws.name}</option>{/each}</select></label>
			<div class="grid gap-3 md:grid-cols-3"><label class="space-y-1 text-sm"><span>Startup strength</span><select class="w-full rounded-md border bg-background p-2" bind:value={startupStrength} disabled={!canManageStartup()}>{#each presetKeys as key}<option value={key}>{presetLabel(key)}</option>{/each}</select></label><div class="rounded-md border p-3 text-sm"><b>Knowledge architecture</b><p class="text-xs text-muted-foreground">{knowledgeHealth?.setup?.ok?`Ready · revision ${knowledgeHealth.setup.revision||0}`:'Not completed yet'}</p></div><div class="rounded-md border p-3 text-sm"><b>CCS bundles</b><p class="text-xs text-muted-foreground">{bundles.length} enabled bundle(s)</p></div></div>
			<div class="grid gap-3 md:grid-cols-2"><label class="space-y-1 text-sm"><span>AI behaviour</span><textarea class="min-h-28 w-full rounded-md border bg-background p-2" bind:value={startupAiBehaviour} disabled={!canManageStartup()}></textarea></label><label class="space-y-1 text-sm"><span>Startup instructions</span><textarea class="min-h-28 w-full rounded-md border bg-background p-2" bind:value={startupInstructions} disabled={!canManageStartup()}></textarea></label></div>
			<div class="space-y-2"><p class="text-sm font-medium">Projects loaded at startup</p><div class="grid gap-2 sm:grid-cols-2">{#each projects as project}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{project.name}</span><input type="checkbox" checked={startupProjectIds.includes(project.id)} onchange={()=>startupProjectIds=toggle(startupProjectIds,project.id)} disabled={!canManageStartup()}/></label>{/each}</div>{#if projects.length===0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No MCP projects yet.</p>{/if}</div>
			<div class="space-y-2"><p class="text-sm font-medium">Default Profiles</p><p class="text-xs text-muted-foreground">Profiles can load directly. Knowledge should come through CCS so it follows Library lifecycle and routing.</p><div class="grid gap-2 sm:grid-cols-2">{#each profileBundles as group}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span><b>{group.name}</b><small class="block text-muted-foreground">Profile group · {group.profileIds.length}</small></span><input type="checkbox" checked={defaultProfileBundleIds.includes(group.id)} onchange={()=>defaultProfileBundleIds=toggle(defaultProfileBundleIds,group.id)} disabled={!canManageStartup()}/></label>{/each}{#each profiles as profile}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{profile.name}</span><input type="checkbox" checked={defaultProfileIds.includes(profile.id)} onchange={()=>defaultProfileIds=toggle(defaultProfileIds,profile.id)} disabled={!canManageStartup()}/></label>{/each}</div></div>
		</CardContent></Card>

		<Card><CardHeader><CardTitle>Startup presets</CardTitle><CardDescription>Each ChatGPT startup level chooses a project, optional Profiles and CCS bundles. No file/folder paths.</CardDescription></CardHeader><CardContent class="space-y-5">
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">{#each presetKeys as key}<Button variant={activePreset===key?'default':'outline'} onclick={()=>activePreset=key}>{presetLabel(key)}</Button>{/each}</div>
			<div class="grid gap-3 md:grid-cols-2"><label class="space-y-1 text-sm"><span>Button name</span><input class="w-full rounded-md border bg-background p-2" maxlength="40" bind:value={presetMetadata[activePreset].displayName} disabled={!canManageNames()}/></label><label class="space-y-1 text-sm"><span>Project</span><select class="w-full rounded-md border bg-background p-2" bind:value={presets[activePreset].projectId} disabled={!canManageStartup()}><option value={null}>No project</option>{#each projects as project}<option value={project.id}>{project.name}</option>{/each}</select></label></div>
			<div class="space-y-2"><p class="text-sm font-medium">CCS bundles</p><p class="text-xs text-muted-foreground">This is where Library knowledge is attached to the preset.</p><div class="grid gap-2 sm:grid-cols-2">{#each bundles as bundle}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span><b>{bundle.name}</b><small class="block text-muted-foreground">{bundle.entryCount||0} context entries</small></span><input type="checkbox" checked={bundleAssignments[activePreset].some((item)=>item.bundleId===bundle.id)} onchange={()=>toggleBundle(bundle)} disabled={!canManageStartup()}/></label>{/each}</div>{#if bundles.length===0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No enabled CCS bundles are available.</p>{/if}</div>
			<div class="space-y-2"><p class="text-sm font-medium">Preset Profiles</p><div class="grid gap-2 sm:grid-cols-2">{#each profileBundles as group}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span><b>{group.name}</b><small class="block text-muted-foreground">Profile group</small></span><input type="checkbox" checked={presets[activePreset].profileBundleIds.includes(group.id)} onchange={()=>presets={...presets,[activePreset]:{...presets[activePreset],profileBundleIds:toggle(presets[activePreset].profileBundleIds,group.id)}}} disabled={!canManageStartup()}/></label>{/each}{#each profiles as profile}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{profile.name}</span><input type="checkbox" checked={presets[activePreset].profileIds.includes(profile.id)} onchange={()=>presets={...presets,[activePreset]:{...presets[activePreset],profileIds:toggle(presets[activePreset].profileIds,profile.id)}}} disabled={!canManageStartup()}/></label>{/each}</div></div>
		</CardContent></Card>
		<div class="flex justify-end"><Button onclick={saveAll} disabled={saving||loading||(!canManageStartup()&&!canManageNames())}>{#if saving}<LoaderCircle class="size-4 animate-spin"/>{:else}<Save class="size-4"/>{/if}Save OSS</Button></div>
	{/if}
</div>
