<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { workspace } from '$lib/workspace.svelte';
	import { auth } from '$lib/auth.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { AlertTriangle, CheckCircle2, ExternalLink, FileOutput, LoaderCircle, RefreshCw, Route, Settings, Upload } from '@lucide/svelte';

	type ImportMode='knowledge'|'reference'|'draft';
	let addon:any=$state(null),status:any=$state(null),settings:any=$state(null),loading=$state(true),error=$state(''),notice=$state('');
	let file=$state<File|null>(null),importMode=$state<ImportMode>('knowledge'),uploadBusy=$state(false),uploadProgress=$state(0),uploadPhase=$state(''),uploadResult:any=$state(null),pendingUploadId=$state('');
	let sorterTitle=$state(''),sorterContent=$state(''),sorterType=$state('document'),analyzing=$state(false),analysis:any=$state(null),queueBusy=$state('');
	const accepted='.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json';
	const availableWorkspaces=$derived(workspace.workspaces.filter((item:any)=>item.permission==='owner'||item.management_permissions?.sorter_view===true||item.management_permissions?.converter_view===true));
	const currentId=()=>availableWorkspaces.some((item:any)=>item.id===workspace.currentId)?String(workspace.currentId||''):String(availableWorkspaces[0]?.id||'');
	const engineManageUrl=$derived(String(addon?.engineManageUrl||''));
	const reviewItems=$derived([...(status?.processing?.review||[]),...(status?.queue||[])]);
	const recentJobs=$derived(status?.processing?.jobs||[]);

	function failMessage(err:unknown){return err instanceof ApiError?err.message:err instanceof Error?err.message:'APEX request failed';}
	function prettyBytes(value:number){if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`;}
	function resetUpload(){file=null;uploadResult=null;uploadProgress=0;uploadPhase='';pendingUploadId='';}

	async function refresh(){
		loading=true;error='';
		try{
			if(!workspace.loaded)await workspace.load();
			const id=currentId();if(id&&workspace.currentId!==id)workspace.select(id);
			const addons=await api.get<any>('/addons/status');addon=(addons.addons||[]).find((item:any)=>item.id==='apex')||null;
			if(id){
				[status,settings]=await Promise.all([
					api.get<any>(`/addons/apex/workspaces/${encodeURIComponent(id)}/status`),
					api.get<any>(`/addons/apex/workspaces/${encodeURIComponent(id)}/settings`)
				]);
				if(!uploadProgress&&!uploadResult)importMode=(settings?.converter?.defaultImportMode||'knowledge') as ImportMode;
			}
		}catch(err){error=failMessage(err);}finally{loading=false;}
	}

	function uploadSigned(signedUrl:string,source:File){return new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',signedUrl);const form=new FormData();form.append('cacheControl','3600');form.append('',source);xhr.setRequestHeader('x-upsert','false');xhr.upload.onprogress=(event)=>{if(event.lengthComputable)uploadProgress=Math.max(5,Math.min(55,Math.round((event.loaded/event.total)*50)+5));};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new ApiError(xhr.responseText||'Source upload failed',xhr.status));xhr.onerror=()=>reject(new ApiError('Source upload request failed',0));xhr.send(form);});}
	async function completeUpload(uploadId:string){const id=currentId();uploadPhase='APEX is extracting, converting and structuring Knowledge';uploadProgress=Math.max(uploadProgress,62);uploadResult=await api.post<any>('/apex/knowledge-import',{action:'complete',workspaceId:id,uploadId});uploadProgress=100;uploadPhase=uploadResult.state==='review_required'?'Review required':uploadResult.state==='duplicate'?'Existing Knowledge found':'Conversion complete';await refresh();}
	async function runConverter(){const id=currentId();if(!file||!id||uploadBusy)return;uploadBusy=true;error='';notice='';uploadResult=null;uploadProgress=2;uploadPhase='Preparing secure source upload';try{const prepared=await api.post<any>('/apex/knowledge-import',{action:'prepare',workspaceId:id,fileName:file.name,mimeType:file.type||'application/octet-stream',sizeBytes:file.size,importMode});pendingUploadId=String(prepared.uploadId||'');uploadPhase='Uploading source';uploadProgress=5;await uploadSigned(prepared.signedUrl,file);await completeUpload(pendingUploadId);}catch(err){error=failMessage(err);uploadPhase='Conversion paused';}finally{uploadBusy=false;}}
	async function reviewImport(action:'create_new'|'revision'|'use_existing'){const id=currentId();if(!uploadResult?.jobId||!id||uploadBusy)return;uploadBusy=true;error='';try{uploadResult=await api.patch<any>('/apex/knowledge-import',{workspaceId:id,jobId:uploadResult.jobId,action});uploadPhase='Knowledge finalized';await refresh();}catch(err){error=failMessage(err);}finally{uploadBusy=false;}}

	async function analyze(){const id=currentId();if(!id||!sorterContent.trim()||analyzing)return;analyzing=true;analysis=null;error='';notice='';try{const response=await api.post<any>(`/addons/apex/workspaces/${encodeURIComponent(id)}/analyze`,{entry:{title:sorterTitle||'APEX Knowledge',content:sorterContent,type:sorterType},settings:{minConfidence:settings?.sorter?.minConfidence??0.75,maxSuggestions:12}});analysis=response.analysis;}catch(err){error=failMessage(err);}finally{analyzing=false;}}
	async function queueSuggestion(suggestion:any,index:number){const id=currentId();if(!id)return;queueBusy=String(index);error='';notice='';try{await api.post<any>(`/addons/apex/workspaces/${encodeURIComponent(id)}/queue`,{entry:{title:sorterTitle||'APEX Knowledge',content:sorterContent,type:sorterType},suggestion});notice='Sorter suggestion added to the Library approval queue.';await refresh();}catch(err){error=failMessage(err);}finally{queueBusy='';}}

	onMount(refresh);
</script>

<svelte:head><title>APEX Unit · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div><p class="text-xs font-semibold uppercase tracking-[.16em] text-primary">APEX · PANEL</p><h1 class="mt-1 text-2xl font-semibold">APEX Unit</h1><p class="mt-1 max-w-3xl text-sm text-muted-foreground">The customer-facing Converter and Knowledge Sorter. APEX processing runs on the shared Engine Host without sending normal users to the Engine website.</p></div>
		<div class="flex flex-wrap gap-2"><Button variant="outline" onclick={refresh} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button>{#if auth.isAdmin&&engineManageUrl}<a href={engineManageUrl} target="_blank" rel="noreferrer"><Button variant="outline">Engine Console <ExternalLink class="size-4"/></Button></a>{/if}</div>
	</div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if notice}<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>{/if}

	{#if availableWorkspaces.length===0}
		<Card><CardContent class="p-8 text-center text-sm text-muted-foreground">No workspace with APEX access is available to this account.</CardContent></Card>
	{:else}
		<Card><CardHeader><CardTitle>Workspace</CardTitle><CardDescription>APEX uses the selected workspace's Library, Knowledge architecture, Profiles and permissions.</CardDescription></CardHeader><CardContent class="flex flex-wrap items-center gap-3"><select class="min-w-64 rounded-md border bg-background px-3 py-2 text-sm" value={currentId()} onchange={async(e)=>{workspace.select(e.currentTarget.value);resetUpload();analysis=null;await refresh();}}>{#each availableWorkspaces as item}<option value={item.id}>{item.name}</option>{/each}</select>{#if addon}<Badge variant={addon.licensed?'success':'destructive'}>{addon.licensed?'Licensed':'Licence required'}</Badge><Badge variant={addon.attached?'success':'secondary'}>{addon.attached?'Attached':'Not attached'}</Badge><Badge variant={addon.setupComplete?'success':'secondary'}>{addon.setupComplete?'Engine ready':'Engine setup required'}</Badge>{/if}<Badge variant="outline">{reviewItems.length} review</Badge></CardContent></Card>

		<div class="grid gap-4 xl:grid-cols-2">
			<Card>
				<CardHeader><div class="flex items-start justify-between gap-3"><div><CardTitle class="flex items-center gap-2"><FileOutput class="size-5"/>Converter</CardTitle><CardDescription>Upload a source document. APEX preserves the original, converts/extracts it and creates structured Library Knowledge.</CardDescription></div><a href="/sorter-converter/converter-settings" class="text-xs text-muted-foreground hover:text-foreground">Settings →</a></div></CardHeader>
				<CardContent class="space-y-4">
					<label class="block rounded-xl border-2 border-dashed p-6 text-center"><input class="sr-only" type="file" accept={accepted} disabled={uploadBusy} onchange={(e)=>{file=e.currentTarget.files?.[0]||null;uploadResult=null;uploadProgress=0;}}/><Upload class="mx-auto mb-2 size-7 text-muted-foreground"/>{#if file}<p class="font-medium">{file.name}</p><p class="text-xs text-muted-foreground">{prettyBytes(file.size)}</p><p class="mt-2 text-xs text-primary">Choose another file</p>{:else}<p class="font-medium">Choose a document to convert</p><p class="mt-1 text-xs text-muted-foreground">PDF · DOCX · TXT · MD · HTML · CSV · JSON</p>{/if}</label>
					<label class="block space-y-1 text-sm"><span class="font-medium">Destination</span><select class="w-full rounded-md border bg-background px-3 py-2" bind:value={importMode} disabled={uploadBusy}><option value="knowledge">Knowledge</option><option value="reference">Reference-only Knowledge</option><option value="draft">Draft Knowledge</option></select></label>
					{#if uploadBusy||uploadProgress>0}<div class="space-y-2"><div class="flex justify-between text-xs"><span>{uploadPhase||'Processing'}</span><span>{uploadProgress}%</span></div><div class="h-2 overflow-hidden rounded-full bg-muted"><div class="h-full bg-primary" style={`width:${uploadProgress}%`}></div></div></div>{/if}
					<div class="flex justify-end"><Button onclick={runConverter} disabled={!file||uploadBusy}>{#if uploadBusy}<LoaderCircle class="size-4 animate-spin"/>Processing{:else}<FileOutput class="size-4"/>Convert & Process{/if}</Button></div>
					{#if uploadResult?.state==='completed'}<div class="rounded-md border border-emerald-500/30 p-3 text-sm"><div class="flex items-center gap-2 font-medium"><CheckCircle2 class="size-4 text-emerald-500"/>Knowledge ready</div><p class="mt-1 text-xs text-muted-foreground">{uploadResult.knowledge?.name||'APEX conversion finalized.'}</p></div>{/if}
					{#if uploadResult?.state==='duplicate'}<div class="rounded-md border p-3 text-sm"><strong>Existing Knowledge found</strong><p class="mt-1 text-xs text-muted-foreground">{uploadResult.existingKnowledgeItemName||'APEX matched an existing Knowledge item.'}</p></div>{/if}
					{#if uploadResult?.state==='review_required'}<div class="rounded-md border border-amber-500/30 p-3 text-sm"><div class="flex items-center gap-2 font-medium"><AlertTriangle class="size-4 text-amber-500"/>Review required</div><p class="mt-1 text-xs text-muted-foreground">{uploadResult.duplicate?.reason||'APEX found related Knowledge.'}</p><div class="mt-3 flex flex-wrap gap-2">{#if uploadResult.duplicate?.kind==='possible_revision'}<Button onclick={()=>reviewImport('revision')} disabled={uploadBusy}>Import as revision</Button>{/if}<Button variant="outline" onclick={()=>reviewImport('create_new')} disabled={uploadBusy}>Create new</Button>{#if uploadResult.duplicate?.existingItemId}<Button variant="outline" onclick={()=>reviewImport('use_existing')} disabled={uploadBusy}>Use existing</Button>{/if}</div></div>{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader><div class="flex items-start justify-between gap-3"><div><CardTitle class="flex items-center gap-2"><Route class="size-5"/>Knowledge Sorter</CardTitle><CardDescription>Analyze content against Library Knowledge, Profiles, Projects and Knowledge Setup. Queue approved routing changes without duplicating the knowledge system.</CardDescription></div><a href="/sorter-converter/sorter-settings" class="text-xs text-muted-foreground hover:text-foreground">Settings →</a></div></CardHeader>
				<CardContent class="space-y-3">
					<div class="grid gap-3 sm:grid-cols-2"><label class="space-y-1 text-sm"><span class="font-medium">Title</span><input class="w-full rounded-md border bg-background px-3 py-2" bind:value={sorterTitle} placeholder="Knowledge title"/></label><label class="space-y-1 text-sm"><span class="font-medium">Type</span><select class="w-full rounded-md border bg-background px-3 py-2" bind:value={sorterType}><option value="document">Document</option><option value="note">Note</option><option value="incident">Incident</option><option value="timeline">Timeline</option><option value="evidence">Evidence</option><option value="reference">Reference</option><option value="profile-record">Profile record</option></select></label></div>
					<textarea class="min-h-40 w-full rounded-md border bg-background p-3 text-sm" bind:value={sorterContent} placeholder="Paste or write content for APEX to classify and route..."></textarea>
					<div class="flex justify-end"><Button onclick={analyze} disabled={!sorterContent.trim()||analyzing}>{#if analyzing}<LoaderCircle class="size-4 animate-spin"/>Analyzing{:else}<Route class="size-4"/>Analyze & Sort{/if}</Button></div>
					{#if analysis}<div class="space-y-2 border-t pt-3"><div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-sm">Suggestions</strong><span class="text-xs text-muted-foreground">{analysis.suggestions?.length||0} match(es)</span></div>{#if !(analysis.suggestions?.length)}<p class="text-sm text-muted-foreground">No routing suggestion cleared the configured confidence threshold.</p>{/if}{#each analysis.suggestions||[] as suggestion,index}<div class="rounded-md border p-3"><div class="flex flex-wrap items-start justify-between gap-3"><div><strong class="text-sm">{suggestion.label||suggestion.kind}</strong><p class="mt-1 text-xs text-muted-foreground">{suggestion.reason}</p><p class="mt-1 text-xs">Confidence {Math.round(Number(suggestion.confidence||0)*100)}% · {suggestion.profileName||suggestion.role||suggestion.architectureRoute?.destinationLabel||'Knowledge'}</p></div><Button size="sm" variant="outline" onclick={()=>queueSuggestion(suggestion,index)} disabled={queueBusy!==''}>{queueBusy===String(index)?'Queuing…':'Add to review queue'}</Button></div></div>{/each}</div>{/if}
				</CardContent>
			</Card>
		</div>

		<div class="grid gap-4 xl:grid-cols-2">
			<Card><CardHeader><CardTitle>Review queue</CardTitle><CardDescription>APEX suggestions and duplicate/revision decisions waiting for review.</CardDescription></CardHeader><CardContent class="space-y-2">{#if reviewItems.length===0}<p class="text-sm text-muted-foreground">Nothing is waiting for review.</p>{/if}{#each reviewItems.slice(0,30) as item}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><strong class="text-sm">{item.summary||item.result?.title||item.source?.name||'APEX review item'}</strong><Badge variant="outline">{String(item.status||'pending').replaceAll('_',' ')}</Badge></div>{#if item.reason}<p class="mt-1 text-xs text-muted-foreground">{item.reason}</p>{/if}</div>{/each}</CardContent></Card>
			<Card><CardHeader><CardTitle>Recent processing</CardTitle><CardDescription>Engine-backed APEX work for this workspace. Detailed queue operations and diagnostics stay on Engine Console.</CardDescription></CardHeader><CardContent class="space-y-2">{#if recentJobs.length===0}<p class="text-sm text-muted-foreground">No APEX processing jobs yet.</p>{/if}{#each recentJobs.slice(0,20) as job}<div class="rounded-md border p-3"><div class="flex items-center justify-between gap-2"><strong class="text-sm">{job.result?.title||job.source?.name||'APEX job'}</strong><Badge variant="outline">{String(job.status||'unknown').replaceAll('_',' ')}</Badge></div><p class="mt-1 text-xs text-muted-foreground">{job.source?.name||'Source'} · {job.processor||job.result?.processor||'APEX'}</p></div>{/each}</CardContent></Card>
		</div>

		<div class="flex flex-wrap gap-2"><a href="/sorter-converter/sorter-settings"><Button variant="outline"><Settings class="size-4"/>Sorter Settings</Button></a><a href="/sorter-converter/converter-settings"><Button variant="outline"><Settings class="size-4"/>Converter Settings</Button></a></div>
	{/if}
</div>
