<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		class: className,
		value = $bindable(),
		ref = $bindable(null),
		...restProps
	}: HTMLInputAttributes & { ref?: HTMLInputElement | null } = $props();
</script>

<input
	bind:this={ref}
	bind:value
	class={cn(
		'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
		className
	)}
	{...restProps}
/>
