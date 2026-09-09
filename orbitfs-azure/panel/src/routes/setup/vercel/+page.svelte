<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import { Button, Input, Card, CardContent } from '$lib/components/ui';
	import { Cloud, LoaderCircle, ShieldCheck } from '@lucide/svelte';

	let token = $state('');
	let teamId = $state('');
	let submitting = $state(false);
	let error = $state('');

	async function connect(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			await api.post('/vercel-connection', { token, teamId: teamId || null });
			token = '';
			await goto('/admin/addons');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not connect Vercel';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
	<Card class="w-full max-w-lg">
		<CardContent class="space-y-5 p-5">
			<div class="space-y-2 text-center">
				<div class="mx-auto flex size-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><Cloud class="size-7" /></div>
				<h1 class="text-xl font-semibold">Connect Vercel</h1>
				<p class="text-sm text-muted-foreground">OrbitFS uses your Vercel account to create your own standalone Engine Host. Your token is validated server-side and stored encrypted; it is never exposed back to the browser.</p>
			</div>

			<div class="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
				<div class="flex items-center gap-2 font-medium"><ShieldCheck class="size-4" />Customer-owned hosting</div>
				<p class="mt-1 text-muted-foreground">Your Engine runs in your Vercel account and gets its own project and URL. OrbitFS only uses this connection for Engine deployment and status operations.</p>
			</div>

			<form class="space-y-4" onsubmit={connect}>
				<div class="space-y-1.5">
					<label for="vercel-token" class="text-sm font-medium">Vercel API token</label>
					<Input id="vercel-token" type="password" bind:value={token} autocomplete="off" placeholder="Paste Vercel token" />
					<p class="text-xs text-muted-foreground">Create the token in your Vercel account settings. Do not add it as a Vercel project environment variable.</p>
				</div>
				<div class="space-y-1.5">
					<label for="vercel-team" class="text-sm font-medium">Vercel Team ID or slug <span class="text-muted-foreground">(optional)</span></label>
					<Input id="vercel-team" bind:value={teamId} autocomplete="off" placeholder="Leave blank for personal account" />
				</div>
				{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
				<div class="flex gap-2">
					<Button variant="outline" type="button" onclick={() => goto('/')}>Skip for now</Button>
					<Button type="submit" class="flex-1" disabled={submitting || !token.trim()}>
						{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if}
						Connect Vercel
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
