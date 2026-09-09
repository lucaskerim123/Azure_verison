<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { page } from '$app/state';
	import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Badge } from '$lib/components/ui';
	import { BookOpen, BrainCircuit, LoaderCircle, Pencil, Plus, Save, Trash2, X } from '@lucide/svelte';

	type Workspace={id:string;name:string;permission:string;management_permissions?:Record<string,boolean>};
	type Entry={type:'file'|'folder'|'knowledge';path:string;recursive:boolean;required:boolean;priority:number;attachmentType?:'path'|'profile'|'knowledge';profileId?:string|null;profileName?:string|null;knowledgeItemId?:string|null;knowledgeItemName?:string|null;loadMode?:string|null};
	type Dependency={bundleId:string;name?:string;required:boolean};
	type Profile={id:string;name:string;restricted?:boolean};
	type KnowledgeItem={id:string;name:string;kind:string;roles?:string[];lifecycleState?:string;status?:string;source?:{provider?:string}};
	type Bundle={id:string;name:string;description:string;enabled:boolean;version:number;entryCount?:number;dependencyCount?:number;entries?:Entry[];dependencies?:Dependency[]};
	let {workspaceIdOverride='',hideWorkspacePicker=false}=$props<{workspaceIdOverride?:string;hideWorkspacePicker?:boolean}>();

	let workspaces=$state<Workspace[]>([]),workspaceId=$state(''),bundles=$state<Bundle[]>([]),profiles=$state<Profile[]>([]),knowledgeItems=$state<KnowledgeItem[]>([]);
	let loading=$state(true),saving=$state(false),error=$state(''),savedMessage=$state(''),editingId=$state<string|null>(null);
	let selectedProfileId=$state(''),selectedKnowledgeId=$state('');
	let form=$state({name:'',description:'',enabled:true,entries:[] as Entry[],dependencies:[] as Dependency[]});
	const canonicalProviders=new Set(['library.native','memory.knowledge','base.profiles']);
	const legacyEntries=$derived(form.entries.filter((entry)=>entry.attachmentType!=='knowledge'&&entry.attachmentType!=='profile'));
	const knowledgeEntries=$derived(form.entries.filter((entry)=>entry.attachmentType==='knowledge'));
	const profileEntries=$derived(form.entries.filter((entry)=>entry.attachmentType==='profile'));
	const knowledgeSetupUrl=()=>workspaceId?`/knowledge-setup?workspace=${encodeURIComponent(workspaceId)}`:'/knowledge-setup';

	function applyBundle(bundle:Bundle){editingId=bundle.id;form={name:bundle.name,description:bundle.description||'',enabled:bundle.enabled!==false,entries:(bundle.entries||[]).map((entry)=>({...entry,attachmentType:entry.attachmentType||'path'})),dependencies:(bundle.dependencies||[]).map((dep)=>({...dep}))};}
	function reset(){editingId=null;selectedProfileId='';selectedKnowledgeId='';savedMessage='';form={name:'',description:'',enabled:true,entries:[],dependencies:[]};}
	async function loadBundles(){
		if(!workspaceId)return;loading=true;error='';
		try{
			const [bundleData,profileData,libraryData]=await Promise.all([
				api.get<{bundles:Bundle[]}>(`/mcp/workspaces/${workspaceId}/context-bundles`),
				api.get<{profiles?:Profile[]}>(`/profiles/${workspaceId}/catalog`),
				api.get<{items?:KnowledgeItem[]}>(`/library/workspaces/${workspaceId}`)
			]);
			bundles=bundleData.bundles||[];profiles=profileData.profiles||[];
			knowledgeItems=(libraryData.items||[]).filter((item)=>item.status!=='archived'&&canonicalProviders.has(String(item.source?.provider||'')));
		}catch(err){error=err instanceof ApiError?err.message:'Failed to load context bundles';}
		finally{loading=false;}
	}
	async function load(){
		const data=await api.get<{workspaces:Workspace[];canManageGlobal?:boolean}>('/workspaces');
		workspaces=data.canManageGlobal?data.workspaces:data.workspaces.filter((ws)=>ws.permission==='owner'||!!ws.management_permissions?.manage_mcp_startup);
		const requested=page.url.searchParams.get('workspaceId')||'';const preferred=workspaceIdOverride||requested;
		workspaceId=workspaces.some((ws)=>ws.id===preferred)?preferred:(workspaces[0]?.id||'');
		await loadBundles();
	}
	async function editBundle(bundle:Bundle){error='';try{const full=(await api.get<{bundle:Bundle}>(`/mcp/workspaces/${workspaceId}/context-bundles/${bundle.id}`)).bundle;applyBundle(full);}catch(err){error=err instanceof ApiError?err.message:'Failed to open bundle';}}
	function addProfile(){const profile=profiles.find((item)=>item.id===selectedProfileId);if(!profile||form.entries.some((item)=>item.profileId===profile.id))return;form.entries=[...form.entries,{type:'file',path:'',attachmentType:'profile',profileId:profile.id,profileName:profile.name,recursive:false,required:true,priority:100}];selectedProfileId='';}
	function addKnowledge(){const item=knowledgeItems.find((entry)=>entry.id===selectedKnowledgeId);if(!item||form.entries.some((entry)=>entry.knowledgeItemId===item.id))return;const full=(item.roles||[]).some((role)=>role==='core_file'||role==='core_profile');form.entries=[...form.entries,{type:'knowledge',path:'',attachmentType:'knowledge',knowledgeItemId:item.id,knowledgeItemName:item.name,loadMode:full?'full':'smart',recursive:false,required:true,priority:100}];selectedKnowledgeId='';}
	function removeEntry(target:Entry){form.entries=form.entries.filter((entry)=>entry!==target);}
	function toggleDependency(bundle:Bundle){if(bundle.id===editingId)return;const exists=form.dependencies.some((dep)=>dep.bundleId===bundle.id);form.dependencies=exists?form.dependencies.filter((dep)=>dep.bundleId!==bundle.id):[...form.dependencies,{bundleId:bundle.id,name:bundle.name,required:true}];}
	async function save(){if(!workspaceId||!form.name.trim())return;saving=true;error='';savedMessage='';try{const result=editingId?await api.put<{bundle:Bundle}>(`/mcp/workspaces/${workspaceId}/context-bundles/${editingId}`,form):await api.post<{bundle:Bundle}>(`/mcp/workspaces/${workspaceId}/context-bundles`,form);const id=result.bundle.id;await loadBundles();const stored=(await api.get<{bundle:Bundle}>(`/mcp/workspaces/${workspaceId}/context-bundles/${id}`)).bundle;applyBundle(stored);savedMessage='Bundle saved. Library/Profile references were reloaded from shared storage.';}catch(err){error=err instanceof ApiError?err.message:'Bundle save failed';}finally{saving=false;}}
	async function remove(id:string){if(!confirm('Delete this context bundle?'))return;await api.delete(`/mcp/workspaces/${workspaceId}/context-bundles/${id}`);if(editingId===id)reset();await loadBundles();}
	load().catch((err)=>{error=err instanceof ApiError?err.message:'Failed to load CCS bundles';loading=false;});
</script>

<div class="mx-auto max-w-6xl space-y-4 p-3 sm:p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="flex items-center gap-2 text-lg font-semibold"><BookOpen class="size-5"/>Context bundles</h2><p class="max-w-3xl text-sm text-muted-foreground">CCS groups canonical Library knowledge and Profiles for MCP. New raw filesystem path attachments are disabled in the Vercel/Supabase version.</p></div><a href={knowledgeSetupUrl()}><Button variant="outline"><BrainCircuit class="size-4"/>Knowledge Setup</Button></a></div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if savedMessage}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{savedMessage}</div>{/if}
	{#if workspaces.length===0}<Card><CardContent class="p-4 text-sm text-muted-foreground">No workspace with OSS/CCS management permission is available.</CardContent></Card>{:else}
		{#if !hideWorkspacePicker}<Card><CardContent class="p-4"><label class="space-y-1 text-sm"><span>Workspace</span><select class="w-full rounded-md border bg-background p-2" bind:value={workspaceId} onchange={()=>{reset();loadBundles();}}>{#each workspaces as ws}<option value={ws.id}>{ws.name}</option>{/each}</select></label></CardContent></Card>{/if}
		<Card><CardHeader><CardTitle>{editingId?'Edit bundle':'Create bundle'}</CardTitle><CardDescription>Use Library Item IDs and Profile IDs so bundles keep following the canonical source as content changes.</CardDescription></CardHeader><CardContent class="space-y-5">
			<label class="space-y-1 text-sm"><span>Name</span><Input bind:value={form.name} placeholder="Bundle name"/></label>
			<label class="space-y-1 text-sm"><span>Description</span><textarea class="min-h-20 w-full rounded-md border bg-background p-2" bind:value={form.description}></textarea></label>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={form.enabled}/>Enabled</label>

			<div class="space-y-2"><div><p class="text-sm font-medium">Library knowledge</p><p class="text-xs text-muted-foreground">Preferred context source. Knowledge stays in Library; CCS stores only the canonical item reference and load mode.</p></div><div class="flex flex-col gap-2 sm:flex-row"><select class="min-w-0 flex-1 rounded-md border bg-background p-2" bind:value={selectedKnowledgeId}><option value="">Select Library knowledge</option>{#each knowledgeItems as item}<option value={item.id}>{item.name}{item.lifecycleState?` · ${item.lifecycleState}`:''}</option>{/each}</select><Button type="button" variant="outline" onclick={addKnowledge} disabled={!selectedKnowledgeId}><Plus class="size-4"/>Add knowledge</Button></div>
				{#each knowledgeEntries as entry}<div class="rounded-md border p-3 text-sm"><div class="flex flex-col gap-2 sm:flex-row sm:items-center"><div class="min-w-0 flex-1"><strong>{entry.knowledgeItemName||'Library item'}</strong><p class="break-all text-xs text-muted-foreground">ID {entry.knowledgeItemId}</p>{#if entry.knowledgeItemId&&!knowledgeItems.some((item)=>item.id===entry.knowledgeItemId)}<p class="mt-1 text-xs text-amber-600">This Library item is unavailable. Required loads will fail safely instead of substituting another source.</p>{/if}</div><select class="rounded border bg-background p-1 text-xs" bind:value={entry.loadMode}><option value="smart">Smart</option><option value="full">Full</option><option value="summary">Summary</option></select><label><input type="checkbox" bind:checked={entry.required}/> Required</label><input class="w-20 rounded border bg-background p-1" type="number" min="0" max="1000" bind:value={entry.priority} aria-label="Priority"/><Button size="icon" variant="ghost" onclick={()=>removeEntry(entry)}><Trash2 class="size-4"/></Button></div></div>{/each}
				{#if knowledgeItems.length===0}<p class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No canonical Library knowledge is available yet. Add it in Library / Knowledge Setup first.</p>{/if}
			</div>

			<div class="space-y-2"><div><p class="text-sm font-medium">Profiles</p><p class="text-xs text-muted-foreground">Profiles remain Panel-owned and existing profile permissions still apply when MCP loads them.</p></div><div class="flex flex-col gap-2 sm:flex-row"><select class="min-w-0 flex-1 rounded-md border bg-background p-2" bind:value={selectedProfileId}><option value="">Select Profile</option>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select><Button type="button" variant="outline" onclick={addProfile} disabled={!selectedProfileId}><Plus class="size-4"/>Add profile</Button></div>
				{#each profileEntries as entry}<div class="rounded-md border p-3 text-sm"><div class="flex items-center gap-2"><div class="min-w-0 flex-1"><strong>{entry.profileName||'Profile'}</strong><p class="break-all text-xs text-muted-foreground">ID {entry.profileId}</p></div><label><input type="checkbox" bind:checked={entry.required}/> Required</label><input class="w-20 rounded border bg-background p-1" type="number" min="0" max="1000" bind:value={entry.priority} aria-label="Priority"/><Button size="icon" variant="ghost" onclick={()=>removeEntry(entry)}><Trash2 class="size-4"/></Button></div></div>{/each}
			</div>

			{#if legacyEntries.length}<div class="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><div class="flex items-center gap-2"><Badge variant="secondary">Legacy</Badge><p class="text-sm font-medium">Path references from the old filesystem model</p></div><p class="text-xs text-muted-foreground">They are preserved so existing bundles are not silently damaged, but v2 cannot add new ones. Replace them with Library knowledge or Profiles, then remove them.</p>{#each legacyEntries as entry}<div class="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"><span class="min-w-0 flex-1 break-all">/{entry.path||'(missing path)'}</span><Button size="icon" variant="ghost" onclick={()=>removeEntry(entry)}><Trash2 class="size-4"/></Button></div>{/each}</div>{/if}

			<div class="space-y-2"><p class="text-sm font-medium">Bundle dependencies</p><p class="text-xs text-muted-foreground">Load another CCS bundle with this one without duplicating its knowledge.</p><div class="grid gap-2 sm:grid-cols-2">{#each bundles.filter((bundle)=>bundle.id!==editingId) as bundle}<label class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"><span class="min-w-0 break-words">{bundle.name}</span><input type="checkbox" checked={form.dependencies.some((dep)=>dep.bundleId===bundle.id)} onchange={()=>toggleDependency(bundle)}/></label>{/each}</div></div>
			<div class="flex flex-wrap gap-2"><Button onclick={save} disabled={saving||!form.name.trim()}>{#if saving}<LoaderCircle class="size-4 animate-spin"/>{:else}<Save class="size-4"/>{/if}{editingId?'Save changes':'Create bundle'}</Button>{#if editingId}<Button variant="outline" onclick={reset}><X class="size-4"/>New bundle</Button>{/if}</div>
		</CardContent></Card>

		<Card><CardHeader><CardTitle>Saved bundles</CardTitle><CardDescription>Reusable MCP context groups stored in shared Supabase state.</CardDescription></CardHeader><CardContent>{#if loading}<div class="flex justify-center py-10"><LoaderCircle class="size-5 animate-spin"/></div>{:else if bundles.length===0}<p class="text-sm text-muted-foreground">No CCS bundles yet.</p>{:else}<div class="grid gap-3 md:grid-cols-2">{#each bundles as bundle}<div class="rounded-md border p-3"><div class="flex items-start justify-between gap-2"><div><strong>{bundle.name}</strong><p class="text-sm text-muted-foreground">{bundle.description||'No description'}</p><p class="mt-2 text-xs text-muted-foreground">{bundle.entryCount||0} context entries · {bundle.dependencyCount||0} dependencies · v{bundle.version||1}</p></div><div class="flex gap-1"><Button size="icon" variant="ghost" onclick={()=>editBundle(bundle)}><Pencil class="size-4"/></Button><Button size="icon" variant="ghost" onclick={()=>remove(bundle.id)}><Trash2 class="size-4"/></Button></div></div></div>{/each}</div>{/if}</CardContent></Card>
	{/if}
</div>
