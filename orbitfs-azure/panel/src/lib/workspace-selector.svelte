<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { workspace } from './workspace.svelte';
	import { ChevronDown, Check, Building2 } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	function pick(id: string) {
		workspace.select(id);
		goto('/');
	}
</script>

{#if workspace.enabled}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="flex h-8 max-w-40 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium hover:bg-accent sm:max-w-48"
		>
			<Building2 class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate">{workspace.current?.name ?? 'Select workspace'}</span>
			<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				class="z-50 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
				sideOffset={6}
				align="start"
			>
				{#each workspace.workspaces as ws (ws.id)}
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
						onSelect={() => pick(ws.id)}
					>
						<span class="flex size-4 items-center justify-center">
							{#if ws.id === workspace.currentId}<Check class="size-4 text-primary" />{/if}
						</span>
						<span class="flex-1 truncate">{ws.name}</span>
						{#if ws.is_main}
							<span class="text-xs text-muted-foreground">Main</span>
						{/if}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>
{/if}
