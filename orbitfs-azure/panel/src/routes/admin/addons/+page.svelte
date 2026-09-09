<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { addons as addonsStore } from '$lib/addons.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { ExternalLink, LoaderCircle, PlugZap, Puzzle, RefreshCw, Server, Trash2, Unplug } from '@lucide/svelte';

	type Addon = {
		id:string; name:string; description:string; version:string;
		installed:boolean; attached:boolean; recordAttached?:boolean;
		licensed:boolean; licenseAllowed?:boolean; licenseReason?:string|null;
		available:boolean; status:string; engineManageUrl?:string|null;
	};
	type Host = {
		state:string; hostUrl:string|null; projectName:string|null; projectId:string|null;
		lastError:string|null;
	};
	type HostResponse = { host:Host; provisioningAvailable:boolean; waiting?:boolean };

	let addons=$state<Addon[]>([]);
	let host=$state<Host|null>(null);
	let provisioningAvailable=$state(false);
	let loading=$state(true);
	let busy=$state('');
	let error=$state('');
	let polling=$state(false);

	const message=(e:unknown,fallback:string)=>e instanceof ApiError?`${e.message}${e.code?` (${e.code})`:''}`:fallback;
	const hostReady=()=>['linked','ready'].includes(String(host?.state||''));
	const hostAdvancing=()=>['provisioning','deployed','linking'].includes(String(host?.state||''))&&!hostReady();
	const hostLabel=()=>String(host?.state||'not_deployed').replaceAll('_',' ');
	const sleep=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));
	const recordAttached=(a:Addon)=>a.recordAttached===true||a.attached===true;
	const engineUrl=(a:Addon)=>a.engineManageUrl||(host?.hostUrl?`${host.hostUrl}/engines/${a.id}`:'');

	function availability(a:Addon){
		if(!a.available)return 'Unavailable';
		if(a.licenseAllowed===false)return 'Not licensed';
		if(recordAttached(a)&&a.licensed)return 'Linked';
		if(a.installed)return 'Installed';
		return 'Available';
	}
	function tone(a:Addon){
		if(!a.available||a.licenseAllowed===false)return 'destructive';
		if(recordAttached(a)&&a.licensed)return 'success';
		return 'secondary';
	}

	async function load(startPolling=true){
		loading=true; error='';
		try{
			const [addonData,hostData]=await Promise.all([
				api.get<{addons:Addon[]}>('/addon-library'),
				api.get<HostResponse>('/engine-host')
			]);
			addons=addonData.addons;
			host=hostData.host;
			provisioningAvailable=hostData.provisioningAvailable;
			if(startPolling&&hostAdvancing()&&provisioningAvailable)void pollHost();
		}catch(e){ error=message(e,'Could not load Add-on Library'); }
		finally{ loading=false; }
	}
	load();

	async function pollHost(){
		if(polling)return;
		polling=true;
		try{
			for(let i=0;i<48;i+=1){
				if(hostReady()||host?.state==='error'||!hostAdvancing())break;
				await sleep(2500);
				try{
					const data=await api.post<HostResponse>('/engine-host/refresh');
					host=data.host;
					provisioningAvailable=data.provisioningAvailable;
					if(hostReady()||host?.state==='error'||data.waiting===false)break;
				}catch(e){ error=message(e,'Could not refresh Engine deployment'); break; }
			}
		}finally{
			polling=false;
			await load(false);
			await addonsStore.load();
		}
	}

	async function hostAct(action:string){
		busy=`host:${action}`; error='';
		try{
			const data=await api.post<HostResponse>(`/engine-host/${action}`);
			host=data.host;
			provisioningAvailable=data.provisioningAvailable;
			if(['provision','refresh','link'].includes(action)&&hostAdvancing())void pollHost();
		}catch(e){ error=message(e,`Engine ${action} failed`); }
		finally{ busy=''; await load(false); }
	}

	async function addonAct(id:string,action:'install'|'link'|'unlink'|'test'){
		busy=`${id}:${action}`; error='';
		try{
			await api.post(`/addon-library/${id}/${action}`);
			await load(false);
			await addonsStore.load();
		}catch(e){ error=message(e,`${action} failed`); }
		finally{ busy=''; }
	}

	async function remove(id:string){
		if(!confirm('Remove this add-on from this OrbitFS installation? Add-on data is preserved.'))return;
		busy=`${id}:remove`; error='';
		try{
			await api.delete(`/addon-library/${id}`);
			await load(false);
			await addonsStore.load();
		}catch(e){ error=message(e,'Uninstall failed'); }
		finally{ busy=''; }
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
	<header class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div>
			<div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-primary"><Puzzle class="size-4"/> Add-on Library</div>
			<h1 class="mt-1 text-2xl font-semibold">OrbitFS Add-on Library</h1>
			<p class="text-sm text-muted-foreground">The Panel only installs and links licensed add-ons. Add-on setup, configuration and runtime live in the shared OrbitFS Engine.</p>
		</div>
		<Button variant="outline" onclick={()=>load()} disabled={loading||polling}><RefreshCw class="size-4"/>Refresh</Button>
	</header>

	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}

	{#if loading}
		<div class="grid min-h-64 place-items-center"><LoaderCircle class="size-7 animate-spin"/></div>
	{:else}
		<Card>
			<CardHeader>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div><CardTitle>Shared OrbitFS Engine</CardTitle><CardDescription>One Engine deployment runs every installed Engine add-on for this customer.</CardDescription></div>
					<Badge variant={hostReady()?'success':host?.state==='error'?'destructive':'outline'}>{hostLabel()}</Badge>
				</div>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="grid gap-3 text-sm sm:grid-cols-3">
					<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Host</span><p class="mt-1 truncate font-medium">{host?.hostUrl||'Not deployed'}</p></div>
					<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Project</span><p class="mt-1 truncate font-medium">{host?.projectName||host?.projectId||'—'}</p></div>
					<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Panel link</span><p class="mt-1 font-medium">{hostReady()?'Linked':polling?'Linking…':'Not linked'}</p></div>
				</div>
				{#if host?.lastError}<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{host.lastError}</div>{/if}
				<div class="flex flex-wrap gap-2">
					{#if host?.state==='not_deployed'}<Button onclick={()=>hostAct('provision')} disabled={busy!==''||!provisioningAvailable}><Server class="size-4"/>Deploy Engine</Button>{/if}
					{#if hostAdvancing()}<Button disabled><LoaderCircle class="size-4 animate-spin"/>Deploying &amp; linking</Button>{/if}
					{#if host?.state==='error'&&provisioningAvailable}<Button onclick={()=>hostAct(host?.hostUrl?'refresh':'provision')} disabled={busy!==''}>Retry Engine</Button>{/if}
					{#if host?.hostUrl&&!hostReady()&&!hostAdvancing()&&host?.state!=='error'}<Button onclick={()=>hostAct('link')} disabled={busy!==''}><PlugZap class="size-4"/>Link Engine</Button>{/if}
					{#if host?.hostUrl}<Button variant="outline" onclick={()=>hostAct('refresh')} disabled={busy!==''||polling}><RefreshCw class="size-4"/>Refresh Engine</Button>{/if}
					{#if hostReady()&&host?.hostUrl}<a href={host.hostUrl} target="_blank" rel="noreferrer" class="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"><ExternalLink class="size-4"/>Open Engine</a>{/if}
				</div>
			</CardContent>
		</Card>

		<div class="grid gap-4 md:grid-cols-2">
			{#each addons as addon (addon.id)}
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div><CardTitle>{addon.name}</CardTitle><CardDescription>{addon.description}</CardDescription></div>
							<Badge variant={tone(addon)}>{availability(addon)}</Badge>
						</div>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="grid grid-cols-3 gap-2 text-sm">
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Licence</span><p class="mt-1 font-medium">{addon.licenseAllowed===false?'Not owned':addon.licensed?'Ready':'Activation required'}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Panel</span><p class="mt-1 font-medium">{addon.installed?'Installed':'Not installed'}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Engine</span><p class="mt-1 font-medium">{recordAttached(addon)?(addon.licensed?'Linked':'Locked'):'Not linked'}</p></div>
						</div>

						<div class="flex flex-wrap gap-2">
							{#if !addon.available}
								<Button disabled>Unavailable</Button>
							{:else if addon.licenseAllowed===false}
								<Button disabled>Licence required</Button>
							{:else}
								{#if !addon.installed}<Button onclick={()=>addonAct(addon.id,'install')} disabled={busy!==''}>Install</Button>{/if}
								{#if addon.installed&&!recordAttached(addon)}<Button onclick={()=>addonAct(addon.id,'link')} disabled={busy!==''||!hostReady()}><PlugZap class="size-4"/>Link to Engine</Button>{/if}
								{#if recordAttached(addon)&&addon.licensed&&engineUrl(addon)}<a href={engineUrl(addon)} target="_blank" rel="noreferrer" class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"><ExternalLink class="size-4"/>Open in Engine</a>{/if}
							{/if}
							{#if recordAttached(addon)}<Button variant="outline" onclick={()=>addonAct(addon.id,'unlink')} disabled={busy!==''||!hostReady()}><Unplug class="size-4"/>Unlink</Button>{/if}
							{#if addon.installed&&!recordAttached(addon)}<Button variant="ghost" class="text-destructive" onclick={()=>remove(addon.id)} disabled={busy!==''}><Trash2 class="size-4"/>Uninstall</Button>{/if}
						</div>

						{#if addon.licenseAllowed===false}<p class="text-xs text-muted-foreground">This add-on is visible in the library but cannot be installed or linked because the licence does not include it.</p>{/if}
						{#if addon.installed&&!recordAttached(addon)&&!hostReady()}<p class="text-xs text-muted-foreground">Deploy and link the shared Engine first, then link this add-on to it.</p>{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
