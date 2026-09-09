<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { workspace } from '$lib/workspace.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, LoaderCircle, Sparkles, Upload } from '@lucide/svelte';

	type ImportMode='knowledge'|'reference'|'draft';
	type ImportResult={
		state:string; automatic?:boolean; jobId?:string; knowledge?:any; indexed?:boolean;
		existingKnowledgeItemId?:string; existingKnowledgeItemName?:string;
		duplicate?:any; title?:string; processor?:string; source?:any; revision?:number;
	};

	let file=$state<File|null>(null);
	let importMode=$state<ImportMode>('knowledge');
	let busy=$state(false),progress=$state(0),phase=$state(''),error=$state('');
	let result=$state<ImportResult|null>(null);
	let dragging=$state(false);
	let pendingUploadId=$state('');
	const accepted='.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json';
	const availableWorkspaces=$derived(workspace.workspaces.filter((item:any)=>item.permission==='owner'||(item.management_permissions?.manage_library===true&&item.management_permissions?.sorter_scan===true)));
	const currentId=()=>availableWorkspaces.some((item:any)=>item.id===workspace.currentId)?String(workspace.currentId||''):String(availableWorkspaces[0]?.id||'');
	const apexMeta=$derived(result?.knowledge?.metadata?.apex||null);

	onMount(async()=>{if(!workspace.loaded)await workspace.load();const id=currentId();if(id&&workspace.currentId!==id)workspace.select(id);});

	function reset(){file=null;result=null;error='';progress=0;phase='';busy=false;pendingUploadId='';}
	function selectFiles(files:FileList|null){const next=files?.[0]||null;if(next){file=next;result=null;error='';progress=0;phase='';pendingUploadId='';}}
	function prettyBytes(value:number){if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`;}
	function failMessage(err:unknown){return err instanceof ApiError?err.message:err instanceof Error?err.message:'APEX Knowledge import failed';}

	function uploadSigned(signedUrl:string,source:File){
		return new Promise<void>((resolve,reject)=>{
			const xhr=new XMLHttpRequest();xhr.open('PUT',signedUrl);
			const form=new FormData();form.append('cacheControl','3600');form.append('',source);
			xhr.setRequestHeader('x-upsert','false');
			xhr.upload.onprogress=(event)=>{if(event.lengthComputable)progress=Math.max(5,Math.min(55,Math.round((event.loaded/event.total)*50)+5));};
			xhr.onload=()=>{
				if(xhr.status>=200&&xhr.status<300)return resolve();
				let message=xhr.responseText||'Supabase source upload failed';
				try{const body=JSON.parse(xhr.responseText||'{}');message=body?.message||body?.error||message;}catch{}
				reject(new ApiError(message,xhr.status));
			};
			xhr.onerror=()=>reject(new ApiError('Source upload request failed',0));xhr.send(form);
		});
	}

	async function completeImport(uploadId:string){
		const workspaceId=currentId();if(!workspaceId||!uploadId)return;
		phase='APEX is extracting and structuring Knowledge';progress=Math.max(progress,62);
		const completed=await api.post<ImportResult>('/apex/knowledge-import',{action:'complete',workspaceId,uploadId});
		result=completed;progress=100;error='';
		phase=completed.state==='review_required'?'Review required':completed.state==='duplicate'?'Existing Knowledge found':completed.state==='completed'?'Knowledge created':String(completed.state||'Processing').replaceAll('_',' ');
	}

	async function startImport(){
		const workspaceId=currentId();if(!file||!workspaceId||busy)return;
		busy=true;error='';result=null;progress=2;phase='Preparing secure upload';pendingUploadId='';
		try{
			const prepared=await api.post<any>('/apex/knowledge-import',{action:'prepare',workspaceId,fileName:file.name,mimeType:file.type||'application/octet-stream',sizeBytes:file.size,importMode});
			pendingUploadId=String(prepared.uploadId||'');
			phase='Uploading original source';progress=5;await uploadSigned(prepared.signedUrl,file);
			await completeImport(pendingUploadId);
		}catch(err){error=failMessage(err);phase='Processing paused';}
		finally{busy=false;}
	}

	async function retryImport(){
		if(!pendingUploadId||busy)return;
		busy=true;error='';phase='Retrying APEX processing';
		try{await completeImport(pendingUploadId);}
		catch(err){error=failMessage(err);phase='Processing paused';}
		finally{busy=false;}
	}

	async function review(action:'create_new'|'revision'|'use_existing'){
		const workspaceId=currentId();if(!result?.jobId||!workspaceId||busy)return;
		busy=true;error='';phase=action==='revision'?'Creating Knowledge revision':action==='use_existing'?'Using existing Knowledge':'Creating separate Knowledge';
		try{result=await api.patch<ImportResult>('/apex/knowledge-import',{workspaceId,jobId:result.jobId,action});progress=100;phase='Knowledge finalized';}
		catch(err){error=failMessage(err);}
		finally{busy=false;}
	}
</script>

<svelte:head><title>Upload to Knowledge · OrbitFS</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<a href="/library" class="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft class="size-3"/>Library</a>
			<p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">APEX KNOWLEDGE INGEST</p>
			<h1 class="flex items-center gap-2 text-2xl font-semibold"><Sparkles class="size-6"/>Upload to Knowledge</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">The original document is preserved in OrbitFS storage. APEX extracts, cleans, structures and routes it; Panel Library owns the resulting Knowledge.</p>
		</div>
		<a href="/apex"><Button variant="outline">APEX overview</Button></a>
	</div>

	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><div>{error}</div>{#if pendingUploadId&&!result}<div class="mt-3"><Button variant="outline" onclick={retryImport} disabled={busy}>{#if busy}<LoaderCircle class="size-4 animate-spin"/>{/if}Retry APEX processing</Button></div>{/if}</div>{/if}

	{#if availableWorkspaces.length===0}
		<Card><CardContent class="p-8 text-center"><AlertTriangle class="mx-auto mb-3 size-7 text-muted-foreground"/><p class="font-medium">No workspace is available for APEX Knowledge import.</p><p class="mt-1 text-sm text-muted-foreground">You need Library management and APEX processing permission for a workspace.</p></CardContent></Card>
	{:else}
		<Card>
			<CardHeader><CardTitle>Source</CardTitle><CardDescription>PDF, DOCX, TXT, Markdown, HTML, CSV or JSON. There are no destination-folder or sorter controls.</CardDescription></CardHeader>
			<CardContent class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<label class="space-y-1.5 text-sm"><span class="font-medium">Workspace</span><select class="w-full rounded-md border bg-background px-3 py-2" value={currentId()} disabled={busy} onchange={(event)=>{workspace.select(event.currentTarget.value);reset();}}>{#each availableWorkspaces as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
					<label class="space-y-1.5 text-sm"><span class="font-medium">Import as</span><select class="w-full rounded-md border bg-background px-3 py-2" bind:value={importMode} disabled={busy}><option value="knowledge">Knowledge</option><option value="reference">Reference-only Knowledge</option><option value="draft">Draft Knowledge</option></select></label>
				</div>

				<label class={dragging ? 'block cursor-pointer rounded-xl border-2 border-dashed border-primary bg-primary/5 p-8 text-center transition-colors' : 'block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors'}
					ondragover={(event)=>{event.preventDefault();dragging=true;}} ondragleave={()=>dragging=false} ondrop={(event)=>{event.preventDefault();dragging=false;selectFiles(event.dataTransfer?.files||null);}}>
					<input class="sr-only" type="file" accept={accepted} disabled={busy} onchange={(event)=>selectFiles(event.currentTarget.files)}/>
					{#if file}<FileText class="mx-auto mb-3 size-8 text-primary"/><p class="font-medium">{file.name}</p><p class="mt-1 text-xs text-muted-foreground">{prettyBytes(file.size)} · {file.type||'type detected by APEX'}</p><p class="mt-3 text-xs text-primary">Choose another file</p>
					{:else}<Upload class="mx-auto mb-3 size-8 text-muted-foreground"/><p class="font-medium">Drop a document here or choose a file</p><p class="mt-1 text-xs text-muted-foreground">PDF · DOCX · TXT · MD · HTML · CSV · JSON</p>{/if}
				</label>

				{#if busy || progress>0}
					<div class="space-y-2"><div class="flex justify-between text-xs"><span>{phase||'Processing'}</span><span>{progress}%</span></div><div class="h-2 overflow-hidden rounded-full bg-muted"><div class="h-full bg-primary transition-all" style={`width:${progress}%`}></div></div></div>
				{/if}
				<div class="flex justify-end"><Button onclick={startImport} disabled={!file||busy}>{#if busy}<LoaderCircle class="size-4 animate-spin"/>Processing{:else}<Sparkles class="size-4"/>Upload & Process{/if}</Button></div>
			</CardContent>
		</Card>

		{#if result?.state==='completed'}
			<Card class="border-emerald-500/30"><CardHeader><div class="flex items-start justify-between gap-3"><div><CardTitle class="flex items-center gap-2"><CheckCircle2 class="size-5 text-emerald-500"/>Knowledge ready</CardTitle><CardDescription>{result.knowledge?.name||'The APEX Knowledge import was finalized.'}</CardDescription></div>{#if result.indexed}<Badge variant="success">Indexed</Badge>{/if}</div></CardHeader><CardContent class="space-y-4">{#if apexMeta}<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div class="rounded-md border p-3"><p class="text-xs text-muted-foreground">Source</p><p class="mt-1 truncate text-sm font-medium">{apexMeta.sourceFilename||'Source document'}</p></div><div class="rounded-md border p-3"><p class="text-xs text-muted-foreground">Pages</p><p class="mt-1 text-sm font-medium">{apexMeta.pageCount||'—'}</p></div><div class="rounded-md border p-3"><p class="text-xs text-muted-foreground">Imported by</p><p class="mt-1 text-sm font-medium">APEX</p></div><div class="rounded-md border p-3"><p class="text-xs text-muted-foreground">Revision</p><p class="mt-1 text-sm font-medium">{apexMeta.revision||result.revision||1}</p></div></div><div class="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground"><span class="font-medium text-foreground">Processor:</span> {apexMeta.processor||'APEX'} · <span class="font-medium text-foreground">Sections:</span> {apexMeta.sectionCount||0} · <span class="font-medium text-foreground">Chunks:</span> {apexMeta.chunkCount||0} · <span class="font-medium text-foreground">Source linked:</span> {apexMeta.sourceAssetId?'Yes':'No'}</div>{/if}<div class="flex flex-wrap gap-2"><a href="/library"><Button>Open Library</Button></a><Button variant="outline" onclick={reset}>Import another</Button></div></CardContent></Card>
		{:else if result?.state==='duplicate'}
			<Card><CardHeader><CardTitle class="flex items-center gap-2"><CheckCircle2 class="size-5 text-primary"/>Already in Knowledge</CardTitle><CardDescription>APEX matched the uploaded source/content to {result.existingKnowledgeItemName||'an existing Knowledge item'}. No duplicate Knowledge record was created.</CardDescription></CardHeader><CardContent class="flex gap-2"><a href="/library"><Button>Open existing Knowledge</Button></a><Button variant="outline" onclick={reset}>Import another</Button></CardContent></Card>
		{:else if result?.state==='review_required'}
			<Card class="border-amber-500/30"><CardHeader><CardTitle class="flex items-center gap-2"><AlertTriangle class="size-5 text-amber-500"/>Review before writing Knowledge</CardTitle><CardDescription>{result.duplicate?.reason||'APEX found similar existing Knowledge.'}</CardDescription></CardHeader><CardContent class="space-y-4"><div class="rounded-md border p-3 text-sm"><div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{String(result.duplicate?.kind||'related').replaceAll('_',' ')}</Badge><span class="font-medium">{result.duplicate?.existingItemName||'Existing Knowledge'}</span>{#if result.duplicate?.confidence}<span class="text-xs text-muted-foreground">{Math.round(Number(result.duplicate.confidence)*100)}% match</span>{/if}</div></div><div class="flex flex-wrap gap-2">{#if result.duplicate?.kind==='possible_revision'}<Button onclick={()=>review('revision')} disabled={busy}>Import as revision</Button>{/if}<Button variant={result.duplicate?.kind==='possible_revision'?'outline':'default'} onclick={()=>review('create_new')} disabled={busy}>Create new Knowledge</Button>{#if result.duplicate?.existingItemId}<Button variant="outline" onclick={()=>review('use_existing')} disabled={busy}>Use existing</Button>{/if}<Button variant="ghost" onclick={reset} disabled={busy}>Leave for later</Button></div></CardContent></Card>
		{/if}

		<Card><CardHeader><CardTitle class="text-base">What happens automatically</CardTitle></CardHeader><CardContent class="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><div>✓ Original source preserved</div><div>✓ Format extraction</div><div>✓ Cleanup and Markdown normalization</div><div>✓ Heading and section detection</div><div>✓ Page/source tracking for PDF</div><div>✓ Hash and duplicate detection</div><div>✓ Chunk generation</div><div>✓ Knowledge / Project / Profile routing</div></CardContent></Card>
	{/if}
</div>
