import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';
import { profileCatalog } from '$lib/server/workspace-profiles.js';
import { listEntries, purgeEntry } from '$lib/server/base-compat';
import {
	fileRoleOverrides, getWorkspace, isSystemAdmin, managementPermissionResponse,
	presentWorkspace, requireWorkspaceAccess, requireWorkspacePermission,
	resetManagementPermissions, saveManagementPermissions, cleanWorkspaceSlug,
	workspaceMembers, workspaceRole
} from '$lib/server/workspaces';

const clean = (value: unknown) => String(value ?? '').trim();
const now = () => new Date().toISOString();
function fail(error: any) {
	const status = Number(error?.status || 500);
	return json({ error:String(error?.message || 'Request failed'), code:String(error?.code || 'REQUEST_FAILED') }, { status });
}
async function ctx(cookies: any) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	return { user, supabase:getSupabaseAdmin() };
}
export async function GET({ params, cookies }: any) {
	try {
		const { user, supabase } = await ctx(cookies);
		const parts = clean(params.rest).split('/').filter(Boolean);
		const workspace = await getWorkspace(parts[0]);
		await requireWorkspaceAccess(user,workspace);
		if (parts.length === 1 || parts[1] === 'stats')
			return json({ workspace:await presentWorkspace(user,workspace) });
		if (parts[1] === 'details') {
			const role = await workspaceRole(user,workspace) ?? 'viewer';
			const [presented,members,overrides,management,messageResult,profile] = await Promise.all([
				presentWorkspace(user,workspace,role),
				workspaceMembers(workspace.id), fileRoleOverrides(workspace.id), managementPermissionResponse(workspace.id),
				supabase.from('orbitfs_workspace_messages').select('*').eq('workspace_id',workspace.id).order('created_at',{ascending:false}).limit(100),
				profileCatalog(workspace.id,role,user.id,user.role).catch(() => null)
			]);
			if (messageResult.error) throw messageResult.error;
			return json({ workspace:presented,members,overrides,management,messages:await messageRows(messageResult.data ?? []),profile });
		}
		if (parts[1] === 'members') return json({ members:await workspaceMembers(workspace.id) });
		if (parts[1] === 'permission-overrides') return json({ overrides:await fileRoleOverrides(workspace.id) });
		if (parts[1] === 'management-permissions') return json(await managementPermissionResponse(workspace.id));
		if (parts[1] === 'trash') {
			const entries = await listEntries(workspace.id,'_trash');
			const presented = await presentWorkspace(user,workspace);
			return json({ entries,usedBytes:presented.trash_used_bytes ?? 0 });
		}
		if (parts[1] === 'messages') {
			const result = await supabase.from('orbitfs_workspace_messages').select('*')
				.eq('workspace_id',workspace.id).order('created_at',{ascending:false}).limit(100);
			if (result.error) throw result.error;
			return json({ messages:await messageRows(result.data ?? []) });
		}
		throw Object.assign(new Error('Not found'), { status:404 });
	} catch (error) { return fail(error); }
}
async function messageRows(rows: any[]) {
	const supabase = getSupabaseAdmin();
	const ids = [...new Set(rows.map((row) => row.created_by).filter(Boolean))];
	let names = new Map<string,string>();
	if (ids.length) {
		const users = await supabase.from('orbitfs_users').select('id,username').in('id',ids);
		if (users.error) throw users.error;
		names = new Map((users.data ?? []).map((row:any) => [row.id,row.username]));
	}
	return rows.map((row) => ({
		id:row.id,title:row.title,message:row.message,severity:row.severity,
		created_by:names.get(row.created_by) || 'OrbitFS',created_at:row.created_at
	}));
}
export async function PATCH({ params, request, cookies }: any) {
	try {
		const { user, supabase } = await ctx(cookies);
		const parts = clean(params.rest).split('/').filter(Boolean);
		if (parts.length !== 1) throw Object.assign(new Error('Not found'), { status:404 });
		const workspace = await getWorkspace(parts[0]);
		await requireWorkspacePermission(user,workspace,'edit_settings');
		const body = await request.json().catch(() => ({}));
		if (body.ownerUsername !== undefined) {
			if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'), { status:403 });
			if (workspace.is_main) throw Object.assign(new Error('Main workspace ownership cannot be reassigned'), { status:409 });
			const target = await supabase.from('orbitfs_users').select('id,username,status').ilike('username',clean(body.ownerUsername)).maybeSingle();
			if (target.error) throw target.error;
			if (!target.data || target.data.status !== 'active') throw Object.assign(new Error('Target user is not available'), { status:404 });
			const previousOwnerId = workspace.owner_id || workspace.created_by;
			const changed = await supabase.from('orbitfs_workspaces').update({ owner_id:target.data.id,updated_at:now() }).eq('id',workspace.id).select('*').single();
			if (changed.error) throw changed.error;
			const existing = await supabase.from('orbitfs_workspace_members').select('mcp_enabled').eq('workspace_id',workspace.id).eq('user_id',target.data.id).maybeSingle();
			if (existing.error) throw existing.error;
			const ownerMember = await supabase.from('orbitfs_workspace_members').upsert({ workspace_id:workspace.id,user_id:target.data.id,role:'owner',mcp_enabled:existing.data?.mcp_enabled===true }, { onConflict:'workspace_id,user_id' });
			if (ownerMember.error) throw ownerMember.error;
			if (previousOwnerId && previousOwnerId !== target.data.id) { const previous = await supabase.from('orbitfs_workspace_members').upsert({ workspace_id:workspace.id,user_id:previousOwnerId,role:'editor',mcp_enabled:false }, { onConflict:'workspace_id,user_id' }); if (previous.error) throw previous.error; }
			const staleTransfers = await supabase.from('orbitfs_workspace_requests').update({ status:'cancelled',decided_by_id:user.id,decided_at:now() }).eq('workspace_id',workspace.id).eq('request_type','ownership').in('status',['pending','admin_pending','awaiting_target']);
			if (staleTransfers.error) throw staleTransfers.error;
			await writeAudit({ actorUserId:user.id,workspaceId:workspace.id,action:'workspace.owner.set',targetType:'user',targetId:target.data.id,detail:{previousOwnerId,ownerUsername:target.data.username} });
			return json({ workspace:await presentWorkspace(user,changed.data) });
		}
		const patch: Record<string,any> = {};
		if (body.name !== undefined) {
			const name = clean(body.name).slice(0,80);
			if (name.length < 2) throw Object.assign(new Error('Workspace name must be at least 2 characters'), { status:400 });
			patch.name = name; patch.slug = cleanWorkspaceSlug(name);
		}
		if (body.description !== undefined) patch.description = String(body.description ?? '').slice(0,500);
		if (body.offlineMessage !== undefined) patch.offline_message = String(body.offlineMessage ?? '').trim().slice(0,500);
		if (body.deleteProtected !== undefined || body.autoDeleteImmune !== undefined) {
			if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'), { status:403 });
			patch.delete_protected = Boolean(body.deleteProtected ?? body.autoDeleteImmune);
			patch.auto_delete_immune = patch.delete_protected;
		}
		if (body.storageQuotaBytes !== undefined || body.trashLimitBytes !== undefined || body.suspensionReason !== undefined) {
			if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required for workspace limits'), { status:403 });
			if (body.storageQuotaBytes !== undefined) patch.storage_quota_bytes = Math.max(1024**3,Number(body.storageQuotaBytes) || 1024**3);
			if (body.trashLimitBytes !== undefined) patch.trash_limit_bytes = Math.max(1024**2,Number(body.trashLimitBytes) || 200*1024**2);
			if (body.suspensionReason !== undefined) patch.suspension_reason = String(body.suspensionReason ?? '').trim().slice(0,500);
		}
		if (body.mcpSystemEnabled !== undefined || body.apexSystemEnabled !== undefined) {
			if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'), { status:403 });
			if (body.mcpSystemEnabled !== undefined) {
				patch.mcp_system_enabled = Boolean(body.mcpSystemEnabled);
				if (body.mcpSystemEnabled === false) patch.mcp_ui_enabled = false;
			}
			if (body.apexSystemEnabled !== undefined) patch.apex_system_enabled = Boolean(body.apexSystemEnabled);
		}
		if (body.mcpEnabled !== undefined) {
			const role = await workspaceRole(user,workspace);
			if (!isSystemAdmin(user) && role !== 'owner') throw Object.assign(new Error('Workspace owner or admin required'), { status:403 });
			if (workspace.mcp_system_enabled === false && body.mcpEnabled) throw Object.assign(new Error('MCP access is blocked for this workspace'), { status:403 });
			patch.mcp_ui_enabled = Boolean(body.mcpEnabled);
		}
		const previousStatus = String(workspace.status || 'active');
		if (body.status !== undefined) {
			const status = String(body.status);
			if (!['active','offline','suspended','archived'].includes(status)) throw Object.assign(new Error('Invalid workspace status'), { status:400 });
			if (!isSystemAdmin(user)) {
				const role = await workspaceRole(user,workspace);
				if (role !== 'owner' || workspace.is_main || !['active','offline'].includes(status)) throw Object.assign(new Error('Only the workspace owner may take this workspace online or offline'), { status:403 });
			}
			if (status === 'suspended' && !clean(body.suspensionReason ?? workspace.suspension_reason)) throw Object.assign(new Error('A suspension reason is required'), { status:400 });
			if ((workspace.is_main || workspace.delete_protected || workspace.auto_delete_immune) && status === 'archived') throw Object.assign(new Error('This workspace is protected from archive/delete'), { status:409 });
			if (status === 'active' && !isSystemAdmin(user) && !workspace.is_main) {
				const other = await supabase.from('orbitfs_workspaces').update({ status:'offline',drive_state:'offline',mcp_ui_enabled:false,updated_at:now() })
					.eq('owner_id',workspace.owner_id).neq('id',workspace.id).neq('is_main',true).eq('status','active');
				if (other.error) throw other.error;
			}
			patch.status = status;
			patch.drive_state = status === 'active' ? 'online' : 'offline';
			if (status !== 'active') patch.mcp_ui_enabled = false;
			if (status === 'suspended' && previousStatus !== 'suspended') {
				const members = await workspaceMembers(workspace.id);
				const recipients = [...new Set([workspace.owner_id,...members.map((member:any) => member.user_id)].filter(Boolean))];
				if (recipients.length) {
					const rows = recipients.map((userId:any) => ({ user_id:userId,title:`${workspace.name} suspended`,body:String(body.suspensionReason ?? workspace.suspension_reason ?? 'Workspace suspended'),level:'warning' }));
					const notices = await supabase.from('orbitfs_notifications').insert(rows);
					if (notices.error) throw notices.error;
				}
			}
		}
		patch.updated_at = now();
		const result = await supabase.from('orbitfs_workspaces').update(patch).eq('id',workspace.id).select('*').single();
		if (result.error) throw result.error;
		if (body.mcpEnabled === true) {
			const ownerId = result.data.owner_id || result.data.created_by || null;
			if (ownerId) {
				const existingOwner = await supabase.from('orbitfs_workspace_members').select('role').eq('workspace_id',workspace.id).eq('user_id',ownerId).maybeSingle();
				if (existingOwner.error) throw existingOwner.error;
				const ownerMember = await supabase.from('orbitfs_workspace_members').upsert({ workspace_id:workspace.id,user_id:ownerId,role:existingOwner.data?.role || 'owner',mcp_enabled:true }, { onConflict:'workspace_id,user_id' });
				if (ownerMember.error) throw ownerMember.error;
			}
		}
		await writeAudit({ actorUserId:user.id,workspaceId:workspace.id,action:'workspace.update',targetType:'workspace',targetId:workspace.id,detail:patch });
		return json({ workspace:await presentWorkspace(user,result.data) });
	} catch (error) { return fail(error); }
}
export async function POST({ params, request, cookies }: any) {
	try {
		const { user, supabase } = await ctx(cookies);
		const parts = clean(params.rest).split('/').filter(Boolean);
		const workspace = await getWorkspace(parts[0]);
		await requireWorkspaceAccess(user,workspace);
		const body = await request.json().catch(() => ({}));
		if (parts[1] === 'messages') {
			await requireWorkspacePermission(user,workspace,'send_messages');
			const title = clean(body.title).slice(0,120), message = clean(body.message).slice(0,2000);
			if (!title || !message) throw Object.assign(new Error('Message title and body are required'), { status:400 });
			const severity = ['info','warning','critical'].includes(String(body.severity)) ? String(body.severity) : 'info';
			const result = await supabase.from('orbitfs_workspace_messages').insert({ workspace_id:workspace.id,title,message,severity,created_by:user.id }).select('*').single();
			if (result.error) throw result.error;
			return json({ message:{ ...result.data,created_by:user.username } });
		}
		if (parts[1] === 'storage-request') {
			const role = await workspaceRole(user,workspace);
			if (!isSystemAdmin(user) && role !== 'owner') throw Object.assign(new Error('Only the workspace owner may request a quota change'), { status:403 });
			const pending = await supabase.from('orbitfs_workspace_requests').select('id').eq('workspace_id',workspace.id).eq('request_type','storage').eq('status','pending').maybeSingle();
			if (pending.error) throw pending.error;
			if (pending.data) throw Object.assign(new Error('A quota request is already pending for this workspace'), { status:409 });
			const currentQuota = Number(workspace.storage_quota_bytes || 1024**3);
			const requestedQuota = Math.max(1024**3,Number(body.requestedQuotaBytes || 1024**3));
			if (requestedQuota === currentQuota) throw Object.assign(new Error('Requested quota must be different from the current quota'), { status:400 });
			const payload = { workspace_name:workspace.name,requester_username:user.username,current_quota_bytes:currentQuota,
				requested_quota_bytes:requestedQuota,request_type:requestedQuota > currentQuota ? 'upgrade':'downgrade',message:clean(body.message).slice(0,500) };
			const result = await supabase.from('orbitfs_workspace_requests').insert({ workspace_id:workspace.id,request_type:'storage',requested_by_id:user.id,status:'pending',payload }).select('*').single();
			if (result.error) throw result.error;
			return json({ request:{ id:result.data.id,workspace_id:workspace.id,...payload,status:'pending',created_at:result.data.created_at } });
		}
		if (parts[1] === 'ownership-request') {
			const role = await workspaceRole(user,workspace);
			if (workspace.is_main) throw Object.assign(new Error('Main workspace ownership cannot be transferred'), { status:409 });
			if (!isSystemAdmin(user) && role !== 'owner') throw Object.assign(new Error('Only the workspace owner may request an ownership transfer'), { status:403 });
			const target = await supabase.from('orbitfs_users').select('id,username').ilike('username',clean(body.targetUsername)).maybeSingle();
			if (target.error) throw target.error;
			if (!target.data) throw Object.assign(new Error('Target user does not exist'), { status:404 });
			if (target.data.id === workspace.owner_id) throw Object.assign(new Error('Target user already owns this workspace'), { status:400 });
			const pending = await supabase.from('orbitfs_workspace_requests').select('id').eq('workspace_id',workspace.id).eq('request_type','ownership').in('status',['pending','admin_pending','awaiting_target']).maybeSingle();
			if (pending.error) throw pending.error;
			if (pending.data) throw Object.assign(new Error('An ownership transfer is already pending for this workspace'), { status:409 });
			const owner = await supabase.from('orbitfs_users').select('username').eq('id',workspace.owner_id || workspace.created_by).maybeSingle();
			if (owner.error) throw owner.error;
			const fromUserId=workspace.owner_id || workspace.created_by || user.id;
			const payload = { workspace_name:workspace.name,from_user_id:fromUserId,from_username:owner.data?.username || user.username,target_user_id:target.data.id,target_username:target.data.username,message:clean(body.message).slice(0,500) };
			const result = await supabase.from('orbitfs_workspace_requests').insert({ workspace_id:workspace.id,request_type:'ownership',requested_by_id:fromUserId,target_user_id:target.data.id,status:'admin_pending',payload }).select('*').single();
			if (result.error) throw result.error;
			return json({ request:{ id:result.data.id,workspace_id:workspace.id,...payload,status:'admin_pending',created_at:result.data.created_at } });
		}
		throw Object.assign(new Error('Not found'), { status:404 });
	} catch (error) { return fail(error); }
}
export async function PUT({ params, request, cookies }: any) {
	try {
		const { user, supabase } = await ctx(cookies);
		const parts = clean(params.rest).split('/').filter(Boolean);
		const workspace = await getWorkspace(parts[0]);
		const body = await request.json().catch(() => ({}));
		if (parts[1] === 'members' && parts[2]) {
			await requireWorkspacePermission(user,workspace,'manage_members');
			const username = decodeURIComponent(parts[2]).trim();
			if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) throw Object.assign(new Error('Username must be 2-40 letters, numbers, dots, dashes, or underscores'), { status:400 });
			const target = await supabase.from('orbitfs_users').select('id,username,role').ilike('username',username).maybeSingle();
			if (target.error) throw target.error;
			const permission = ['editor','contributor','viewer'].includes(String(body.permission)) ? String(body.permission) : 'viewer';
			if (!target.data) {
				const pending = await supabase.from('orbitfs_workspace_requests').select('id,payload').eq('workspace_id',workspace.id).eq('request_type','invitation').eq('status','pending');
				if (pending.error) throw pending.error;
				if ((pending.data ?? []).some((row:any) => String(row.payload?.username || '').toLowerCase() === username.toLowerCase())) throw Object.assign(new Error('An admin approval request is already pending for this username'), { status:409 });
				const payload = { workspace_name:workspace.name,username,permission,requested_by_username:user.username };
				const created = await supabase.from('orbitfs_workspace_requests').insert({ workspace_id:workspace.id,request_type:'invitation',requested_by_id:user.id,status:'pending',payload }).select('*').single();
				if (created.error) throw created.error;
				return json({ pendingApproval:true,invitation:{ id:created.data.id,workspace_id:workspace.id,...payload,status:'pending',created_at:created.data.created_at },members:await workspaceMembers(workspace.id) });
			}
			const role = target.data.id === workspace.owner_id ? 'owner' : permission;
			const saved = await supabase.from('orbitfs_workspace_members').upsert({ workspace_id:workspace.id,user_id:target.data.id,role,mcp_enabled:Boolean(body.mcpEnabled) }, { onConflict:'workspace_id,user_id' });
			if (saved.error) throw saved.error;
			if (target.data.id !== user.id) await supabase.from('orbitfs_notifications').insert({ user_id:target.data.id,title:'Workspace invitation',body:`You were added to ${workspace.name} as ${role}.`,level:'info' });
			await writeAudit({ actorUserId:user.id,workspaceId:workspace.id,action:'workspace.member.save',targetType:'user',targetId:target.data.id,detail:{username:target.data.username,role} });
			return json({ pendingApproval:false,members:await workspaceMembers(workspace.id) });
		}
		if (parts[1] === 'permission-overrides') {
			await requireWorkspacePermission(user,workspace,'manage_permissions');
			const role = ['editor','contributor','viewer'].includes(String(body.role)) ? String(body.role) : 'viewer';
			const path = String(body.path ?? '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
			const p = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
			await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id',workspace.id).eq('path_prefix',path).eq('principal_type','role').eq('principal_id',role);
			const created = await supabase.from('orbitfs_file_permissions').insert({ workspace_id:workspace.id,path_prefix:path,principal_type:'role',principal_id:role,can_view:p.read===true,can_edit:p.write===true,can_download:p.download===true,can_move:p.move===true,can_delete:p.delete===true,can_create:p.create===true,can_share:p.share===true,can_manage_permissions:false,inherit:true });
			if (created.error) throw created.error;
			return json({ ok:true,overrides:await fileRoleOverrides(workspace.id) });
		}
		if (parts[1] === 'management-permissions') {
			await requireWorkspacePermission(user,workspace,'manage_permissions');
			const role = ['editor','contributor','viewer'].includes(String(body.role)) ? String(body.role) : 'viewer';
			const permissions = await saveManagementPermissions(workspace.id,role,body.permissions || {});
			return json({ role,permissions });
		}
		throw Object.assign(new Error('Not found'), { status:404 });
	} catch (error) { return fail(error); }
}
export async function DELETE({ params, cookies, url }: any) {
	try {
		const { user, supabase } = await ctx(cookies);
		const parts = clean(params.rest).split('/').filter(Boolean);
		const workspace = await getWorkspace(parts[0]);
		if (parts[1] === 'members' && parts[2]) {
			await requireWorkspacePermission(user,workspace,'manage_members');
			const memberId = decodeURIComponent(parts[2]);
			if (memberId === workspace.owner_id) throw Object.assign(new Error('Workspace owner cannot be removed'), { status:409 });
			const deleted = await supabase.from('orbitfs_workspace_members').delete().eq('workspace_id',workspace.id).eq('user_id',memberId);
			if (deleted.error) throw deleted.error;
			return json({ members:await workspaceMembers(workspace.id) });
		}
		if (parts[1] === 'permission-overrides') {
			await requireWorkspacePermission(user,workspace,'manage_permissions');
			const path = String(url.searchParams.get('path') ?? '').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
			const role = String(url.searchParams.get('role') ?? '');
			const deleted = await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id',workspace.id).eq('path_prefix',path).eq('principal_type','role').eq('principal_id',role);
			if (deleted.error) throw deleted.error;
			return json({ ok:true,overrides:await fileRoleOverrides(workspace.id) });
		}
		if (parts[1] === 'management-permissions') {
			await requireWorkspacePermission(user,workspace,'manage_permissions');
			await resetManagementPermissions(workspace.id,String(url.searchParams.get('role') ?? ''));
			return json({ ok:true });
		}
		if (parts[1] === 'trash') {
			await requireWorkspacePermission(user,workspace,'edit_settings');
			const entries = await listEntries(workspace.id,'_trash');
			for (const entry of entries) await purgeEntry(workspace.id,`_trash/${entry.name}`);
			await writeAudit({ actorUserId:user.id,workspaceId:workspace.id,action:'trash.empty',targetType:'workspace',targetId:workspace.id,detail:{count:entries.length} });
			return json({ ok:true,emptied:entries.length,workspace:await presentWorkspace(user,workspace) });
		}
		if (parts.length === 1) {
			await requireWorkspacePermission(user,workspace,'delete_workspace');
			if (workspace.is_main || workspace.delete_protected || workspace.auto_delete_immune)
				throw Object.assign(new Error('This workspace is protected from delete'), { status:409 });
			const archived = await supabase.from('orbitfs_workspaces').update({ status:'archived',drive_state:'offline',mcp_ui_enabled:false,updated_at:now() }).eq('id',workspace.id);
			if (archived.error) throw archived.error;
			await writeAudit({ actorUserId:user.id,workspaceId:workspace.id,action:'workspace.archive',targetType:'workspace',targetId:workspace.id });
			return json({ ok:true,recoverable:true });
		}
		throw Object.assign(new Error('Not found'), { status:404 });
	} catch (error) { return fail(error); }
}
