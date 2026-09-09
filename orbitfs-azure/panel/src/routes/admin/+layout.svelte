<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { ShieldAlert } from '@lucide/svelte';

	let { children } = $props();
</script>

{#if auth.isAdmin}
	{@render children()}
{:else}
	<div class="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
		<ShieldAlert class="size-8" />
		<p class="text-sm">Admin access required.</p>
	</div>
{/if}
