import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';
import { USER_CAPABILITIES, REGISTERED_USER_PERMISSION_DEFAULTS, normalizeUserPermissions } from '$lib/server/registration';

async function groupList() {
	const supabase = getSupabaseAdmin();
	const [groups,members,users] = await Promise.all([
		supabase.from('orbitfs_groups').select('*').order('name'),
		supabase.from('orbitfs_group_members').select('*'),
		supabase.from('orbitfs_users').select('id,username')
	]);
	const failed = [groups,members,users].find((result) => result.error);
	if (failed?.error) throw failed.error;
	const names = new Map((users.data ?? []).map((row:any) => [row.id,row.username]));
	return (groups.data ?? []).map((group:any) => ({
		name:group.name,
		members:(members.data ?? []).filter((m:any) => m.group_id === group.id).map((m:any) => names.get(m.user_id)).filter(Boolean),
		permissions:normalizeUserPermissions(group.permissions,REGISTERED_USER_PERMISSION_DEFAULTS)
	}));
}

export async function GET({ cookies }) {
	try {
		await assertPanelLicensed();
		await requireAdmin(cookies);
		return json({ groups:await groupList(),capabilities:[...USER_CAPABILITIES],permissionDefaults:REGISTERED_USER_PERMISSION_DEFAULTS });
	} catch (error:any) { return json({ error:String(error?.message || 'Could not load groups') }, { status:Number(error?.status || 500) }); }
}
export async function POST({ request, cookies }) {
	try {
		await assertPanelLicensed();
		const actor = await requireAdmin(cookies);
		const body = await request.json().catch(() => ({}));
		const name = String(body.name ?? '').trim().slice(0,80);
		if (name.length < 2) return json({ error:'Group name must be at least 2 characters' }, { status:400 });
		const requestedMembers = Array.from(new Set<string>((Array.isArray(body.members) ? body.members : []).map((value: unknown) => String(value).trim()).filter(Boolean)));
		const supabase = getSupabaseAdmin();
		const users = requestedMembers.length ? await supabase.from('orbitfs_users').select('id,username') : { data:[],error:null } as any;
		if (users.error) throw users.error;
		const requested = new Set(requestedMembers.map((value:string) => value.toLowerCase()));
		users.data = (users.data ?? []).filter((row:any) => requested.has(row.username.toLowerCase()));
		const found = new Set((users.data ?? []).map((row:any) => row.username.toLowerCase()));
		const missing = requestedMembers.filter((username:string) => !found.has(username.toLowerCase()));
		if (missing.length) return json({ error:`Unknown user${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` }, { status:400 });
		const permissions = normalizeUserPermissions(body.permissions,REGISTERED_USER_PERMISSION_DEFAULTS);
		let group = await supabase.from('orbitfs_groups').select('*').ilike('name',name).maybeSingle();
		if (group.error) throw group.error;
		if (group.data) {
			const saved = await supabase.from('orbitfs_groups').update({ permissions,updated_at:new Date().toISOString() }).eq('id',group.data.id).select('*').single();
			if (saved.error) throw saved.error;
			group = { ...group,data:saved.data } as any;
		} else {
			const saved = await supabase.from('orbitfs_groups').insert({ name,permissions }).select('*').single();
			if (saved.error) throw saved.error;
			group = { ...group,data:saved.data } as any;
		}		const cleared = await supabase.from('orbitfs_group_members').delete().eq('group_id',group.data.id);
		if (cleared.error) throw cleared.error;
		if ((users.data ?? []).length) {
			const inserted = await supabase.from('orbitfs_group_members').insert((users.data ?? []).map((row:any) => ({ group_id:group.data.id,user_id:row.id })));
			if (inserted.error) throw inserted.error;
		}
		await writeAudit({ actorUserId:actor.id, action:'usergroup.save', targetType:'usergroup', targetId:group.data.id, detail:{ name,members:requestedMembers } });
		return json({ ok:true,groups:await groupList() });
	} catch (error:any) { return json({ error:String(error?.message || 'Could not save group') }, { status:Number(error?.status || 500) }); }
}