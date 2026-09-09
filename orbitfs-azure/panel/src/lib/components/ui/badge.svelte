<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const badgeVariants = tv({
		base: 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap',
		variants: {
			variant: {
				default: 'border-transparent bg-primary/15 text-primary',
				secondary: 'border-transparent bg-secondary text-secondary-foreground',
				destructive: 'border-transparent bg-destructive/15 text-destructive',
				warning: 'border-transparent bg-warning/15 text-warning',
				success: 'border-transparent bg-success/15 text-success',
				outline: 'text-foreground border-border'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		class: className,
		variant = 'default',
		children,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant } = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...restProps}>
	{@render children?.()}
</span>
