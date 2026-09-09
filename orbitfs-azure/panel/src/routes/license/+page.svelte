<script lang="ts">
	import { onMount } from 'svelte';
	import { KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Server, Clock3 } from '@lucide/svelte';

	let summary = $state<any>(null);
	let provider = $state<any>(null);
	let diagnostics = $state<any>(null);
	let licenseKey = $state('');
	let loading = $state(true);
	let checking = $state(false);
	let activating = $state(false);
	let clearing = $state(false);
	let testing = $state(false);
	let error = $state('');
	let message = $state('');

	function componentEntries() {
		return Object.entries(summary?.components || {}) as [string, any][];
	}

	function when(value: string | null | undefined) {
		if (!value) return 'Not yet';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
	}

	async function loadProvider() {
		try {
			const response = await fetch('/api/license/provider', { cache: 'no-store' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || 'Could not load master licence service');
			provider = payload;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load master licence service';
		}
	}

	async function load(refresh = false) {
		if (refresh) checking = true;
		else loading = true;
		error = '';
		try {
			const response = await fetch(`/api/license/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
			const payload = await response.json();
			summary = payload;
			if (!response.ok && !payload?.licensed) throw new Error(payload.refreshError || payload.error || 'Could not check licence');
			if (refresh) message = payload.licensed ? 'Licence checked with the master service.' : 'Licence is not active.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not check licence';
		} finally {
			loading = false;
			checking = false;
		}
	}

	async function testMaster() {
		testing = true;
		error = '';
		message = '';
		try {
			const response = await fetch('/api/license/provider/test', { method: 'POST', cache: 'no-store' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || 'Master licence service test failed');
			diagnostics = payload;
			message = payload.provider?.ok ? 'Master licence service is reachable.' : 'Master licence service responded with a problem.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Master licence service test failed';
		} finally {
			testing = false;
		}
	}

	async function activate(event: SubmitEvent) {
		event.preventDefault();
		const wasLicensed = summary?.licensed === true;
		error = '';
		message = '';
		activating = true;
		try {
			const response = await fetch('/api/license/activate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ licenseKey })
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || 'Licence activation failed');
			summary = payload.license;
			licenseKey = '';
			message = wasLicensed ? 'Licence key replaced and validated.' : 'OrbitFS licence activated.';
			if (!wasLicensed) {
				const setup = await fetch('/api/setup/status', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
				window.location.assign(setup?.needsSetup ? '/register?setup=1' : '/login');
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Licence activation failed';
		} finally {
			activating = false;
		}
	}

	async function clearLocal() {
		if (!summary?.keyHint) return;
		if (!window.confirm('Clear the licence key and entitlement cached on this OrbitFS installation? This does not unlock the installation in the Website License Controller.')) return;
		clearing = true;
		error = '';
		message = '';
		try {
			const response = await fetch('/api/license/activate', { method: 'DELETE', cache: 'no-store' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || 'Could not clear local licence state');
			summary = payload.license;
			licenseKey = '';
			message = 'Local licence key and cached entitlement cleared. The master installation lock was not changed.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not clear local licence state';
		} finally {
			clearing = false;
		}
	}

	onMount(() => {
		void Promise.all([load(), loadProvider()]);
	});
</script>

<svelte:head><title>Licence · OrbitFS</title></svelte:head>

<div class="relative min-h-dvh bg-background px-4 py-8 text-foreground">
	<div class="mx-auto w-full max-w-4xl space-y-5">
		<section class="rounded-3xl border bg-card p-6 shadow-xl sm:p-8">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${summary?.licensed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
						<ShieldCheck class="size-3.5" /> {summary?.licensed ? 'Licensed' : 'Licence required'}
					</div>
					<h1 class="mt-4 text-2xl font-semibold tracking-tight">OrbitFS licence</h1>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">OrbitFS Website is the master licence authority. Activation locks the key to this installation. This installation checks the master automatically and you can run a manual check at any time.</p>
				</div>
				<button class="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50" onclick={() => load(true)} disabled={checking}>
					<RefreshCw class={`size-4 ${checking ? 'animate-spin' : ''}`} /> Check now
				</button>
			</div>

			{#if loading}
				<div class="mt-8 flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Checking master licence…</div>
			{:else}
				<div class="mt-6 grid gap-3 sm:grid-cols-3">
					<div class="rounded-xl border bg-background/60 p-4"><p class="text-xs uppercase tracking-wide text-muted-foreground">Status</p><p class="mt-1 font-medium">{summary?.licensed ? 'Active' : 'Blocked'}</p><p class="mt-1 text-xs text-muted-foreground">{summary?.reason || 'Master validated'}</p></div>
					<div class="rounded-xl border bg-background/60 p-4"><p class="text-xs uppercase tracking-wide text-muted-foreground">Current key</p><p class="mt-1 font-mono text-sm">{summary?.keyHint || 'No key stored'}</p><p class="mt-1 text-xs text-muted-foreground">A new key replaces this only after successful master activation.</p></div>
					<div class="rounded-xl border bg-background/60 p-4"><p class="text-xs uppercase tracking-wide text-muted-foreground">Installation ID</p><p class="mt-1 break-all font-mono text-[11px]">{summary?.installationId || 'pending'}</p><p class="mt-1 text-xs text-muted-foreground">The master locks the licence to this installation.</p></div>
				</div>

				<div class="mt-4 rounded-xl border p-4">
					<div class="flex items-center gap-2 text-sm font-medium"><Clock3 class="size-4" /> Automatic validation</div>
					<div class="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><p>Last master check: {when(summary?.lastCheckedAt)}</p><p>Next scheduled check: {when(summary?.nextValidationAt)}</p></div>
				</div>

				<div class="mt-4 rounded-xl border p-4">
					<p class="text-sm font-medium">Component entitlements</p>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each componentEntries() as [componentId, component]}
							<span class={`rounded-md border px-2.5 py-1.5 font-mono text-xs ${component?.allowed ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-destructive/30 bg-destructive/10'}`}>
								{componentId}: {component?.allowed ? component?.state || 'enabled' : component?.reason || 'blocked'}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if summary?.refreshError}<div class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">Last master check problem: {summary.refreshError}</div>{/if}
			{#if error}<div class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>{/if}
			{#if message}<div class="mt-4 rounded-lg border px-4 py-3 text-sm">{message}</div>{/if}
		</section>

		<div class="grid gap-5 lg:grid-cols-2">
			<section class="rounded-2xl border bg-card p-5">
				<div class="flex items-center gap-3"><KeyRound class="size-5" /><div><h2 class="font-semibold">{summary?.licensed ? 'Replace licence key' : 'Activate OrbitFS'}</h2><p class="text-xs text-muted-foreground">A replacement key is written locally only after the Website master accepts it.</p></div></div>
				<form class="mt-5 space-y-3" onsubmit={activate}>
					<label class="block text-sm font-medium" for="license-key">Licence key</label>
					<input id="license-key" class="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm" bind:value={licenseKey} autocomplete="off" spellcheck="false" placeholder="OFS-XXXX-XXXX-XXXX-XXXX" />
					<div class="flex flex-wrap gap-2">
						<button class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50" type="submit" disabled={activating || clearing || !licenseKey.trim()}>
							{#if activating}<LoaderCircle class="size-4 animate-spin" />{/if}{summary?.licensed ? 'Activate replacement key' : 'Activate licence'}
						</button>
						{#if summary?.keyHint}
							<button class="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm hover:bg-muted disabled:opacity-50" type="button" onclick={clearLocal} disabled={clearing || activating}>
								{#if clearing}<LoaderCircle class="mr-2 size-4 animate-spin" />{/if}Clear local key
							</button>
						{/if}
					</div>
					{#if summary?.keyHint}<p class="text-xs text-muted-foreground">Clear local key removes this installation's stored key and entitlement cache only. Use the Website License Controller to unlock the master installation binding.</p>{/if}
				</form>
			</section>

			<section class="rounded-2xl border bg-card p-5">
				<div class="flex items-center gap-3"><Server class="size-5" /><div><h2 class="font-semibold">Master licence service</h2><p class="text-xs text-muted-foreground">Fixed to OrbitFS Website. Old local or environment provider values cannot redirect licence checks.</p></div></div>
				<div class="mt-4 rounded-lg border bg-background/50 p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">API</p><p class="mt-1 break-all font-mono text-xs">{provider?.providerBase || 'https://orbitfsstore.vercel.app/api/license/v1'}</p></div>
				<button class="mt-3 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs hover:bg-muted disabled:opacity-50" type="button" onclick={testMaster} disabled={testing}>{#if testing}<LoaderCircle class="size-3.5 animate-spin" />{:else}<RefreshCw class="size-3.5" />{/if} Test master API</button>
				{#if diagnostics}<p class="mt-3 text-xs text-muted-foreground">API status: {diagnostics.provider?.ok ? 'Reachable' : diagnostics.provider?.error || 'Problem detected'}</p>{/if}
			</section>
		</div>
	</div>
</div>
