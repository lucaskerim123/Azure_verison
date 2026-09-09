<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { CircleUser, LoaderCircle, RefreshCw, Trash2 } from '@lucide/svelte';
	type Session = { id:string; username:string; ip:string|null; userAgent:string|null; createdAt:string; lastSeenAt:string|null; expiresAt:string };
	let sessions = $state<Session[]>([]);
	let loading = $state(true);
	let error = $state('');
	let revoking = $state<string|null>(null);
	async function load() {
		loading = true; error = '';
		try { sessions = (await api.get<{sessions:Session[]}>('/sessions')).sessions; }
		catch (e) { error = e instanceof ApiError ? e.message : 'Failed to load sessions'; }
		finally { loading = false; }
	}
	async function revoke(id:string) {
		revoking = id; error = '';
		try { await api.delete(`/sessions/${id}`); await load(); }
		catch (e) { error = e instanceof ApiError ? e.message : 'Failed to revoke session'; }
		finally { revoking = null; }
	}
	load();
</script>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<div class="flex items-center justify-between gap-3">
		<div><h1 class="flex items-center gap-2 text-xl font-semibold"><CircleUser class="size-5" />Sessions</h1>
		<p class="text-sm text-muted-foreground">Active panel login sessions and revocation controls.</p></div>
		<Button variant="outline" size="sm" onclick={load} disabled={loading}><RefreshCw class="size-4" />Refresh</Button>
	</div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	<Card><CardHeader><CardTitle>Active sessions</CardTitle><CardDescription>Revoke any session you no longer want active.</CardDescription></CardHeader>
	<CardContent class="space-y-3">
		{#if loading}<div class="flex justify-center py-10"><LoaderCircle class="size-5 animate-spin" /></div>
		{:else if sessions.length === 0}<p class="text-sm text-muted-foreground">No active sessions.</p>
		{:else}{#each sessions as session (session.id)}
			<div class="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0 space-y-1">
					<div class="flex flex-wrap items-center gap-2"><strong class="text-sm">{session.username}</strong><Badge variant="secondary">{session.ip || 'Unknown IP'}</Badge></div>
					<p class="truncate text-xs text-muted-foreground">{session.userAgent || 'Unknown client'}</p>
					<p class="text-xs text-muted-foreground">Last seen {session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : 'never'} · expires {new Date(session.expiresAt).toLocaleString()}</p>
				</div>
				<Button size="sm" variant="destructive" onclick={() => revoke(session.id)} disabled={revoking === session.id}>
					{#if revoking === session.id}<LoaderCircle class="size-4 animate-spin" />{:else}<Trash2 class="size-4" />{/if}Revoke
				</Button>
			</div>
		{/each}{/if}
	</CardContent></Card>
</div>
