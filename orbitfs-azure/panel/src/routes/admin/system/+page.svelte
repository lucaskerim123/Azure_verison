<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { Activity, ArrowRight } from '@lucide/svelte';
</script>

<svelte:head><title>System ? OrbitFS</title></svelte:head>
<div class="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
	<div><p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">OrbitFS Cloud</p><h1 class="mt-1 flex items-center gap-2 text-xl font-semibold"><Activity class="size-5"/>System</h1><p class="text-sm text-muted-foreground">OrbitFS runs on Vercel with Supabase-backed data and storage. Local server-service controls from the retired live-server edition are not part of this Panel.</p></div>
	<Card><CardHeader><CardTitle>Cloud service status</CardTitle><CardDescription>Use the current service-status page for Panel, database, storage, licence and deployment health.</CardDescription></CardHeader><CardContent><Button onclick={()=>goto('/admin/system/service-status')}>Open service status<ArrowRight class="size-4"/></Button></CardContent></Card>
</div>
