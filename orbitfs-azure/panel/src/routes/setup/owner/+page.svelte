<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { api, ApiError } from '$lib/api';
	import { Button, Input, Card, CardContent } from '$lib/components/ui';
	import { HardDrive, LoaderCircle, ShieldCheck } from '@lucide/svelte';

	let username = $state('');
	let email = $state('');
	let pin = $state('');
	let loading = $state(true);
	let submitting = $state(false);
	let error = $state('');

	onMount(async () => {
		try {
			const status = await api.get<{ setupComplete?: boolean; currentStep?: string }>('/setup/status');
			if (status.setupComplete) {
				await goto('/login');
				return;
			}
			if (status.currentStep !== 'owner') {
				await goto('/setup');
				return;
			}
		} catch {
			await goto('/setup');
			return;
		} finally {
			loading = false;
		}
	});

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			const result = await api.post<{ token: string; username: string; role: 'owner' | 'admin' | 'user' }>('/setup/owner', { username, email, pin });
			auth.set(result.token, { username: result.username, role: result.role, email: email || null });
			await goto('/setup/vercel');
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not create first owner';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
	<Card class="w-full max-w-md">
		<CardContent class="space-y-4 p-5">
			<div class="space-y-2 text-center">
				<div class="mx-auto flex size-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
					<HardDrive class="size-7" />
				</div>
				<h1 class="text-xl font-semibold">Create the first owner</h1>
				<p class="text-sm text-muted-foreground">Create the protected owner account, then OrbitFS will offer to connect your Vercel account for your standalone Engine Host.</p>
			</div>

			{#if loading}
				<div class="flex items-center justify-center py-6 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /></div>
			{:else}
				<div class="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
					<div class="flex items-center gap-2 font-medium"><ShieldCheck class="size-4" />Owner account</div>
					<p class="mt-1 text-muted-foreground">Use a real username and a 4-10 digit PIN. This signs you in immediately after creation.</p>
				</div>
				<form class="space-y-4" onsubmit={submit}>
					<div class="space-y-1.5">
						<label for="username" class="text-sm font-medium">Username</label>
						<Input id="username" bind:value={username} autocomplete="username" placeholder="Owner username" />
					</div>
					<div class="space-y-1.5">
						<label for="email" class="text-sm font-medium">Email <span class="text-muted-foreground">(optional)</span></label>
						<Input id="email" type="email" bind:value={email} autocomplete="email" placeholder="owner@example.com" />
					</div>
					<div class="space-y-1.5">
						<label for="pin" class="text-sm font-medium">PIN</label>
						<Input id="pin" type="password" bind:value={pin} autocomplete="new-password" placeholder="4-10 digit PIN" />
					</div>
					{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
					<div class="flex gap-2">
						<Button variant="outline" type="button" onclick={() => goto('/setup')}>Back</Button>
						<Button type="submit" class="flex-1" disabled={submitting}>
							{#if submitting}<LoaderCircle class="size-4 animate-spin" />{/if}
							Create owner
						</Button>
					</div>
				</form>
			{/if}
		</CardContent>
	</Card>
</div>
