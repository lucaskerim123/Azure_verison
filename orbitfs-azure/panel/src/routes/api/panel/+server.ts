import { json } from '@sveltejs/kit';
import { requireUser, type OrbitUser } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const cleanName = (value: unknown) => String(value ?? '').trim();
const rank: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, owner: 3 };

async function workspaceAccess(user: OrbitUser, workspaceId: string) {
	if (user.role === 'owner' || user.role === 'admin') return 'owner';
	const supabase = getSupabaseAdmin();
	const { data: member } = await supabase.from('orbitfs_workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
	if (member?.role) return member.role as string;
	const { data: workspace } = await supabase.from('orbitfs_workspaces').select('visibility').eq('id', workspaceId).maybeSingle();
	return workspace?.visibility === 'public' ? 'viewer' : null;
}

async function requireWorkspaceAccess(user: OrbitUser, workspaceId: string, minimum: 'viewer' | 'contributor' | 'editor' | 'owner') {
	const access = await workspaceAccess(user, workspaceId);
	if (!access || (rank[access] ?? -1) < rank[minimum]) return null;
	return access;
}

async function accessibleWorkspaceRows(user: OrbitUser) {
	const supabase = getSupabaseAdmin();
	if (user.role === 'owner' || user.role === 'admin') {
		const { data, error } = await supabase.from('orbitfs_workspaces').select('*').order('is_main', { ascending: false }).order('name');
		if (error) throw error;
		return (data ?? []).map((workspace) => ({ ...workspace, permission: 'owner' }));
	}
	const [{ data: memberships, error: memberError }, { data: publicRows, error: publicError }] = await Promise.all([
		supabase.from('orbitfs_workspace_members').select('workspace_id,role').eq('user_id', user.id),
		supabase.from('orbitfs_workspaces').select('*').eq('visibility', 'public')
	]);
	if (memberError) throw memberError;
	if (publicError) throw publicError;
	const memberMap = new Map((memberships ?? []).map((item) => [item.workspace_id, item.role]));
	const memberIds = [...memberMap.keys()];
	let memberRows: any[] = [];
	if (memberIds.length) {
		const { data, error } = await supabase.from('orbitfs_workspaces').select('*').in('id', memberIds);
		if (error) throw error;
		memberRows = data ?? [];
	}
	const combined = new Map<string, any>();
	for (const row of publicRows ?? []) combined.set(row.id, { ...row, permission: memberMap.get(row.id) ?? 'viewer' });
	for (const row of memberRows) combined.set(row.id, { ...row, permission: memberMap.get(row.id) ?? 'viewer' });
	return [...combined.values()].sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.name.localeCompare(b.name));
}

export async function GET({ cookies }) {
	const user = await requireUser(cookies);
	const supabase = getSupabaseAdmin();
	try {
		const workspaces = await accessibleWorkspaceRows(user);
		const ids = workspaces.map((item) => item.id);
		if (!ids.length) return json({ workspaces: [], profiles: [], files: [], permissions: [], settings: [] });
		const [profilesResult, filesResult, permissionsResult] = await Promise.all([
			supabase.from('orbitfs_profiles').select('*').in('workspace_id', ids).order('updated_at', { ascending: false }),
			supabase.from('orbitfs_files').select('*').in('workspace_id', ids).is('deleted_at', null).order('kind').order('name'),
			supabase.from('orbitfs_file_permissions').select('*').in('workspace_id', ids).order('path_prefix')
		]);
		const failure = [profilesResult, filesResult, permissionsResult].find((result) => result.error);
		if (failure?.error) throw failure.error;
		let settings: any[] = [];
		if (user.role === 'owner' || user.role === 'admin') {
			const result = await supabase.from('orbitfs_settings').select('*');
			if (result.error) throw result.error;
			settings = result.data ?? [];
		}
		return json({ workspaces, profiles: profilesResult.data ?? [], files: filesResult.data ?? [], permissions: permissionsResult.data ?? [], settings });
	} catch (error) {
		console.error('OrbitFS panel load failed', error);
		return json({ error: 'Base System database load failed' }, { status: 500 });
	}
}

export async function POST({ request, cookies }) {
	const user = await requireUser(cookies);
	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '');
	const supabase = getSupabaseAdmin();

	if (action === 'workspace.create') {
		const name = cleanName(body.name);
		if (name.length < 2) return json({ error: 'Workspace name is required' }, { status: 400 });
		let slug = slugify(name) || 'workspace';
		const { count } = await supabase.from('orbitfs_workspaces').select('*', { count: 'exact', head: true }).like('slug', `${slug}%`);
		if ((count ?? 0) > 0) slug = `${slug}-${Date.now().toString(36)}`;
		const { data, error } = await supabase.from('orbitfs_workspaces').insert({
			name, slug, description: cleanName(body.description),
			visibility: ['private','shared','public'].includes(body.visibility) ? body.visibility : 'private',
			created_by: user.id
		}).select('*').single();
		if (error || !data) return json({ error: error?.message ?? 'Create failed' }, { status: 500 });
		await Promise.all([
			supabase.from('orbitfs_workspace_members').insert({ workspace_id: data.id, user_id: user.id, role: 'owner' }),
			supabase.from('orbitfs_files').insert([
				{ workspace_id: data.id, name: '_trash', path: '_trash', kind: 'folder', created_by: user.id },
				{ workspace_id: data.id, name: '_media', path: '_media', kind: 'folder', created_by: user.id }
			])
		]);
		await writeAudit({ actorUserId: user.id, workspaceId: data.id, action, targetType: 'workspace', targetId: data.id });
		return json({ ok: true, item: { ...data, permission: 'owner' } });
	}

	if (action === 'workspace.update') {
		const id = cleanName(body.id);
		if (!await requireWorkspaceAccess(user, id, 'editor')) return json({ error: 'Workspace edit permission required' }, { status: 403 });
		const patch: Record<string, unknown> = {};
		if (body.name !== undefined) { patch.name = cleanName(body.name); patch.slug = slugify(cleanName(body.name)); }
		if (body.description !== undefined) patch.description = cleanName(body.description);
		if (['active','offline','archived'].includes(body.status)) patch.status = body.status;
		if (['private','shared','public'].includes(body.visibility)) patch.visibility = body.visibility;
		const { data, error } = await supabase.from('orbitfs_workspaces').update(patch).eq('id', id).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: id, action, targetType: 'workspace', targetId: id });
		return json({ ok: true, item: data });
	}

	if (action === 'workspace.delete') {
		const id = cleanName(body.id);
		if (!await requireWorkspaceAccess(user, id, 'owner')) return json({ error: 'Workspace owner permission required' }, { status: 403 });
		const { data: workspace } = await supabase.from('orbitfs_workspaces').select('is_main').eq('id', id).maybeSingle();
		if (workspace?.is_main) return json({ error: 'Main workspace cannot be deleted' }, { status: 400 });
		const { error } = await supabase.from('orbitfs_workspaces').delete().eq('id', id);
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: id, action, targetType: 'workspace', targetId: id });
		return json({ ok: true });
	}

	if (action === 'profile.create') {
		const workspaceId = cleanName(body.workspaceId);
		const name = cleanName(body.name);
		if (!workspaceId || !name) return json({ error: 'Workspace and profile name are required' }, { status: 400 });
		if (!await requireWorkspaceAccess(user, workspaceId, 'contributor')) return json({ error: 'Profile create permission required' }, { status: 403 });
		const { data, error } = await supabase.from('orbitfs_profiles').insert({
			workspace_id: workspaceId, name,
			type: cleanName(body.type) || 'Person', classification: cleanName(body.classification) || 'General',
			labels: Array.isArray(body.labels) ? body.labels.map(cleanName).filter(Boolean) : [],
			background: String(body.background ?? ''), relationship: String(body.relationship ?? ''), notes: String(body.notes ?? ''),
			data: typeof body.data === 'object' && body.data ? body.data : {}, created_by: user.id
		}).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId, action, targetType: 'profile', targetId: data.id });
		return json({ ok: true, item: data });
	}

	if (action === 'profile.update' || action === 'profile.delete') {
		const id = cleanName(body.id);
		const { data: existing } = await supabase.from('orbitfs_profiles').select('workspace_id').eq('id', id).maybeSingle();
		if (!existing) return json({ error: 'Profile not found' }, { status: 404 });
		if (!await requireWorkspaceAccess(user, existing.workspace_id, action === 'profile.delete' ? 'editor' : 'contributor')) return json({ error: 'Profile permission required' }, { status: 403 });
		if (action === 'profile.delete') {
			const { error } = await supabase.from('orbitfs_profiles').delete().eq('id', id);
			if (error) return json({ error: error.message }, { status: 500 });
			await writeAudit({ actorUserId: user.id, workspaceId: existing.workspace_id, action, targetType: 'profile', targetId: id });
			return json({ ok: true });
		}
		const allowed = ['name','type','classification','labels','background','relationship','notes','data'];
		const patch = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
		const { data, error } = await supabase.from('orbitfs_profiles').update(patch).eq('id', id).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: existing.workspace_id, action, targetType: 'profile', targetId: id });
		return json({ ok: true, item: data });
	}

	if (action === 'file.create') {
		const workspaceId = cleanName(body.workspaceId);
		if (!await requireWorkspaceAccess(user, workspaceId, 'contributor')) return json({ error: 'File create permission required' }, { status: 403 });
		const parentPath = cleanName(body.parentPath).replace(/^\/+|\/+$/g, '');
		const name = cleanName(body.name).replace(/[\\/]+/g, '-');
		const kind = body.kind === 'folder' ? 'folder' : 'file';
		if (!workspaceId || !name) return json({ error: 'Workspace and name are required' }, { status: 400 });
		const path = [parentPath, name].filter(Boolean).join('/');
		const content = kind === 'file' ? String(body.content ?? '') : '';
		const { data, error } = await supabase.from('orbitfs_files').insert({
			workspace_id: workspaceId, name, path, kind,
			mime_type: kind === 'file' ? cleanName(body.mimeType) || 'text/plain' : null,
			content_text: content, size_bytes: Buffer.byteLength(content, 'utf8'), created_by: user.id
		}).select('*').single();
		if (error) return json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 });
		await writeAudit({ actorUserId: user.id, workspaceId, action, targetType: kind, targetId: data.id, detail: { path } });
		return json({ ok: true, item: data });
	}

	if (action === 'file.update' || action === 'file.delete') {
		const id = cleanName(body.id);
		const { data: entry } = await supabase.from('orbitfs_files').select('workspace_id,path,kind').eq('id', id).maybeSingle();
		if (!entry) return json({ error: 'File or folder not found' }, { status: 404 });
		if (!await requireWorkspaceAccess(user, entry.workspace_id, action === 'file.delete' ? 'editor' : 'contributor')) return json({ error: 'File permission required' }, { status: 403 });
		if (action === 'file.delete') {
			if (['_trash','_media'].includes(entry.path)) return json({ error: 'Core folder cannot be deleted' }, { status: 400 });
			const { error } = await supabase.from('orbitfs_files').delete().eq('id', id);
			if (error) return json({ error: error.message }, { status: 500 });
			await writeAudit({ actorUserId: user.id, workspaceId: entry.workspace_id, action, targetType: entry.kind, targetId: id, detail: { path: entry.path } });
			return json({ ok: true });
		}
		const content = String(body.content ?? '');
		const { data, error } = await supabase.from('orbitfs_files').update({ content_text: content, size_bytes: Buffer.byteLength(content, 'utf8') }).eq('id', id).eq('kind', 'file').select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		await writeAudit({ actorUserId: user.id, workspaceId: entry.workspace_id, action, targetType: 'file', targetId: id, detail: { path: entry.path } });
		return json({ ok: true, item: data });
	}

	if (action === 'permission.save' || action === 'permission.delete') {
		let workspaceId = cleanName(body.workspaceId);
		if (action === 'permission.delete') {
			const { data } = await supabase.from('orbitfs_file_permissions').select('workspace_id').eq('id', cleanName(body.id)).maybeSingle();
			workspaceId = data?.workspace_id ?? '';
		}
		if (!workspaceId || !await requireWorkspaceAccess(user, workspaceId, 'owner')) return json({ error: 'Permission management requires workspace owner access' }, { status: 403 });
		if (action === 'permission.delete') {
			const { error } = await supabase.from('orbitfs_file_permissions').delete().eq('id', cleanName(body.id));
			if (error) return json({ error: error.message }, { status: 500 });
			return json({ ok: true });
		}
		const payload = {
			workspace_id: workspaceId, path_prefix: cleanName(body.pathPrefix),
			principal_type: ['user','group','role'].includes(body.principalType) ? body.principalType : 'role',
			principal_id: cleanName(body.principalId) || 'owner',
			can_view: Boolean(body.canView), can_create: Boolean(body.canCreate), can_edit: Boolean(body.canEdit), can_delete: Boolean(body.canDelete),
			can_manage_permissions: Boolean(body.canManagePermissions), inherit: body.inherit !== false
		};
		const { data, error } = body.id
			? await supabase.from('orbitfs_file_permissions').update(payload).eq('id', cleanName(body.id)).select('*').single()
			: await supabase.from('orbitfs_file_permissions').insert(payload).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		return json({ ok: true, item: data });
	}

	if (action === 'setting.save') {
		const scopeType = ['global','workspace','user'].includes(body.scopeType) ? body.scopeType : 'global';
		const scopeId = cleanName(body.scopeId);
		if (scopeType === 'global' && !['owner','admin'].includes(user.role)) return json({ error: 'Administrator access required' }, { status: 403 });
		if (scopeType === 'workspace' && !await requireWorkspaceAccess(user, scopeId, 'owner')) return json({ error: 'Workspace owner access required' }, { status: 403 });
		if (scopeType === 'user' && scopeId && scopeId !== user.id && !['owner','admin'].includes(user.role)) return json({ error: 'Cannot edit another user settings' }, { status: 403 });
		const payload = { scope_type: scopeType, scope_id: scopeId || (scopeType === 'user' ? user.id : ''), key: cleanName(body.key), value: body.value };
		const { data, error } = await supabase.from('orbitfs_settings').upsert(payload, { onConflict: 'scope_type,scope_id,key' }).select('*').single();
		if (error) return json({ error: error.message }, { status: 500 });
		return json({ ok: true, item: data });
	}

	return json({ error: 'Unknown panel action' }, { status: 400 });
}
