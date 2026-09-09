<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { Activity, ExternalLink, Link2, RefreshCw, Server, Settings, ShieldCheck, Stethoscope, TerminalSquare, Wrench } from '@lucide/svelte';

	let addon:any=$state(null),loading=$state(true),error=$state('');
	const manageUrl=$derived(String(addon?.engineManageUrl||''));
	const link=(suffix='')=>manageUrl?`${manageUrl}${suffix}`:'';
	const ready=$derived(Boolean(addon?.installed&&addon?.attached&&addon?.setupComplete&&addon?.hostReady));
	const stateLabel=$derived(!addon?.installed?'Not installed':!addon?.attached?'Not linked':!addon?.setupComplete?'Setup required':addon?.runtime?.engineMode||'Ready');

	async function load(){
		loading=true;error='';
		try{const data=await api.get<any>('/addons/status');addon=(data.addons||[]).find((item:any)=>item.id==='apex')||null;}
		catch(e){error=e instanceof ApiError?e.message:e instanceof Error?e.message:'Unable to load APEX Master Control';}
		finally{loading=false;}
	}
	onMount(load);
</script>

<svelte:head><title>Apex Master Control · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div><p class="text-xs font-semibold uppercase tracking-[.18em] text-primary">APEX · OWNER / ADMIN</p><h1 class="mt-1 flex items-center gap-2 text-2xl font-semibold"><ShieldCheck class="size-5"/>Apex Master Control</h1><p class="mt-1 max-w-3xl text-sm text-muted-foreground">Administrative bridge to the shared APEX Engine Console. Normal sorter and converter settings remain in Panel; runtime, queues, diagnostics, logs and hard processor configuration live on the Engine Host.</p></div>
		<Button variant="outline" onclick={load} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button>
	</div>

	{#if !auth.isAdmin}
		<Card><CardContent class="p-8 text-center"><ShieldCheck class="mx-auto mb-3 size-8 text-muted-foreground"/><p class="font-medium">Owner or System Admin required</p><p class="mt-1 text-sm text-muted-foreground">APEX Master Control is intentionally hidden from normal workspace users.</p></CardContent></Card>
	{:else}
		{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
		<div class="grid gap-3 md:grid-cols-4">
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Panel install</p><Badge class="mt-2" variant={addon?.installed?'success':'secondary'}>{addon?.installed?'Installed':'Not installed'}</Badge></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Engine link</p><Badge class="mt-2" variant={addon?.attached?'success':'secondary'}>{addon?.attached?'Linked':'Not linked'}</Badge></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">Setup</p><Badge class="mt-2" variant={addon?.setupComplete?'success':'warning'}>{addon?.setupComplete?'Complete':'Required'}</Badge></CardContent></Card>
			<Card><CardContent class="p-4"><p class="text-xs text-muted-foreground">APEX state</p><Badge class="mt-2" variant={ready?'success':'secondary'}>{stateLabel}</Badge></CardContent></Card>
		</div>

		<Card>
			<CardHeader><CardTitle class="flex items-center gap-2"><Server class="size-4"/>Shared Engine Console</CardTitle><CardDescription>These controls operate on the customer's single shared Engine deployment. They are not duplicated inside the normal Panel APEX UI.</CardDescription></CardHeader>
			<CardContent>
				{#if manageUrl}
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<a href={manageUrl} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Activity class="size-4"/>APEX overview <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/configuration')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Settings class="size-4"/>Hard configuration <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/runtime')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Wrench class="size-4"/>Runtime controls <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/monitoring')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Activity class="size-4"/>Queue & monitoring <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/diagnostics')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Stethoscope class="size-4"/>Diagnostics <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/logs')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><TerminalSquare class="size-4"/>Logs <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/connections')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Link2 class="size-4"/>Connections <ExternalLink class="ml-auto size-3"/></Button></a>
						<a href={link('/setup')} target="_blank" rel="noreferrer"><Button class="w-full justify-start" variant="outline"><Server class="size-4"/>Engine setup <ExternalLink class="ml-auto size-3"/></Button></a>
					</div>
				{:else}<div class="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Deploy and link the shared Engine Host before using APEX Master Control.</div>{/if}
			</CardContent>
		</Card>

		<div class="grid gap-4 lg:grid-cols-2">
			<Card><CardHeader><CardTitle>Panel-owned APEX</CardTitle><CardDescription>Workspace-facing configuration stays here.</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><a href="/sorter-converter"><Button variant="outline">Apex Unit</Button></a><a href="/sorter-converter/sorter-settings"><Button variant="outline">Apex Settings</Button></a><a href="/sorter-converter/converter-settings"><Button variant="outline">Converter Settings</Button></a></CardContent></Card>
			<Card><CardHeader><CardTitle>Boundary</CardTitle><CardDescription>The Windows-era service buttons and runtime repair actions are retired from Panel.</CardDescription></CardHeader><CardContent class="text-sm text-muted-foreground">Panel owns user workflows, workspace settings, Library/Knowledge destinations and approvals. Engine Console owns backend runtime policy, processing queues, processor availability, diagnostics, logs and recovery.</CardContent></Card>
		</div>
	{/if}
</div>
