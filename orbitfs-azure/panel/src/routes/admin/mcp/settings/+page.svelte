<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { addons } from '$lib/addons.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { Cloud, Copy, Database, KeyRound, Plug, RefreshCw } from '@lucide/svelte';
	const mcpUrl='https://orbitconvert-mcp-addon.vercel.app/mcp';
	let runtime=$state<any>(null),dcr=$state<any>(null),loading=$state(true),error=$state(''),copied=$state('');
	async function load(){loading=true;error='';try{[runtime,dcr]=await Promise.all([api.get('/mcp/runtime'),api.get('/mcp/dcr-status')]);await addons.load();}catch(e){error=e instanceof ApiError?e.message:'Failed to load MCP cloud settings';}finally{loading=false;}}
	async function copy(value:string,label:string){await navigator.clipboard.writeText(value);copied=label;setTimeout(()=>copied='',1600);}
	load(); const addon=$derived(addons.get('mcp'));
</script>
<div class="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
	<div class="flex items-start justify-between gap-3"><div><h1 class="text-xl font-semibold">MCP overview & settings</h1><p class="text-sm text-muted-foreground">Cloud deployment, OAuth, DCR, ChatGPT UI and client access.</p></div><Button variant="outline" size="sm" onclick={load} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button></div>
	{#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	<div class="grid gap-4 md:grid-cols-3">
		<Card><CardHeader><CardTitle class="flex items-center gap-2"><Plug class="size-4"/>Module</CardTitle></CardHeader><CardContent><Badge variant={addon?.attached?'success':'secondary'}>{addon?.attached?'Attached':'Detached'}</Badge><p class="mt-2 text-xs text-muted-foreground">Licensed: {addon?.licensed?'Yes':'No'}</p></CardContent></Card>
		<Card><CardHeader><CardTitle class="flex items-center gap-2"><Cloud class="size-4"/>Runtime</CardTitle></CardHeader><CardContent><Badge variant={runtime?.online?'success':'destructive'}>{runtime?.serviceStatus||'Offline'}</Badge><p class="mt-2 text-xs text-muted-foreground">Transport: {runtime?.connectorPath||'/mcp'}</p></CardContent></Card>
		<Card><CardHeader><CardTitle class="flex items-center gap-2"><Database class="size-4"/>Storage</CardTitle></CardHeader><CardContent><Badge variant="secondary">Supabase</Badge><p class="mt-2 text-xs text-muted-foreground">Base, OAuth and MCP share the same Postgres database.</p></CardContent></Card>
	</div>
	<Card><CardHeader><CardTitle>ChatGPT App / Plugin</CardTitle><CardDescription>OAuth 2.1 + PKCE and MCP Apps UI are enabled. ChatGPT authenticates through your normal OrbitFS Project account.</CardDescription></CardHeader>
		<CardContent class="space-y-3 text-sm"><div class="flex flex-col gap-2 sm:flex-row sm:items-center"><code class="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 p-2">{mcpUrl}</code><Button variant="outline" onclick={()=>copy(mcpUrl,'mcp')}><Copy class="size-4"/>{copied==='mcp'?'Copied':'Copy MCP URL'}</Button></div>
			<div class="grid gap-2 md:grid-cols-3"><div class="rounded-md border p-3"><strong>1. Add app</strong><p class="mt-1 text-xs text-muted-foreground">In ChatGPT Developer Mode, create an app using the MCP URL above.</p></div><div class="rounded-md border p-3"><strong>2. Sign in</strong><p class="mt-1 text-xs text-muted-foreground">ChatGPT discovers OAuth and dynamically registers itself with OrbitFS.</p></div><div class="rounded-md border p-3"><strong>3. Use UI</strong><p class="mt-1 text-xs text-muted-foreground">OrbitFS tools and the interactive MCP Apps dashboard become available in ChatGPT.</p></div></div>
		</CardContent></Card>
	<Card><CardHeader><CardTitle class="flex items-center gap-2"><KeyRound class="size-4"/>Dynamic Client Registration</CardTitle><CardDescription>RFC 7591 compatibility for ChatGPT and other MCP clients. Public clients use Authorization Code + PKCE S256.</CardDescription></CardHeader>
		<CardContent class="space-y-4 text-sm">
			<div class="flex flex-wrap gap-2"><Badge variant={dcr?.enabled?'success':'destructive'}>{dcr?.enabled?'DCR enabled':'DCR disabled'}</Badge><Badge variant="outline">{dcr?.standard||'RFC 7591'}</Badge><Badge variant="outline">PKCE {dcr?.pkce||'S256'}</Badge><Badge variant="outline">{dcr?.registeredClients||0} registered</Badge></div>
			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">Registration endpoint</span><div class="mt-1 flex items-center gap-2"><code class="min-w-0 flex-1 overflow-x-auto">{dcr?.registrationEndpoint||'https://orbitconvert.vercel.app/oauth/register'}</code><Button size="sm" variant="ghost" onclick={()=>copy(dcr?.registrationEndpoint||'https://orbitconvert.vercel.app/oauth/register','dcr')}><Copy class="size-4"/></Button></div></div>
				<div class="rounded-md border p-3"><span class="text-xs text-muted-foreground">Authorization metadata</span><div class="mt-1 flex items-center gap-2"><code class="min-w-0 flex-1 overflow-x-auto">{dcr?.authorizationServerMetadata||'/.well-known/oauth-authorization-server'}</code></div></div>
			</div>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div class="rounded-md border p-3"><strong>Client type</strong><p class="text-xs text-muted-foreground">Web + native</p></div><div class="rounded-md border p-3"><strong>Client auth</strong><p class="text-xs text-muted-foreground">Public / none</p></div><div class="rounded-md border p-3"><strong>Grant</strong><p class="text-xs text-muted-foreground">Authorization code + refresh</p></div><div class="rounded-md border p-3"><strong>Management</strong><p class="text-xs text-muted-foreground">Registration access token</p></div></div>
			<p class="text-xs text-muted-foreground">Each DCR client is also added to MCP Client Registry. Disabling or disconnecting it revokes its OAuth access. DCR is retained for compatibility while newer MCP clients transition toward Client ID Metadata Documents.</p>
		</CardContent></Card>
	<Card><CardHeader><CardTitle>MCP Admin</CardTitle><CardDescription>Cloud-native MCP administration. No VPS service control is used.</CardDescription></CardHeader><CardContent class="grid gap-2 text-sm md:grid-cols-2"><a class="rounded-md border p-3 hover:bg-accent" href="/admin/mcp/runtime">Master Control</a><a class="rounded-md border p-3 hover:bg-accent" href="/admin/mcp/clients">Client Registry</a><a class="rounded-md border p-3 hover:bg-accent" href="/admin/mcp/startup">OSS Policy</a><a class="rounded-md border p-3 hover:bg-accent" href="/admin/mcp/logs">MCP Audit Log</a></CardContent></Card>
</div>
