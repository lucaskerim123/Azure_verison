<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import { fileContext } from '$lib/context.svelte';
  import { onMount } from 'svelte';

  type Workspace = { id:string; name:string; permission:string; management_permissions?:Record<string,boolean> };
  type Setup = {
    master: { includeProfiles:boolean; allowSearch:boolean; allowContextLoad:boolean; loadOrder:string[]; [key:string]:unknown };
    settings: { searchMode:string; autoLoad:boolean; defaultPaths:string[]; folderTemplate:string[] };
    startupInstructions:string; chatgptInstructions:string; loadOrderText:string;
  };

  let workspaces = $state<Workspace[]>([]);
  let workspaceId = $state('');
  let setup = $state<Setup | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let status = $state('');
  let defaultPathsText = $state('');
  let folderTemplateText = $state('');
  const lines = (value:string) => value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  async function loadWorkspace() {
    if (!workspaceId) return;
    loading = true; error = ''; status = '';
    try {
      const data = await api.get<{config:Setup}>(`/mcp/workspaces/${workspaceId}/setup`);
      setup = data.config;
      if (!['hybrid','keyword'].includes(setup.settings.searchMode)) setup.settings.searchMode = 'hybrid';
      defaultPathsText = (setup.settings.defaultPaths || []).join('\n');
      folderTemplateText = (setup.settings.folderTemplate || []).join('\n');
      const ws = workspaces.find((item) => item.id === workspaceId);
      if (ws) fileContext.set(ws.id, ws.name);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load MCP workspace setup';
    } finally { loading = false; }
  }

  async function save() {
    if (!setup || !workspaceId) return;
    saving = true; error = ''; status = '';
    try {
      setup.settings.defaultPaths = lines(defaultPathsText);
      setup.settings.folderTemplate = lines(folderTemplateText);
      delete (setup.master as any).autoLoadPanelWorkspaceAi;
      const data = await api.put<{config:Setup}>(`/mcp/workspaces/${workspaceId}/setup`, setup);
      setup = data.config;
      if (!['hybrid','keyword'].includes(setup.settings.searchMode)) setup.settings.searchMode = 'hybrid';
      defaultPathsText = (setup.settings.defaultPaths || []).join('\n');
      folderTemplateText = (setup.settings.folderTemplate || []).join('\n');
      status = 'MCP workspace setup saved. Engine runtime will use these settings on the next MCP request/startup.';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to save MCP workspace setup';
    } finally { saving = false; }
  }

  onMount(async () => {
    try {
      const data = await api.get<{workspaces:Workspace[]}>('/workspaces');
      workspaces = data.workspaces.filter((ws) => ws.permission === 'owner' || !!ws.management_permissions?.manage_mcp_settings);
      workspaceId = fileContext.currentId && workspaces.some((ws) => ws.id === fileContext.currentId)
        ? fileContext.currentId : (workspaces[0]?.id || '');
      if (workspaceId) await loadWorkspace(); else loading = false;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load workspaces';
      loading = false;
    }
  });
</script>

<svelte:head><title>MCP Workspace Setup · OrbitFS</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
  <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
    <div>
      <h1 class="text-xl font-semibold">MCP Workspace Setup</h1>
      <p class="text-sm text-muted-foreground">Configure the customer-facing MCP behaviour used by ChatGPT for this workspace. Engine hard configuration and monitoring stay in Engine Console.</p>
    </div>
    <button class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onclick={save} disabled={saving || loading || !setup}>{saving ? 'Saving…' : 'Save setup'}</button>
  </div>

  {#if error}<div class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
  {#if status}<div class="rounded-md border p-3 text-sm">{status}</div>{/if}

  <div class="rounded-lg border bg-card p-4">
    <label class="space-y-1 text-sm"><span class="font-medium">Workspace</span><select class="w-full rounded-md border bg-background p-2" bind:value={workspaceId} onchange={loadWorkspace}>{#each workspaces as ws}<option value={ws.id}>{ws.name}</option>{/each}</select></label>
  </div>

  <div class="grid gap-3 md:grid-cols-3">
    <a href="/mcp/oss" class="rounded-lg border bg-card p-4 hover:bg-accent"><div class="font-medium">OSS · Startup System</div><p class="mt-1 text-sm text-muted-foreground">Presets, startup strength, Projects, Profiles and startup selections.</p></a>
    <a href="/mcp/ccs" class="rounded-lg border bg-card p-4 hover:bg-accent"><div class="font-medium">CCS · Context System</div><p class="mt-1 text-sm text-muted-foreground">Library/Knowledge bundles, Profiles and reusable context loading.</p></a>
    <a href="/mcp/projects" class="rounded-lg border bg-card p-4 hover:bg-accent"><div class="font-medium">Projects</div><p class="mt-1 text-sm text-muted-foreground">Project instructions, AI behaviour and project-specific context.</p></a>
  </div>
  {#if loading}
    <div class="rounded-lg border p-6 text-sm text-muted-foreground">Loading MCP workspace setup…</div>
  {:else if setup}
    <div class="grid gap-4 lg:grid-cols-2">
      <section class="space-y-4 rounded-lg border bg-card p-4">
        <div><h2 class="font-semibold">MCP behaviour</h2><p class="text-sm text-muted-foreground">These switches are enforced by the MCP runtime; OSS, CCS and Projects remain separate systems.</p></div>
        <label class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span>Allow linked Profiles in context</span><input type="checkbox" bind:checked={setup.master.includeProfiles} /></label>
        <label class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span>Allow MCP search</span><input type="checkbox" bind:checked={setup.master.allowSearch} /></label>
        <label class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span>Allow context loading</span><input type="checkbox" bind:checked={setup.master.allowContextLoad} /></label>
        <label class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span>Include MCP guidance during OSS startup</span><input type="checkbox" bind:checked={setup.settings.autoLoad} /></label>
        <label class="space-y-1 text-sm"><span class="font-medium">File search mode</span><select class="w-full rounded-md border bg-background p-2" bind:value={setup.settings.searchMode}><option value="hybrid">Hybrid · names, paths + stored text</option><option value="keyword">Keyword · names + paths only</option></select></label>
      </section>

      <section class="space-y-4 rounded-lg border bg-card p-4">
        <div><h2 class="font-semibold">Workspace map guidance</h2><p class="text-sm text-muted-foreground">These paths are guidance for MCP during startup. They do not auto-load files; OSS/CCS still decide what enters active context.</p></div>
        <label class="space-y-1 text-sm"><span class="font-medium">Important folders / paths</span><textarea class="min-h-32 w-full rounded-md border bg-background p-2 font-mono text-sm" bind:value={defaultPathsText} placeholder="One workspace path per line"></textarea></label>
        <label class="space-y-1 text-sm"><span class="font-medium">Preferred folder structure</span><textarea class="min-h-32 w-full rounded-md border bg-background p-2 font-mono text-sm" bind:value={folderTemplateText} placeholder="Projects/&#10;Documents/&#10;Reference/"></textarea></label>
      </section>
    </div>
    <section class="space-y-4 rounded-lg border bg-card p-4">
      <div><h2 class="font-semibold">MCP instructions</h2><p class="text-sm text-muted-foreground">These instructions are passed into MCP startup. Project instructions still live in Projects and startup selections remain in OSS.</p></div>
      <label class="space-y-1 text-sm"><span class="font-medium">MCP startup instructions</span><textarea class="min-h-40 w-full rounded-md border bg-background p-3 text-sm" bind:value={setup.startupInstructions}></textarea></label>
      <label class="space-y-1 text-sm"><span class="font-medium">ChatGPT MCP behaviour</span><textarea class="min-h-40 w-full rounded-md border bg-background p-3 text-sm" bind:value={setup.chatgptInstructions}></textarea></label>
    </section>

    <section class="space-y-3 rounded-lg border bg-card p-4">
      <div><h2 class="font-semibold">MCP instruction order</h2><p class="text-sm text-muted-foreground">Controls the order MCP combines its guidance layers. It does not change which OSS/CCS/Project records exist.</p></div>
      <textarea class="min-h-32 w-full rounded-md border bg-background p-3 font-mono text-sm" bind:value={setup.loadOrderText} placeholder="MCP&#10;Project&#10;OSS"></textarea>
      <div class="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Default instruction flow: MCP guidance + workspace map → Project behaviour/instructions → OSS startup instructions. OSS then loads the selected Profiles and CCS context.</div>
    </section>
  {/if}
</div>
