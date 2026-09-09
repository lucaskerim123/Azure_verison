<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui';
	import { Database, Globe, HardDrive, LoaderCircle, RefreshCw, Server, ShieldCheck } from '@lucide/svelte';

	type Health = { ok?: boolean; status?: number; message?: string; checkedAt?: string };
	type ServiceStatus = {
		label?: string;
		role?: string;
		status?: string;
		state?: string;
		running?: boolean;
		reachable?: boolean;
		operational?: boolean;
		managedBy?: string;
		url?: string;
		apiBase?: string;
		bucket?: string;
		workspaces?: number;
		files?: number;
		licensed?: boolean;
		blocked?: boolean;
		health?: Health | null;
	};
	type SystemStatus = {
		checkedAt?: string;
		mode?: string;
		filesystem?: boolean;
		storageModel?: string;
		note?: string;
		panel?: ServiceStatus;
		database?: ServiceStatus;
		storage?: ServiceStatus;
		edge?: ServiceStatus;
		licence?: ServiceStatus;
	};

	const services = [
		{ key: 'panel', fallback: 'OrbitFS Panel', icon: Server },
		{ key: 'database', fallback: 'Supabase Database', icon: Database },
		{ key: 'storage', fallback: 'Supabase Storage', icon: HardDrive },
		{ key: 'edge', fallback: 'Vercel Edge', icon: Globe },
		{ key: 'licence', fallback: 'Licence Authority', icon: ShieldCheck }
	] as const;

	let status = $state<SystemStatus | null>(null);
	let loading = $state(true);
	let error = $state('');

	function serviceFor(key: typeof services[number]['key']) {
		return status?.[key];
	}
	function isOnline(service?: ServiceStatus) {
		return Boolean(service?.operational && service?.reachable !== false);
	}
	function statusVariant(service?: ServiceStatus) {
		return isOnline(service) ? 'success' : service?.blocked ? 'destructive' : 'warning';
	}
	function healthyCount() {
		return services.filter((item) => isOnline(serviceFor(item.key))).length;
	}

	async function load() {
		loading = true;
		error = '';
		try {
			status = await api.get<SystemStatus>('/system/status');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load system monitor';
		} finally {
			loading = false;
		}
	}

	load();
</script>

<div class="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
	<section class="rounded-2xl border bg-card p-5 shadow-sm">
		<div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.28em] text-primary">OrbitFS cloud health</p>
				<h1 class="mt-1 text-2xl font-semibold tracking-tight">System monitor</h1>
				<p class="mt-1 max-w-3xl text-sm text-muted-foreground">Live health for the Vercel Panel and its Supabase-backed data layer. No Windows services or persistent VPS filesystem are used by this edition.</p>
			</div>
			<div class="rounded-xl border bg-background/60 px-4 py-3 text-center">
				<div class="text-xl font-semibold">{healthyCount()}/{services.length}</div>
				<div class="text-xs text-muted-foreground">healthy components</div>
			</div>
		</div>
	</section>

	{#if error}
		<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="text-xs text-muted-foreground">
			Last checked: {status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'not checked'}
			{#if status?.storageModel} · storage model: {status.storageModel}{/if}
		</div>
		<Button variant="outline" size="sm" onclick={load} disabled={loading}>
			{#if loading}<LoaderCircle class="size-4 animate-spin" />{:else}<RefreshCw class="size-4" />{/if}
			Refresh
		</Button>
	</div>

	{#if loading && !status}
		<div class="flex items-center justify-center gap-2 py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" />Loading cloud health…</div>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each services as item (item.key)}
				{@const service = serviceFor(item.key)}
				{@const online = isOnline(service)}
				<Card class="overflow-hidden border-border/80 bg-card/90 shadow-sm">
					<div class="h-1.5 {online ? 'bg-emerald-400' : service?.blocked ? 'bg-red-500' : 'bg-amber-400'}"></div>
					<CardHeader class="pb-3">
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 items-center gap-3">
								<div class="grid size-11 place-items-center rounded-xl border bg-background/60"><item.icon class="size-5 text-primary" /></div>
								<div class="min-w-0">
									<CardTitle class="truncate text-base">{service?.label || item.fallback}</CardTitle>
									<p class="mt-1 text-xs text-muted-foreground">{service?.role || 'Cloud component'}</p>
								</div>
							</div>
							<Badge variant={statusVariant(service)}>{service?.status || 'Unknown'}</Badge>
						</div>
					</CardHeader>
					<CardContent class="space-y-3 text-xs">
						<div class="grid gap-2 rounded-xl border bg-background/45 p-3">
							{#if service?.managedBy}<div class="flex justify-between gap-3"><span class="text-muted-foreground">Managed by</span><span>{service.managedBy}</span></div>{/if}
							{#if service?.url}<div class="flex justify-between gap-3"><span class="text-muted-foreground">URL</span><span class="truncate text-right">{service.url}</span></div>{/if}
							{#if service?.apiBase}<div class="flex justify-between gap-3"><span class="text-muted-foreground">API base</span><span>{service.apiBase}</span></div>{/if}
							{#if service?.bucket}<div class="flex justify-between gap-3"><span class="text-muted-foreground">Bucket</span><span>{service.bucket}</span></div>{/if}
							{#if service?.workspaces !== undefined}<div class="flex justify-between gap-3"><span class="text-muted-foreground">Workspaces</span><span>{service.workspaces}</span></div>{/if}
							{#if service?.files !== undefined}<div class="flex justify-between gap-3"><span class="text-muted-foreground">Active file records</span><span>{service.files}</span></div>{/if}
							{#if service?.licensed !== undefined}<div class="flex justify-between gap-3"><span class="text-muted-foreground">Licence</span><span>{service.licensed ? 'Valid' : 'Blocked'}</span></div>{/if}
						</div>
						{#if service?.health}
							<div class="rounded-xl border p-3 {service.health.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/10'}">
								<div class="font-medium">{service.health.ok ? 'Health check passed' : 'Health check failed'}{service.health.status ? ` · HTTP ${service.health.status}` : ''}</div>
								<div class="mt-1 break-words text-muted-foreground">{service.health.message}</div>
							</div>
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}

	{#if status?.note}
		<div class="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">{status.note}</div>
	{/if}
</div>
