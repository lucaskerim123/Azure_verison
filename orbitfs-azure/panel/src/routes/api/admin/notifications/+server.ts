import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';

export async function GET({ cookies }) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();
		const result = await supabase.from('orbitfs_notifications').select('*').order('created_at',{ascending:false}).limit(250);
		if (result.error) throw result.error;
		const userIds = [...new Set((result.data ?? []).map((row:any) => row.user_id).filter(Boolean))];
		let names = new Map<string,string>();
		if (userIds.length) {
			const users = await supabase.from('orbitfs_users').select('id,username').in('id',userIds);
			if (users.error) throw users.error;
			names = new Map((users.data ?? []).map((row:any) => [row.id,row.username]));
		}
		return json({ notifications:(result.data ?? []).map((row:any) => ({
			id:row.id,title:row.title,message:row.body,severity:row.level,
			targetUser:row.user_id ? names.get(row.user_id) ?? null : null,
			createdAt:row.created_at,createdBy:'OrbitFS'
		})) });
	} catch (error:any) { return json({ error:String(error?.message || 'Failed to load messages') }, { status:Number(error?.status || 500) }); }
}
export async function POST({ request, cookies }) {
	try {
		const admin = await requireAdmin(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const title = String(body.title ?? '').trim().slice(0,160);
		const message = String(body.message ?? '').trim().slice(0,4000);
		if (!title || !message) return json({ error:'Title and message are required' }, { status:400 });
		const severity = ['info','warning','critical','system'].includes(String(body.severity)) ? String(body.severity) : 'info';
		const supabase = getSupabaseAdmin();
		let userId:string|null = null;
		if (body.targetUser) {
			const target = await supabase.from('orbitfs_users').select('id').ilike('username',String(body.targetUser).trim()).maybeSingle();
			if (target.error) throw target.error;
			if (!target.data) return json({ error:'Target user not found' }, { status:404 });
			userId = target.data.id;
		}
		const created = await supabase.from('orbitfs_notifications').insert({ user_id:userId,title,body:message,level:severity }).select('*').single();
		if (created.error) throw created.error;
		await writeAudit({ actorUserId:admin.id,action:'admin.notification.send',targetType:'notification',targetId:created.data.id,detail:{ targetUser:body.targetUser || null,severity } });
		return json({ notification:created.data });
	} catch (error:any) { return json({ error:String(error?.message || 'Message failed') }, { status:Number(error?.status || 500) }); }
}
