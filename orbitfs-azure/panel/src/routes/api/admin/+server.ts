import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

const clean = (value: unknown) => String(value ?? '').trim();

export async function GET({ cookies }) {
	await requireAdmin(cookies);
	const supabase = getSupabaseAdmin();
	const [users, groups, groupMembers, workspaceMembers, workspaces, audit, settings] = await Promise.all([
		supabase.from('orbitfs_users').select('id,username,display_name,email,role,status,avatar_url,last_seen_at,created_at,updated_at').order('created_at'),
		supabase.from('orbitfs_groups').select('*').order('name'),
		supabase.from('orbitfs_group_members').select('*'),
		supabase.from('orbitfs_workspace_members').select('*'),
		supabase.from('orbitfs_workspaces').select('id,name,slug,visibility,status,is_main').order('is_main', { ascending: false }).order('name'),
		supabase.from('orbitfs_audit_log').select('*').order('created_at', { ascending: false }).limit(300),
		supabase.from('orbitfs_settings').select('*').order('scope_type').order('key')
	]);
	const failure = [users, groups, groupMembers, workspaceMembers, workspaces, audit, settings].find((result) => result.error);
	if (failure?.error) return json({ error: failure.error.message }, { status: 500 });
	return json({
		users: users.data ?? [], groups: groups.data ?? [], groupMembers: groupMembers.data ?? [],
		workspaceMembers: workspaceMembers.data ?? [], workspaces: workspaces.data ?? [],
		audit: audit.data ?? [], settings: settings.data ?? []
	});
}

export async function POST({ request, cookies }) {
	const actor = await requireAdmin(cookies);
	const body = await request.json().catch(() => ({}));
	const action = clean(body.action);
	const supabase = getSupabaseAdmin();

	if (action === 'user.update') {
		const id = clean(body.id);
		const patch: Record<string, unknown> = {};
		if (body.displayName !== undefined) patch.display_name = clean(body.displayName);
		if (body.email !== undefined) patch.email = clean(body.email).toLowerCase() || null;
		if (['owner','admin','user'].includes(body.role)) patch.role = body.role;
		if (['active','inactive','banned'].includes(body.status)) patch.status = body.status;
		if (id === actor.id && patch.status !== undefined && patch.status !== 'active') return json({ error: 'You cannot disable your own account' }, { status: 400 });
		const { data: existing } = await supabase.from('orbitfs_users').select('role,status').eq('id', id).maybeSingle();
		if (!existing) return json({ error: 'User not found' }, { status: 404 });
		if (existing.role === 'owner' && ((patch.role && patch.role !== 'owner') || patch.status !== undefined && patch.status !== 'active')) {
			const { count } = await supabase.from('orbitfs_users').select('*', { count: 'exact', head: true }).eq('role', 'owner').eq('status', 'active');
			if ((count ?? 0) <= 1) return json({ error: 'At least one active owner is required' }, { status: 400 });
		}
		const { data, error } = await supabase.from('orbitfs_users').update(patch).eq('id', id).select('id,username,display_name,email,role,status,last_seen_at,created_at').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'user', targetId: id, detail: patch });
		return json({ ok: true, item: data });
	}

	if (action === 'group.create') {
		const name = clean(body.name);
		if (name.length < 2) return json({ error: 'Group name is required' }, { status: 400 });
		const { data, error } = await supabase.from('orbitfs_groups').insert({ name, description: clean(body.description) }).select('*').single();
		if (error) return json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'group', targetId: data.id });
		return json({ ok: true, item: data });
	}

	if (action === 'group.delete') {
		const id = clean(body.id);
		const { error } = await supabase.from('orbitfs_groups').delete().eq('id', id);
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'group', targetId: id });
		return json({ ok: true });
	}

	if (action === 'group.member.add') {
		const groupId = clean(body.groupId), userId = clean(body.userId);
		const { error } = await supabase.from('orbitfs_group_members').upsert({ group_id: groupId, user_id: userId }, { onConflict: 'group_id,user_id' });
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'group_member', targetId: `${groupId}:${userId}` });
		return json({ ok: true });
	}

	if (action === 'group.member.remove') {
		const groupId = clean(body.groupId), userId = clean(body.userId);
		const { error } = await supabase.from('orbitfs_group_members').delete().eq('group_id', groupId).eq('user_id', userId);
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'group_member', targetId: `${groupId}:${userId}` });
		return json({ ok: true });
	}

	if (action === 'workspace.member.save') {
		const workspaceId = clean(body.workspaceId), userId = clean(body.userId);
		const role = ['owner','editor','contributor','viewer'].includes(body.role) ? body.role : 'viewer';
		const { error } = await supabase.from('orbitfs_workspace_members').upsert({ workspace_id: workspaceId, user_id: userId, role }, { onConflict: 'workspace_id,user_id' });
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, workspaceId, action, targetType: 'workspace_member', targetId: userId, detail: { role } });
		return json({ ok: true });
	}

	if (action === 'workspace.member.remove') {
		const workspaceId = clean(body.workspaceId), userId = clean(body.userId);
		const { error } = await supabase.from('orbitfs_workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, workspaceId, action, targetType: 'workspace_member', targetId: userId });
		return json({ ok: true });
	}

	if (action === 'notification.create') {
		const title = clean(body.title), targetUserId = clean(body.userId) || null;
		if (!title) return json({ error: 'Notification title is required' }, { status: 400 });
		const level = ['info','success','warning','error'].includes(body.level) ? body.level : 'info';
		const { data, error } = await supabase.from('orbitfs_notifications').insert({ user_id: targetUserId, title, body: String(body.body ?? ''), level }).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'notification', targetId: data.id, detail: { targetUserId, level } });
		return json({ ok: true, item: data });
	}

	if (action === 'setting.save') {
		const scopeType = ['global','workspace','user'].includes(body.scopeType) ? body.scopeType : 'global';
		const payload = { scope_type: scopeType, scope_id: clean(body.scopeId), key: clean(body.key), value: body.value ?? {} };
		if (!payload.key) return json({ error: 'Setting key is required' }, { status: 400 });
		const { data, error } = await supabase.from('orbitfs_settings').upsert(payload, { onConflict: 'scope_type,scope_id,key' }).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: actor.id, action, targetType: 'setting', targetId: `${scopeType}:${payload.scope_id}:${payload.key}` });
		return json({ ok: true, item: data });
	}

	return json({ error: 'Unknown administration action' }, { status: 400 });
}
