import { json } from '@sveltejs/kit';
import { hashPassword, requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';
import { USER_CAPABILITIES, USER_CAPABILITY_LABELS, REGISTERED_USER_PERMISSION_DEFAULTS, normalizeUserPermissions } from '$lib/server/registration';

function failure(error: any) {
	return json({ error:error?.message ?? 'User request failed' }, { status:Number(error?.status || 500) });
}

function permissionsFor(row: any) {
	if (row.role === 'owner' || row.role === 'admin') return Object.fromEntries(USER_CAPABILITIES.map((key) => [key, true]));
	return normalizeUserPermissions(row.permissions, REGISTERED_USER_PERMISSION_DEFAULTS);
}

export async function GET({ params, cookies }) {
	try {
		await assertPanelLicensed();
		const actor = await requireAdmin(cookies);
		if (String(params.rest || '')) return json({ error:'Not found' }, { status:404 });
		const supabase = getSupabaseAdmin();
		const [users, memberships, workspaces, files, sessions] = await Promise.all([
			supabase.from('orbitfs_users').select('id,username,email,role,status,permissions,ban_reason,last_ip,last_user_agent,last_login_at,login_count,created_at').order('created_at'),
			supabase.from('orbitfs_workspace_members').select('workspace_id,user_id,role'),
			supabase.from('orbitfs_workspaces').select('id,name,created_by'),
			supabase.from('orbitfs_files').select('workspace_id,created_by').is('deleted_at', null),
			supabase.from('orbitfs_sessions').select('user_id,expires_at')
		]);
		const failed = [users,memberships,workspaces,files,sessions].find((result) => result.error);
		if (failed?.error) throw failed.error;
		const now = Date.now();
		const wsById = new Map((workspaces.data ?? []).map((item) => [item.id, item]));
		const result = (users.data ?? []).map((row) => {
			const memberRoles = (memberships.data ?? []).filter((m) => m.user_id === row.id).map((m) => ({
				workspaceId:m.workspace_id,
				workspaceName:wsById.get(m.workspace_id)?.name ?? 'Workspace',
				role:m.role,
				files:(files.data ?? []).filter((f) => f.workspace_id === m.workspace_id).length
			}));
			const ownedRoles = (workspaces.data ?? []).filter((ws) => ws.created_by === row.id && !memberRoles.some((item) => item.workspaceId === ws.id)).map((ws) => ({
				workspaceId:ws.id, workspaceName:ws.name, role:'owner',
				files:(files.data ?? []).filter((f) => f.workspace_id === ws.id).length
			}));
			const roles = [...ownedRoles, ...memberRoles];
			return {
				username:row.username,
				role:row.role,
				status:row.status,
				email:row.email ?? null,
				protected:row.id === actor.id,
				banReason:row.ban_reason ?? '',
				permissions:permissionsFor(row),
				workspaceRoles:roles,
				workspaceCount:roles.length,
				ownedWorkspaces:roles.filter((item) => item.role === 'owner').length,
				fileCount:roles.reduce((total, item) => total + item.files, 0),
				activeSessions:(sessions.data ?? []).filter((s) => s.user_id === row.id && Date.parse(s.expires_at) > now).length,
				lastIp:row.last_ip ?? '',
				lastUserAgent:row.last_user_agent ?? '',
				lastLoginAt:row.last_login_at ?? null,
				loginCount:Number(row.login_count || 0)
			};
		});
		return json({ users:result, capabilities:[...USER_CAPABILITIES], capabilityLabels:USER_CAPABILITY_LABELS, capabilityGroups:[], permissionDefaults:REGISTERED_USER_PERMISSION_DEFAULTS });
	} catch (error) { return failure(error); }
}
export async function POST({ params, request, cookies }) {
	try {
		await assertPanelLicensed();
		const actor = await requireAdmin(cookies);
		const rest = String(params.rest || '');
		const parts = rest.split('/').filter(Boolean);
		const supabase = getSupabaseAdmin();
		if (parts.length === 2 && ['ban','unban'].includes(parts[1])) {
			const username = decodeURIComponent(parts[0]);
			const { data:user, error } = await supabase.from('orbitfs_users').select('id,username,role,status').ilike('username', username).maybeSingle();
			if (error) throw error;
			if (!user) return json({ error:'User not found' }, { status:404 });
			if (user.id === actor.id && parts[1] === 'ban') return json({ error:'You cannot ban your own account' }, { status:400 });
			if (['owner','admin'].includes(user.role) && parts[1] === 'ban') {
				const { count } = await supabase.from('orbitfs_users').select('*', { count:'exact', head:true }).in('role',['owner','admin']).eq('status','active');
				if ((count ?? 0) <= 1) return json({ error:'At least one active system administrator is required' }, { status:400 });
			}
			const body = await request.json().catch(() => ({}));
			const patch = parts[1] === 'ban'
				? { status:'banned', ban_reason:String(body.reason ?? '').trim() || 'Banned by administrator' }
				: { status:'active', ban_reason:null };
			const saved = await supabase.from('orbitfs_users').update(patch).eq('id', user.id);
			if (saved.error) throw saved.error;
			if (parts[1] === 'ban') await supabase.from('orbitfs_sessions').delete().eq('user_id', user.id);
			await writeAudit({ actorUserId:actor.id, action:`user.${parts[1]}`, targetType:'user', targetId:user.id, detail:{ reason:(patch as any).ban_reason ?? null } });
			return json({ ok:true });
		}
		if (rest) return json({ error:'Not found' }, { status:404 });
		const body = await request.json().catch(() => ({}));
		const username = String(body.username ?? '').trim();
		const pin = String(body.pin ?? '');
		const email = String(body.email ?? '').trim().toLowerCase() || null;
		const role = ['owner','admin','user'].includes(body.role) ? body.role : 'user';
		const status = ['active','inactive','banned'].includes(body.status) ? body.status : 'active';
		if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) return json({ error:'Username must be 2-40 letters, numbers, dots, underscores or dashes' }, { status:400 });
		if (pin && !/^\d{4,10}$/.test(pin)) return json({ error:'PIN must be 4-10 digits' }, { status:400 });
		const { data:existing, error:lookupError } = await supabase.from('orbitfs_users').select('id,role,status').ilike('username', username).maybeSingle();
		if (lookupError) throw lookupError;
		if (!existing && !pin) return json({ error:'PIN must be 4-10 digits' }, { status:400 });
		if (existing && ['owner','admin'].includes(existing.role) && (role === 'user' || status !== 'active')) {
			const { count } = await supabase.from('orbitfs_users').select('*', { count:'exact', head:true }).in('role',['owner','admin']).eq('status','active');
			if ((count ?? 0) <= 1) return json({ error:'At least one active system administrator is required' }, { status:400 });
		}
		const patch: any = {
			email,
			role,
			status,
			ban_reason:status === 'banned' ? String(body.banReason ?? '').trim() || 'Banned by administrator' : null,
			permissions:normalizeUserPermissions(body.permissions)
		};
		if (pin) { patch.password_hash = hashPassword(pin); patch.must_change_pin = pin === '0000'; }
		if (existing) {
			const saved = await supabase.from('orbitfs_users').update(patch).eq('id', existing.id);
			if (saved.error) throw saved.error;
			if (status !== 'active') await supabase.from('orbitfs_sessions').delete().eq('user_id', existing.id);
			await writeAudit({ actorUserId:actor.id, action:'user.update', targetType:'user', targetId:existing.id, detail:{ role,status } });
			return json({ ok:true });
		}
		const created = await supabase.from('orbitfs_users').insert({
			username,
			display_name:username,
			password_hash:hashPassword(pin),
			must_change_pin:pin === '0000',
			...patch
		}).select('id').single();
		if (created.error || !created.data) throw created.error ?? new Error('Could not create user');
		await writeAudit({ actorUserId:actor.id, action:'user.create', targetType:'user', targetId:created.data.id, detail:{ role,status } });
		return json({ ok:true });
	} catch (error) { return failure(error); }
}
export async function DELETE({ params, cookies }) {
	try {
		await assertPanelLicensed();
		const actor = await requireAdmin(cookies);
		const username = decodeURIComponent(String(params.rest || '')).trim();
		if (!username) return json({ error:'User not found' }, { status:404 });
		const supabase = getSupabaseAdmin();
		const target = await supabase.from('orbitfs_users').select('id,username,role').ilike('username', username).maybeSingle();
		if (target.error) throw target.error;
		if (!target.data) return json({ error:'User not found' }, { status:404 });
		if (target.data.id === actor.id) return json({ error:'You cannot delete your own account' }, { status:403 });
		if (['owner','admin'].includes(target.data.role)) {
			const { count } = await supabase.from('orbitfs_users').select('*',{count:'exact',head:true}).in('role',['owner','admin']).eq('status','active');
			if ((count ?? 0) <= 1) return json({ error:'At least one active system administrator is required' }, { status:400 });
		}
		await supabase.from('orbitfs_workspace_members').delete().eq('user_id',target.data.id);
		await supabase.from('orbitfs_group_members').delete().eq('user_id',target.data.id);
		await supabase.from('orbitfs_sessions').delete().eq('user_id',target.data.id);
		await supabase.from('orbitfs_notifications').delete().eq('user_id',target.data.id);
		const deleted = await supabase.from('orbitfs_users').delete().eq('id',target.data.id);
		if (deleted.error) throw deleted.error;
		await writeAudit({ actorUserId:actor.id, action:'user.delete', targetType:'user', targetId:target.data.id, detail:{ username:target.data.username } });
		return json({ ok:true });
	} catch (error) { return failure(error); }
}
