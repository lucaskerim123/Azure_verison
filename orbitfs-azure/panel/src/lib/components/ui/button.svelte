<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
				destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
				outline: 'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
				secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
				ghost: 'hover:bg-accent hover:text-accent-foreground',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-8 px-3 py-1.5',
				sm: 'h-7 rounded-md px-2.5 text-xs',
				lg: 'h-9 rounded-md px-4',
				icon: 'size-8'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		children,
		...restProps
	}: HTMLButtonAttributes & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLButtonElement | null;
	} = $props();
</script>

<button bind:this={ref} class={cn(buttonVariants({ variant, size }), className)} {...restProps}>
	{@render children?.()}
</button>
