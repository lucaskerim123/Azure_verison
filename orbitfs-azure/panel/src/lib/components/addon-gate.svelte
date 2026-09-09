<script lang="ts">
	import type { Snippet } from 'svelte';
	import { addons } from '$lib/addons.svelte';
	import { PackageX } from '@lucide/svelte';

	let { addonId, label, children }: { addonId: string; label: string; children: Snippet } = $props();
	let addon = $derived(addons.get(addonId));
</script>

{#if !addons.loaded}
	<!-- haven't checked addon status yet — avoid flashing the unavailable state -->
{:else if addon && !addon.licensed}
	<div class="flex flex-col items-center justify-center gap-2 py-24 text-center text-destructive">
		<PackageX class="size-8" />
		<p class="text-sm">{label} is not licensed.</p>
		<p class="text-xs">{addon.licenseReason ?? 'A component entitlement is required.'}</p>
	</div>
{:else if addons.available(addonId)}
	{@render children()}
{:else}
	<div class="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
		<PackageX class="size-8" />
		<p class="text-sm">{label} is detached or offline.</p>
	</div>
{/if}
