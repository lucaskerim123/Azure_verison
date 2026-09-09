<script lang="ts">
	import ContextLibraryPanel from '$lib/components/mcp/context-library-panel.svelte';
</script>

<svelte:head><title>Complex Context System (CCS) · OrbitFS</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-3 p-4 pb-0 md:p-6 md:pb-0">
	<p class="text-xs font-semibold uppercase tracking-[.2em] text-primary">MCP · Panel</p>
	<h1 class="text-xl font-semibold">Complex Context System (CCS)</h1>
	<p class="max-w-3xl text-sm text-muted-foreground">Create reusable context bundles from canonical Library knowledge, Profiles and other CCS bundles. Raw server filesystem paths are legacy-only in OrbitFS Cloud.</p>
</div>
<ContextLibraryPanel />
