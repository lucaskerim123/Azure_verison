import { getSupabaseAdmin } from '$lib/server/supabase';
import { getPanelLicenseSummary } from '$lib/server/license';

export const MCP_COMPONENT = 'orbitfs_mcp';

export async function assertMcpLicensed() {
	const summary = await getPanelLicenseSummary();
	const component = summary.components?.[MCP_COMPONENT] ?? null;
	const allowed = Boolean(component?.allowed && component?.lockedToThisInstallation && ['enabled', 'locked'].includes(String(component?.state || '')));
	if (!allowed) throw Object.assign(new Error('OrbitFS MCP licence is required'), { status: 403, code: 'MCP_LICENSE_REQUIRED' });
	return { summary, component };
}

export async function getMcpAddonRow() {
	const db = getSupabaseAdmin();
	const { data, error } = await db.from('orbitfs_addons').select('*').eq('id', 'mcp').maybeSingle();
	if (error) throw error;
	return data;
}

export async function auditMcp(eventType: string, details: Record<string, unknown> = {}, actorUserId: string | null = null, scopeId = 'public') {
	const db = getSupabaseAdmin();
	await db.from('mcp_audit_log').insert({ scope_id: scopeId, actor_user_id: actorUserId, event_type: eventType, details });
}
