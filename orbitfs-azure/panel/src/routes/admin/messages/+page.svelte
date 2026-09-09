<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '$lib/components/ui';
	import { Bell, LoaderCircle, Send, Trash2 } from '@lucide/svelte';

	type Notice = { id: string; title: string; message: string; severity: 'info' | 'warning' | 'critical' | 'system'; targetUser: string | null; createdAt: string; createdBy: string };
	let notices = $state<Notice[]>([]);
	let users = $state<{ username: string }[]>([]);
	let title = $state(''); let message = $state(''); let severity = $state<'info'|'warning'|'critical'|'system'>('info'); let targetUser = $state('');
	let loading = $state(true); let saving = $state(false); let error = $state('');

	async function load() {
		loading = true; error = '';
		try {
			const [messagesRes, usersRes] = await Promise.all([api.get<{ notifications: Notice[] }>('/admin/notifications'), api.get<{ users: { username: string }[] }>('/users')]);
			notices = messagesRes.notifications; users = usersRes.users;
		} catch (err) { error = err instanceof ApiError ? err.message : 'Failed to load messages'; }
		finally { loading = false; }
	}

	async function send(e: Event) {
		e.preventDefault(); saving = true; error = '';
		try { await api.post('/admin/notifications', { title, message, severity, targetUser: targetUser || null }); title = ''; message = ''; targetUser = ''; await load(); }
		catch (err) { error = err instanceof ApiError ? err.message : 'Message failed'; }
		finally { saving = false; }
	}

	async function remove(id: string) { await api.delete(`/admin/notifications/${id}`); await load(); }
	load();
</script>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><Bell class="size-5" />Message system</h1><p class="text-sm text-muted-foreground">Send global notices, critical alerts or direct messages to a user.</p></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	<Card><CardHeader><CardTitle>New message</CardTitle></CardHeader><CardContent><form class="space-y-3" onsubmit={send}>
		<Input bind:value={title} placeholder="Title" required />
		<textarea bind:value={message} required rows="4" placeholder="Message" class="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none"></textarea>
		<div class="grid gap-3 sm:grid-cols-2"><select bind:value={severity} class="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical alert</option><option value="system">System message</option></select>
		<select bind:value={targetUser} class="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">All users</option>{#each users as user}<option value={user.username}>{user.username}</option>{/each}</select></div>
		<Button type="submit" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" />{:else}<Send />{/if}Send</Button>
	</form></CardContent></Card>
	<Card><CardHeader><CardTitle>Sent messages</CardTitle></CardHeader><CardContent class="space-y-3">
		{#if loading}<LoaderCircle class="animate-spin" />{:else if notices.length === 0}<p class="text-sm text-muted-foreground">No messages sent.</p>{:else}{#each notices as notice (notice.id)}<div class="flex items-start gap-3 rounded-md border p-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="text-sm">{notice.title}</strong><Badge variant={notice.severity === 'critical' || notice.severity === 'system' ? 'destructive' : notice.severity === 'warning' ? 'warning' : 'secondary'}>{notice.severity === 'system' ? 'OrbitFS System' : notice.severity}</Badge><span class="text-xs text-muted-foreground">{notice.targetUser ?? 'All users'}</span></div><p class="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{notice.message}</p></div><Button size="sm" variant="ghost" onclick={() => remove(notice.id)} aria-label="Delete"><Trash2 /></Button></div>{/each}{/if}
	</CardContent></Card>
</div>