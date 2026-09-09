<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class={cn('text-sm font-semibold leading-none', className)} {...restProps}>
	{@render children?.()}
</div>
