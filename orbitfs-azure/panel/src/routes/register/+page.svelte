<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Cloud, Database, Eye, EyeOff, LoaderCircle, ShieldCheck, UserPlus } from '@lucide/svelte';

	let username = $state('');
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let submitting = $state(false);
	let error = $state('');
	let firstRun = $state(page.url.searchParams.get('setup') === '1');

	onMount(async () => {
		const me = await fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
		if (me?.authenticated) { window.location.replace('/'); return; }
		const status = await fetch('/api/setup/status', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
		firstRun = Boolean(status?.needsSetup);
	});

	async function register(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (password !== confirmPassword) return void (error = 'Passwords do not match');
		submitting = true;
		try {
			const response = await fetch('/api/auth/register', {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, displayName: displayName || username, email, password })
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || 'Registration failed');
			window.location.assign('/');
		} catch (err) { error = err instanceof Error ? err.message : 'Registration failed'; }
		finally { submitting = false; }
	}
</script>

<svelte:head><title>Register · OrbitFS</title></svelte:head>

<div class="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-8 text-foreground">
	<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.16),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_32%)]"></div>
	<section class="relative grid w-full max-w-5xl gap-5 lg:grid-cols-[1fr_1fr] lg:items-center">
		<div class="hidden rounded-3xl border bg-card/70 p-8 shadow-2xl lg:block">
			<div class="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary"><ShieldCheck class="size-3.5" /> {firstRun ? 'First-run owner setup' : 'OrbitFS account registration'}</div>
			<h1 class="mt-5 text-4xl font-semibold tracking-tight">{firstRun ? 'Create the first OrbitFS owner.' : 'Create your OrbitFS account.'}</h1>
			<p class="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{firstRun ? 'The first registered account becomes the owner and gets a private workspace plus the Public Workspace.' : 'New accounts get their own private workspace and can be added to shared workspaces and groups.'}</p>
			<div class="mt-6 grid grid-cols-2 gap-3">
				<div class="rounded-2xl border bg-background/60 p-4"><Cloud class="size-5 text-primary" /><p class="mt-3 text-sm font-medium">Runs on Vercel</p><p class="text-xs text-muted-foreground">No VPS required</p></div>
				<div class="rounded-2xl border bg-background/60 p-4"><Database class="size-5 text-primary" /><p class="mt-3 text-sm font-medium">Stored in Supabase</p><p class="text-xs text-muted-foreground">Users, sessions and Base System data</p></div>
			</div>
		</div>

		<div class="mx-auto w-full max-w-md rounded-3xl border bg-card/90 p-6 shadow-2xl backdrop-blur">
			<div class="mb-6 text-center"><div class="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground"><UserPlus class="size-7" /></div><h1 class="mt-4 text-2xl font-semibold">{firstRun ? 'Set up OrbitFS' : 'Create account'}</h1><p class="mt-1 text-sm text-muted-foreground">{firstRun ? 'Create the first owner account.' : 'Register for the standalone Base Panel.'}</p></div>
			<form class="space-y-4" onsubmit={register}>
				<div class="grid gap-4 sm:grid-cols-2"><div><label class="mb-1.5 block text-sm font-medium" for="username">Username</label><input id="username" class="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" autocomplete="username" bind:value={username} required /></div><div><label class="mb-1.5 block text-sm font-medium" for="display">Display name</label><input id="display" class="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" bind:value={displayName} placeholder="Optional" /></div></div>
				<div><label class="mb-1.5 block text-sm font-medium" for="email">Email</label><input id="email" class="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" type="email" autocomplete="email" bind:value={email} placeholder="Optional" /></div>
				<div><label class="mb-1.5 block text-sm font-medium" for="password">Password</label><div class="relative"><input id="password" class="h-11 w-full rounded-lg border border-input bg-background px-3 pr-11 text-sm" type={showPassword ? 'text' : 'password'} autocomplete="new-password" bind:value={password} required /><button type="button" class="absolute right-1 top-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" onclick={() => showPassword = !showPassword} aria-label="Toggle password">{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}</button></div><p class="mt-1 text-xs text-muted-foreground">8-128 characters, including a letter and a number.</p></div>
				<div><label class="mb-1.5 block text-sm font-medium" for="confirm">Confirm password</label><input id="confirm" class="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" type={showPassword ? 'text' : 'password'} autocomplete="new-password" bind:value={confirmPassword} required /></div>
				{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>{/if}
				<button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50" type="submit" disabled={submitting || !username || !password || !confirmPassword}>{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if} {firstRun ? 'Create owner and start' : 'Create account'}</button>
			</form>
			{#if !firstRun}<div class="mt-5 border-t pt-5 text-center text-sm text-muted-foreground">Already registered? <a class="font-medium text-primary hover:underline" href="/login">Sign in</a></div>{/if}
		</div>
	</section>
</div>
