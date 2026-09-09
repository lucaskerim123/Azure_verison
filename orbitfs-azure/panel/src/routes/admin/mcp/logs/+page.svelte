<script lang="ts">
	import { onMount } from 'svelte'; import { api,ApiError } from '$lib/api';
	import { Badge,Button,Card,CardContent,CardHeader,CardTitle } from '$lib/components/ui'; import { RefreshCw,ScrollText } from '@lucide/svelte';
	let logs=$state<any[]>([]),loading=$state(true),error=$state('');
	async function load(){loading=true;error='';try{logs=(await api.get<{logs:any[]}>('/mcp/logs?limit=250')).logs||[];}catch(e){error=e instanceof ApiError?e.message:'Failed to load MCP logs';}finally{loading=false;}}
	onMount(load); const when=(v:string)=>v?new Date(v).toLocaleString():'—';
</script>
<div class="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
	<div class="flex items-center justify-between gap-3"><div><h1 class="flex items-center gap-2 text-xl font-semibold"><ScrollText class="size-5"/>MCP logs</h1><p class="text-sm text-muted-foreground">Cloud MCP audit and runtime events stored in Supabase.</p></div><Button variant="outline" onclick={load} disabled={loading}><RefreshCw class={loading?'size-4 animate-spin':'size-4'}/>Refresh</Button></div>
	{#if error}<div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	<Card><CardHeader><CardTitle>Recent events</CardTitle></CardHeader><CardContent class="space-y-2">{#each logs as row}<div class="rounded-lg border p-3 text-sm"><div class="flex flex-wrap items-center justify-between gap-2"><strong>{row.event_type}</strong><Badge variant="outline">{row.scope_id||'public'}</Badge></div><p class="mt-1 text-xs text-muted-foreground">{when(row.created_at)}</p>{#if row.details && Object.keys(row.details).length}<pre class="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.details,null,2)}</pre>{/if}</div>{:else}<p class="py-8 text-center text-sm text-muted-foreground">No MCP events yet.</p>{/each}</CardContent></Card>
</div>
