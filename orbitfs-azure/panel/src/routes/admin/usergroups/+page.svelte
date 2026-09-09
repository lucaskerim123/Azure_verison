<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Button, Card, CardContent, Input } from '$lib/components/ui';
	import { UsersRound, Plus, Trash2, LoaderCircle, X } from '@lucide/svelte';
	type Group = { name: string; members: string[]; permissions: Record<string, boolean> };
	const labels: Record<string,string> = { create_workspaces:'Create workspaces', access_public_workspace:'Access public workspace', invite_workspace_members:'Invite workspace members', share_files:'Share files', mcp_use:'Use MCP', mcp_manage_startup:'Manage MCP startup', mcp_manage_preset_names:'Rename MCP presets', mcp_manage_projects:'Manage MCP projects', mcp_manage_settings:'Manage MCP settings', sorter_view:'View Sorter', sorter_scan:'Run Sorter scan', sorter_add_to_queue:'Add to Sorter queue', sorter_review_queue:'Review Sorter queue', sorter_apply:'Apply Sorter changes', sorter_undo:'Undo Sorter changes', sorter_manage_rules:'Manage Sorter rules', sorter_auto_apply:'Allow Sorter auto-apply', converter_view:'View Converter', converter_run:'Run Converter', converter_manage_settings:'Manage Converter settings' };
	let groups=$state<Group[]>([]), capabilities=$state<string[]>([]), defaults=$state<Record<string,boolean>>({});
	let loading=$state(true), saving=$state(false), error=$state(''), formOpen=$state(false), editingName=$state<string|null>(null);
	let name=$state(''), membersText=$state(''), permissions=$state<Record<string,boolean>>({}), deleteName=$state<string|null>(null);
	async function load(){ loading=true; error=''; try{ const r=await api.get<{groups:Group[];capabilities:string[];permissionDefaults:Record<string,boolean>}>('/usergroups'); groups=r.groups; capabilities=r.capabilities||[]; defaults=r.permissionDefaults||{}; }catch(e){error=e instanceof ApiError?e.message:'Failed to load groups'}finally{loading=false} }
	function open(group?:Group){ editingName=group?.name??null; name=group?.name??''; membersText=group?.members.join(', ')??''; permissions={...defaults,...(group?.permissions||{})}; formOpen=true; }
	async function save(e:Event){ e.preventDefault(); saving=true; error=''; try{ await api.post('/usergroups',{name,members:membersText.split(',').map(v=>v.trim()).filter(Boolean),permissions}); formOpen=false; await load(); }catch(e){error=e instanceof ApiError?e.message:'Save failed'}finally{saving=false} }
	async function remove(groupName:string){ try{await api.delete(`/usergroups/${encodeURIComponent(groupName)}`);deleteName=null;await load()}catch(e){error=e instanceof ApiError?e.message:'Delete failed'} }
	load();
</script>
<div class="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
	<div class="flex items-center justify-between gap-3"><div><h1 class="flex items-center gap-2 text-xl font-semibold"><UsersRound class="size-5" />Usergroup management</h1><p class="text-sm text-muted-foreground">Reusable groups whose permissions are applied to member user accounts.</p></div><Button size="sm" onclick={() => open()}><Plus />New group</Button></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	{#if formOpen}<Card><CardContent class="space-y-4 pt-4"><div class="flex justify-between"><strong>{editingName?'Edit group':'New group'}</strong><button onclick={() => formOpen=false}><X class="size-4" /></button></div><form class="space-y-4" onsubmit={save}><div class="grid gap-3 md:grid-cols-2"><Input bind:value={name} placeholder="Group name" disabled={!!editingName}/><Input bind:value={membersText} placeholder="Members separated by commas"/></div><fieldset class="rounded-md border p-3"><legend class="px-1 text-sm font-medium">Group permissions</legend><p class="mb-3 text-xs text-muted-foreground">These values override the member's normal per-user values while they belong to this group.</p><div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{#each capabilities as key}<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={permissions[key]}/>{labels[key]||key}</label>{/each}</div></fieldset><Button type="submit" disabled={saving}>{#if saving}<LoaderCircle class="size-4 animate-spin"/>{/if}Save group</Button></form></CardContent></Card>{/if}
	<div class="overflow-hidden rounded-lg border border-border bg-card">
		{#if loading}<div class="flex justify-center py-16"><LoaderCircle class="size-5 animate-spin"/></div>
		{:else if groups.length===0}<p class="p-6 text-sm text-muted-foreground">No groups created.</p>
		{:else}{#each groups as group (group.name)}
			<div class="flex items-center justify-between gap-3 border-b border-border p-3 last:border-0">
				<div><p class="font-medium">{group.name}</p><p class="text-xs text-muted-foreground">{group.members.length} member{group.members.length===1?'':'s'} · {Object.values(group.permissions||{}).filter(Boolean).length} permissions enabled</p><p class="text-xs text-muted-foreground">{group.members.join(', ')||'No members'}</p></div>
				<div class="flex gap-1"><Button size="sm" variant="outline" onclick={() => open(group)}>Edit</Button>{#if deleteName===group.name}<Button size="sm" variant="destructive" onclick={() => remove(group.name)}>Confirm</Button><Button size="sm" variant="ghost" onclick={() => deleteName=null}>Cancel</Button>{:else}<Button size="sm" variant="ghost" onclick={() => deleteName=group.name}><Trash2 class="size-4"/></Button>{/if}</div>
			</div>
		{/each}{/if}
	</div>
</div>
