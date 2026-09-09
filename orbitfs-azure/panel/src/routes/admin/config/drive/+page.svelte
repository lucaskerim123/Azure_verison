<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '$lib/components/ui';
	import { HardDriveDownload, LoaderCircle, Save, ShieldCheck } from '@lucide/svelte';

	let clientId = $state('');
	let enabled = $state(true);
	let configured = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let saved = $state(false);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api.get<{ clientId: string | null; enabled: boolean; configured: boolean }>('/drive-config');
			clientId = res.clientId ?? '';
			enabled = res.enabled !== false;
			configured = res.configured;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Failed to load Drive config';
		} finally {
			loading = false;
		}
	}

	load();
	async function save(e: Event) {
		e.preventDefault();
		saving = true;
		error = '';
		saved = false;
		try {
			const res = await api.patch<{ enabled: boolean; configured: boolean }>('/system/drive-config', { clientId: clientId.trim(), enabled });
			enabled = res.enabled !== false;
			configured = res.configured;
			saved = true;
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
	<div class="flex items-start justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-semibold"><HardDriveDownload class="size-5" />Drive config</h1>
			<p class="text-sm text-muted-foreground">Shared Google OAuth client configuration for OrbitFS Drive connections.</p>
		</div>
		<Badge variant={configured ? 'success' : enabled ? 'secondary' : 'warning'}>{configured ? 'Enabled' : enabled ? 'Not configured' : 'Off'}</Badge>
	</div>
	<Card>
		<CardHeader>
			<CardTitle>Google OAuth client</CardTitle>
			<CardDescription>One admin sets the client ID. Each OrbitFS user still signs into their own Google account.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading&hellip;</div>
			{:else}
				<form class="space-y-4" onsubmit={save}>
					<label class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
						<span>
							<span class="block font-medium">Show Google Drive upload</span>
							<span class="text-xs text-muted-foreground">When off, Files only shows the normal device upload controls.</span>
						</span>
						<input type="checkbox" class="size-4" bind:checked={enabled} />
					</label>
					<div class="space-y-1.5">
						<label for="drive-client-id" class="text-sm font-medium">OAuth client ID</label>
						<Input id="drive-client-id" bind:value={clientId} placeholder="xxxxx.apps.googleusercontent.com" autocomplete="off" disabled={!enabled} required={enabled} />
						<p class="text-xs text-muted-foreground">Use a Google OAuth 2.0 Web application client ID.</p>
					</div>
					{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
					{#if saved}<p class="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">Drive configuration saved.</p>{/if}
					<Button type="submit" disabled={saving || (enabled && !clientId.trim())}>
						{#if saving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}
						Save configuration
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>

	<div class="flex gap-3 rounded-lg border border-border bg-card p-4 text-sm">
		<ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p class="text-muted-foreground">The page stores only the OAuth client ID. It does not display or request a Google client secret.</p>
	</div>
</div>
