<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button, Badge } from '$lib/components/ui';
	import { ScrollText, RefreshCw, LoaderCircle } from '@lucide/svelte';

	// server.js's own `logEvent()` call sites, minus the high-volume/low-signal ones
	// (every single HTTP request, raw child-process stdout/stderr spam, verbose
	// PowerShell command echoes) — those stay visible under "Show all activity".
	const SECURITY_EVENTS = new Set([
		'panel.login.ok',
		'panel.login.failed',
		'panel.addon.attached',
		'panel.addon.detached',
		'panel.drive_config.updated',
		'panel.guarded_hardstop.denied',
		'panel.guarded_hardstop.start',
		'panel.guarded_hardstop.ok',
		'panel.license.activated',
		'panel.maintenance.updated',
		'panel.server.start',
		'panel.setup.complete',
		'license.service_stop',
		'mcp.refresh_perms',
		'mcp.refresh_config',
		'mcp.global_sync',
		'mcp.override.enabled',
		'mcp.override.disabled',
		'mcp.override.denied'
	]);

	type LogEntry = Record<string, unknown> & { ts?: string; event?: string; user?: string; username?: string };

	let entries = $state<LogEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let showAll = $state(false);

	const filtered = $derived(showAll ? entries : entries.filter((e) => SECURITY_EVENTS.has(String(e.event))));

	function variantFor(event: string) {
		if (event.includes('failed') || event.includes('denied') || event.includes('error')) return 'destructive';
		if (event.includes('detached') || event.includes('stop')) return 'warning';
		return 'secondary';
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api.get<{ lines: string[]; error?: string }>('/system/logs?which=panel-events');
			entries = res.lines
				.map((line) => {
					try {
						return JSON.parse(line) as LogEntry;
					} catch {
						return null;
					}
				})
				.filter((e): e is LogEntry => e !== null)
				.reverse();
			if (res.error) error = res.error;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load audit log';
		} finally {
			loading = false;
		}
	}
	load();
</script>

<div class="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
				<ScrollText class="size-5 text-muted-foreground" />
				Audit log
			</h1>
			<p class="text-sm text-muted-foreground">
				Most recent {entries.length} events. Security-relevant events are shown by default.
			</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => (showAll = !showAll)}>
				{showAll ? 'Security events only' : 'Show all activity'}
			</Button>
			<Button variant="outline" size="sm" onclick={load} disabled={loading}>
				<RefreshCw class="size-4" />
			</Button>
		</div>
	</div>

	{#if error}
		<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{error}
		</div>
	{/if}

	<div class="overflow-hidden rounded-lg border border-border bg-card">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-16 text-muted-foreground">
				<LoaderCircle class="size-5 animate-spin" />
				Loading&hellip;
			</div>
		{:else if filtered.length === 0}
			<p class="p-8 text-center text-sm text-muted-foreground">No events to show.</p>
		{:else}
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-muted-foreground">
						<th class="px-4 py-2 font-medium">Time</th>
						<th class="px-4 py-2 font-medium">Event</th>
						<th class="hidden px-4 py-2 font-medium sm:table-cell">User</th>
						<th class="hidden px-4 py-2 font-medium md:table-cell">Details</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as entry, i (i)}
						{@const { ts, event, user, username, ...rest } = entry}
						<tr class="border-b border-border last:border-0 hover:bg-accent/40">
							<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
								{ts ? new Date(ts).toLocaleString() : '—'}
							</td>
							<td class="px-4 py-2">
								<Badge variant={variantFor(String(event ?? ''))}>{event ?? 'unknown'}</Badge>
							</td>
							<td class="hidden px-4 py-2 sm:table-cell">{user ?? username ?? '—'}</td>
							<td class="hidden max-w-xs truncate px-4 py-2 font-mono text-xs text-muted-foreground md:table-cell">
								{Object.keys(rest).length ? JSON.stringify(rest) : ''}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
