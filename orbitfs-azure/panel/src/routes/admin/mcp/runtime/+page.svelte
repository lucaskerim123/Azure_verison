<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui';
	import { Activity, Cloud, Database, RefreshCw } from '@lucide/svelte';
	let loading=$state(true),busy=$state(false),error=$state(''),message=$state(''); let status:any=$state(null);
	async function load(){loading=true;error='';try{status=await api.get('/mcp/master-control');}catch(e){error=e instanceof Error?e.message:'Unable to load MCP runtime';}finally{loading=false;}}
	async function control(action:string){busy=true;error='';message='';try{const r=await api.post<any>('/mcp/master-control',{action});status=r.status;message=`MCP engine: ${status?.state||action}`;}catch(e){error=e instanceof Error?e.message:'Engine control failed';}finally{busy=false;}}

	onMount(load);
</script>
<div class="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
	<div class="flex items-center justify-between gap-3"><div><h1 class="flex items-center gap-2 text-xl font-semibold"><Activity class="size-5"/>MCP Master Control</h1><p class="text-sm text-muted-foreground">Master runtime controls for the OrbitFS MCP cloud backend.</p></div><Button variant="outline" onclick={load} disabled={loading||busy}><RefreshCw class="size-4"/>Refresh</Button></div>
	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if message}<div class="rounded-lg border p-3 text-sm">{message}</div>{/if}
	<Card><CardHeader><CardTitle>Runtime Control</CardTitle></CardHeader><CardContent class="space-y-4">
		<div class="flex flex-wrap items-center gap-3"><Badge variant={status?.state==='standby'?'warning':status?.state==='running'?'success':'destructive'}>{status?.state||status?.serviceStatus||'Unknown'}</Badge><span class="text-sm text-muted-foreground">{status?.state==='standby'?'Ready for request-driven MCP work.':status?.state==='running'?'Engine enabled for MCP work.':status?.state==='stopped'?'MCP requests are blocked.':'Engine host unavailable.'}</span></div>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			<Button onclick={()=>control('start')} disabled={busy||status?.state==='running'}>Run</Button>
			<Button variant="outline" onclick={()=>control('standby')} disabled={busy||status?.state==='standby'}>Standby</Button>
			<Button variant="destructive" onclick={()=>control('stop')} disabled={busy||status?.state==='stopped'}>Stop</Button>
			<Button variant="outline" onclick={()=>control('restart')} disabled={busy}>Restart</Button>
		</div>
		<p class="text-xs text-muted-foreground">Controls are issued from this main OrbitFS site to the private add-on engine host. Stopped is enforced by the engine and rejects MCP transport requests.</p>
	</CardContent></Card>
	<div class="grid gap-4 md:grid-cols-2">
		<Card><CardHeader><CardTitle class="flex items-center gap-2"><Cloud class="size-4"/>Runtime</CardTitle></CardHeader><CardContent class="space-y-3 text-sm"><div class="flex justify-between"><span>Compute</span><strong>Vercel</strong></div><div class="flex justify-between"><span>Mode</span><strong>{status?.mode||'cloud'}</strong></div><div class="flex justify-between"><span>Transport</span><code>{status?.connectorPath||'/mcp'}</code></div><div class="flex justify-between"><span>Generation</span><strong>{status?.generation??'—'}</strong></div><div class="flex justify-between"><span>Last request</span><strong>{status?.lastRequestAt?new Date(status.lastRequestAt).toLocaleString():'—'}</strong></div></CardContent></Card>
		<Card><CardHeader><CardTitle class="flex items-center gap-2"><Database class="size-4"/>Persistence</CardTitle></CardHeader><CardContent class="space-y-3 text-sm"><div class="flex justify-between"><span>Database</span><strong>Supabase Postgres</strong></div><div class="flex justify-between"><span>Workspace integration</span><strong>{status?.workspaceIntegration?'Active':'Off'}</strong></div><div class="flex justify-between"><span>Licence</span><strong>{status?.licensed?'Allowed':'Blocked'}</strong></div><div class="flex justify-between"><span>Attached</span><strong>{status?.attached?'Yes':'No'}</strong></div></CardContent></Card>
	</div>
	<Card><CardHeader><CardTitle>Connection</CardTitle></CardHeader><CardContent class="space-y-2 text-sm"><p>MCP endpoint: <code>{status?.publicBaseUrl ? `${status.publicBaseUrl}/mcp` : '/mcp'}</code></p><p class="text-muted-foreground">This is the control surface. The engine host itself has no public admin UI.</p></CardContent></Card>
</div>
