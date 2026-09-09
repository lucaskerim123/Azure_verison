<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui';
	import { Bell, LoaderCircle, Inbox } from '@lucide/svelte';

	type Notice = { id: string; title: string; message: string; severity: 'info' | 'warning' | 'critical' | 'system'; createdAt: string; createdBy: string; read: boolean };
	let notices = $state<Notice[]>([]);
	let loading = $state(true);
	let error = $state('');
	const unread = $derived(notices.filter((n) => !n.read).length);

	async function load() {
		loading = true; error = '';
		try { notices = (await api.get<{ notifications: Notice[] }>('/notifications')).notifications; }
		catch (err) { error = err instanceof ApiError ? err.message : 'Failed to load notifications'; }
		finally { loading = false; }
	}
	async function markRead(notice: Notice) {
		if (notice.read) return;
		await api.post('/notifications/' + notice.id + '/read');
		notice.read = true; notices = [...notices];
	}
	load();
</script>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<header class="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl shadow-black/20">
		<div class="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-5 py-4">
			<div><p class="text-xs font-semibold uppercase tracking-wide text-primary">Message centre</p><h1 class="flex items-center gap-2 text-2xl font-semibold"><Bell class="size-6" />Notifications</h1><p class="text-sm text-muted-foreground">Global messages, alerts, and system notices.</p></div>
			<Badge variant={unread ? 'warning' : 'secondary'}>{unread} unread</Badge>
		</div>
	</header>
	{#if loading}<div class="flex justify-center py-16"><LoaderCircle class="animate-spin" /></div>
	{:else if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
	{:else if notices.length === 0}<Card><CardContent class="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground"><Inbox class="size-9" /><p>No notifications.</p></CardContent></Card>
	{:else}<div class="space-y-3">{#each notices as notice (notice.id)}<Card class="border-border/80 shadow-sm {notice.severity === 'system' ? 'border-destructive/50 bg-destructive/10' : !notice.read ? 'border-primary/50 bg-primary/5' : 'bg-card'}">
		<CardHeader><div class="flex items-start justify-between gap-3"><div><p class="mb-1 text-xs font-semibold uppercase tracking-wide {notice.severity === 'system' ? 'text-destructive' : 'text-muted-foreground'}">{notice.severity === 'system' ? 'OrbitFS System' : notice.createdBy}</p><CardTitle class={notice.severity === 'system' ? 'text-destructive' : ''}>{notice.title}</CardTitle></div><Badge variant={notice.severity === 'critical' || notice.severity === 'system' ? 'destructive' : notice.severity === 'warning' ? 'warning' : 'secondary'}>{notice.severity === 'system' ? 'System' : notice.severity}</Badge></div></CardHeader>
		<CardContent class="space-y-3"><p class="whitespace-pre-wrap text-sm">{notice.message}</p><div class="flex items-center justify-between text-xs text-muted-foreground"><span>{new Date(notice.createdAt).toLocaleString()}</span>{#if !notice.read}<Button size="sm" variant="outline" onclick={() => markRead(notice)}>Mark read</Button>{/if}</div></CardContent>
	</Card>{/each}</div>{/if}
</div>
