import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin, requireUser } from '$lib/server/auth';
import { assertMcpLicensed, auditMcp, getMcpAddonRow } from '$lib/server/mcp-cloud';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getEngineStatus, controlEngine, panelBaseUrl, resolvedEngineHostBaseUrl } from '$lib/server/engine-host';
import { syncMcpProjectKnowledge, removeMcpProjectKnowledge } from '$lib/server/mcp-knowledge-sync';
import {
	deleteContextBundle,
	deleteMcpProject,
	getContextBundle,
	getPresetBundles,
	getPresetMetadata,
	getPresets,
	getStartup,
	listContextBundles,
	listMcpProjects,
	projectBundleAssignments,
	requireMcpWorkspace,
	saveContextBundle,
	saveDefaultItems,
	saveDefaultProfiles,
	saveMcpProject,
	savePresetBundles,
	savePresetMetadata,
	savePresets,
	saveProjectBundleAssignments,
	saveStartup
} from '$lib/server/mcp-workspace-state';

const now = () => new Date().toISOString();
const ok = (body: unknown) => json(body);
const syncError = (errorValue:any) => ({ synced:false, error:String(errorValue?.message || errorValue || 'Knowledge project reconciliation failed') });

async function setting(scopeType: string, scopeId: string | null, key: string) {
	const db = getSupabaseAdmin();
	let query = db.from('orbitfs_settings').select('value').eq('scope_type', scopeType).eq('key', key);
	query = scopeId === null ? query.is('scope_id', null) : query.eq('scope_id', scopeId);
	const result = await query.maybeSingle();
	if (result.error) throw result.error;
	return result.data?.value ?? null;
}

async function saveSetting(scopeType: string, scopeId: string | null, key: string, value: unknown) {
	const db = getSupabaseAdmin();
	let query = db.from('orbitfs_settings').select('id').eq('scope_type', scopeType).eq('key', key);
	query = scopeId === null ? query.is('scope_id', null) : query.eq('scope_id', scopeId);
	const current = await query.maybeSingle();
	if (current.error) throw current.error;
	if (current.data?.id) {
		const result = await db.from('orbitfs_settings').update({ value, updated_at: now() }).eq('id', current.data.id);
		if (result.error) throw result.error;
	} else {
		const result = await db.from('orbitfs_settings').insert({ scope_type: scopeType, scope_id: scopeId, key, value });
		if (result.error) throw result.error;
	}
}

async function currentEngineUrl(addon:any) {
	if (addon?.deployment_url) return String(addon.deployment_url).replace(/\/$/, '');
	try { return String(await resolvedEngineHostBaseUrl()).replace(/\/$/, ''); } catch { return null; }
}

async function runtimePayload() {
	const addon = await getMcpAddonRow();
	let licensed = false;
	try { await assertMcpLicensed(); licensed = true; } catch {}

	let engine: any = null;
	try { engine = await getEngineStatus('mcp'); }
	catch (runtimeError: any) { engine = { mode: 'unreachable', error: String(runtimeError?.message || 'Engine host unavailable') }; }

	const ready = addon?.installed === true && addon?.attached === true && licensed;
	const rawState = String(engine?.mode || 'unreachable');
	const state = !ready ? 'stopped' : rawState === 'stopped' ? 'stopped' : rawState === 'unreachable' ? 'unreachable' : 'running';
	return {
		online: state === 'running',
		state,
		serviceStatus: state,
		running: state === 'running',
		stopped: state === 'stopped',
		operational: state === 'running',
		residentProcess: false,
		mode: 'serverless-engine-host',
		workspaceIntegration: true,
		connectorPath: '/mcp',
		licensed,
		attached: addon?.attached === true,
		installed: addon?.installed === true,
		publicBaseUrl: await currentEngineUrl(addon),
		compute: 'vercel',
		database: 'supabase',
		filesystem: false,
		generation: engine?.generation ?? null,
		lastRequestAt: engine?.lastRequestAt ?? null,
		lastControlAt: engine?.lastControlAt ?? null,
		engineError: engine?.error ?? engine?.lastError ?? null,
		detail: 'MCP is serverless and uses Running/Stopped only. Vercel handles idle compute automatically.'
	};
}

async function dcrPayload() {
	const db = getSupabaseAdmin();
	const [clients, activeTokens] = await Promise.all([
		db.from('mcp_oauth_clients').select('client_id,created_at,application_type,client_name,redirect_uris,scope').order('created_at', { ascending: false }),
		db.from('mcp_oauth_tokens').select('client_id').is('revoked_at', null).gt('expires_at', now())
	]);
	if (clients.error) throw clients.error;
	if (activeTokens.error) throw activeTokens.error;
	const tokenCounts = new Map<string, number>();
	for (const row of activeTokens.data || []) tokenCounts.set(row.client_id, (tokenCounts.get(row.client_id) || 0) + 1);
	const panel = String(panelBaseUrl()).replace(/\/$/, '');
	let host = '';
	try { host = String(await resolvedEngineHostBaseUrl()).replace(/\/$/, ''); } catch {}
	return {
		enabled: true,
		standard: 'RFC 7591',
		registrationEndpoint: `${panel}/oauth/register`,
		authorizationServerMetadata: `${panel}/.well-known/oauth-authorization-server`,
		protectedResourceMetadata: host ? `${host}/.well-known/oauth-protected-resource` : null,
		pkce: 'S256',
		tokenEndpointAuthMethod: 'none',
		supportedApplicationTypes: ['web', 'native'],
		registeredClients: (clients.data || []).length,
		clients: (clients.data || []).map((row: any) => ({ ...row, activeTokens: tokenCounts.get(row.client_id) || 0 }))
	};
}

async function registryPayload() {
	const db = getSupabaseAdmin();
	const [clientResult, sessionResult] = await Promise.all([
		db.from('mcp_clients').select('*').order('last_seen_at', { ascending: false }),
		db.from('mcp_sessions').select('*').order('last_seen_at', { ascending: false }).limit(250)
	]);
	if (clientResult.error) throw clientResult.error;
	if (sessionResult.error) throw sessionResult.error;
	const clients = clientResult.data ?? [];
	const sessions = sessionResult.data ?? [];
	const mappedClients = clients.map((client: any) => ({
		clientId: client.id,
		clientName: client.client_name,
		status: client.status,
		createdAt: client.first_seen_at,
		lastSeenAt: client.last_seen_at,
		activeTokens: sessions.filter((session: any) => session.client_id === client.id && session.status === 'active').length,
		users: [...new Set(sessions.filter((session: any) => session.client_id === client.id).map((session: any) => session.username).filter(Boolean))],
		workspaceIds: client.workspace_ids || [],
		permissions: client.permissions || { read: true, write: true },
		redirectUris: client.redirect_uris || []
	}));
	const mappedSessions = sessions.map((session: any) => ({
		id: session.id,
		username: session.username || 'Unknown user',
		workspaceId: session.workspace_id,
		provider: session.provider || 'mcp',
		status: session.status,
		connectedAt: session.connected_at,
		lastSeenAt: session.last_seen_at,
		idle: session.status !== 'active',
		requestCount: session.request_count || 0
	}));
	return {
		clients: mappedClients,
		connected: mappedSessions.filter((session: any) => session.status === 'active'),
		recent: mappedSessions.slice(0, 50),
		sessions: mappedSessions
	};
}

async function localRuntimeControl(action: string, actorUserId: string) {
	const map: Record<string, 'running' | 'stopped' | 'restart'> = {
		start: 'running', run: 'running', running: 'running', stop: 'stopped', stopped: 'stopped', restart: 'restart'
	};
	if (action === 'standby') throw error(400, 'MCP does not use Standby. Use Running or Stopped.');
	const engineAction = map[action];
	if (!engineAction) throw error(400, 'Invalid MCP control action');
	const result = await controlEngine('mcp', engineAction, actorUserId);
	await auditMcp('runtime.control', { action, engineAction, state: result?.mode }, actorUserId);
	return json({ ok: true, action, status: await runtimePayload() });
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const user = await requireUser(cookies);
	await assertMcpLicensed();
	const parts = String(params.rest || '').split('/').filter(Boolean);
	const db = getSupabaseAdmin();

	if (parts[0] === 'runtime' || parts[0] === 'master-control') return ok(await runtimePayload());
	if (parts[0] === 'dcr-status') { await requireAdmin(cookies); return ok(await dcrPayload()); }
	if (parts[0] === 'logs') {
		if (!['owner', 'admin'].includes(user.role)) throw error(403, 'Administrator access required');
		const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 250)));
		const result = await db.from('mcp_audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
		if (result.error) throw result.error;
		return ok({ logs: result.data || [] });
	}
	if (parts[0] === 'registry') { await requireAdmin(cookies); return ok(await registryPayload()); }
	if (parts[0] === 'admin-policy') {
		await requireAdmin(cookies);
		const policy = await setting('global', null, 'mcp.admin_policy');
		return ok({ policy: policy || {
			oss: { enabled: true, allowedStrengths: ['low', 'medium', 'high', 'custom1', 'custom2'], maxBundlesPerPreset: 20 },
			ccs: { enabled: true, maxBundlesPerWorkspace: 100, maxEntriesPerBundle: 500, maxDependenciesPerBundle: 50, maxDependencyDepth: 8, allowProfiles: true }
		} });
	}
	if (parts[0] === 'workspaces' && parts[1]) {
		const workspaceId = parts[1];
		await requireMcpWorkspace(user, workspaceId);
		const projectId = url.searchParams.get('projectId');
		if (parts[2] === 'projects' && !parts[3]) return ok({ projects: await listMcpProjects(workspaceId) });
		if (parts[2] === 'projects' && parts[3] && parts[4] === 'context-bundles') return ok({ assignments: await projectBundleAssignments(parts[3]) });
		if (parts[2] === 'context-bundles' && !parts[3]) return ok({ bundles: await listContextBundles(workspaceId) });
		if (parts[2] === 'context-bundles' && parts[3]) return ok({ bundle: await getContextBundle(workspaceId, parts[3]) });
		if (parts[2] === 'startup') return ok({ startup: await getStartup(workspaceId) });
		if (parts[2] === 'presets') return ok({ presets: await getPresets(workspaceId, projectId) });
		if (parts[2] === 'preset-metadata') return ok({ metadata: await getPresetMetadata(workspaceId, projectId) });
		if (parts[2] === 'preset-bundles') return ok({ assignments: await getPresetBundles(workspaceId, projectId) });
		if (parts[2] === 'setup') return ok({ config: (await setting('workspace', workspaceId, 'mcp.workspace_config')) || {
			master: { autoLoadPanelWorkspaceAi: true, includeProfiles: true, allowSearch: true, allowContextLoad: true, loadOrder: [] },
			settings: { searchMode: 'hybrid', autoLoad: true, defaultPaths: [], folderTemplate: [] },
			startupInstructions: '', chatgptInstructions: '', loadOrderText: ''
		} });
	}
	throw error(404, 'MCP route not found');
};

export const PUT: RequestHandler = async ({ cookies, params, request, url }) => {
	const user = await requireUser(cookies);
	await assertMcpLicensed();
	const parts = String(params.rest || '').split('/').filter(Boolean);
	const body = await request.json().catch(() => ({}));

	if (parts[0] === 'admin-policy') {
		await requireAdmin(cookies);
		const policy = body.policy || body;
		await saveSetting('global', null, 'mcp.admin_policy', policy);
		await auditMcp('admin_policy.updated', { policy }, user.id);
		return ok({ policy, applied: true });
	}
	if (parts[0] === 'workspaces' && parts[1]) {
		const workspaceId = parts[1];
		const projectId = body.projectId || url.searchParams.get('projectId') || null;
		if (parts[2] === 'setup') {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_settings');
			await saveSetting('workspace', workspaceId, 'mcp.workspace_config', body || {});
			await auditMcp('workspace_config.updated', { workspaceId }, user.id, workspaceId);
			return ok({ config: body || {} });
		}
		if (parts[2] === 'projects' && parts[3] && !parts[4]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_projects');
			const project = await saveMcpProject(workspaceId, user, body, parts[3]);
			const knowledgeSync = project ? await syncMcpProjectKnowledge(user, workspaceId, project).catch(syncError) : { synced:false, reason:'project_not_found' };
			await auditMcp('project.updated', { projectId: parts[3], knowledgeSync }, user.id, workspaceId);
			return ok({ project, knowledgeSync });
		}
		if (parts[2] === 'projects' && parts[3] && parts[4] === 'context-bundles') {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_projects');
			await saveProjectBundleAssignments(parts[3], body.assignments || []);
			return ok({ assignments: await projectBundleAssignments(parts[3]) });
		}
		if (parts[2] === 'context-bundles' && parts[3]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup');
			const bundle = await saveContextBundle(workspaceId, user, body, parts[3]);
			await auditMcp('context_bundle.updated', { bundleId: parts[3] }, user.id, workspaceId);
			return ok({ bundle });
		}
		if (parts[2] === 'startup') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup'); return ok({ startup: await saveStartup(workspaceId, user, body) }); }
		if (parts[2] === 'default-items') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup'); await saveDefaultItems(workspaceId, body.items || []); return ok({ items: body.items || [] }); }
		if (parts[2] === 'default-profiles') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup'); await saveDefaultProfiles(workspaceId, body.profileIds || [], body.profileBundleIds || []); return ok({ profileIds: body.profileIds || [], profileBundleIds: body.profileBundleIds || [] }); }
		if (parts[2] === 'presets') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup'); return ok({ presets: await savePresets(workspaceId, user, body, projectId) }); }
		if (parts[2] === 'preset-bundles') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup'); return ok({ assignments: await savePresetBundles(workspaceId, body.assignments || {}, projectId) }); }
		if (parts[2] === 'preset-metadata') { await requireMcpWorkspace(user, workspaceId, 'manage_mcp_preset_names'); return ok({ metadata: await savePresetMetadata(workspaceId, user, body.metadata || {}, projectId) }); }
	}
	throw error(404, 'MCP route not found');
};

export const PATCH: RequestHandler = async ({ cookies, params, request }) => {
	const user = await requireAdmin(cookies);
	await assertMcpLicensed();
	const parts = String(params.rest || '').split('/').filter(Boolean);
	if (parts[0] !== 'registry' || parts[1] !== 'clients' || !parts[2]) throw error(404, 'MCP route not found');
	const body = await request.json().catch(() => ({}));
	const patch: Record<string, unknown> = {};
	if (body.status) patch.status = body.status;
	if (body.permissions) patch.permissions = body.permissions;
	if (body.workspaceIds) patch.workspace_ids = body.workspaceIds;
	const db = getSupabaseAdmin();
	const result = await db.from('mcp_clients').update({ ...patch, last_seen_at: now() }).eq('id', decodeURIComponent(parts[2]));
	if (result.error) throw result.error;
	await auditMcp('client.updated', { clientId: parts[2], ...patch }, user.id);
	return ok({ updated: true });
};

export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const user = await requireUser(cookies);
	await assertMcpLicensed();
	const parts = String(params.rest || '').split('/').filter(Boolean);

	if (parts[0] === 'master-control') {
		const admin = await requireAdmin(cookies);
		const body = await request.json().catch(() => ({}));
		return localRuntimeControl(String(body.action || '').toLowerCase(), admin.id);
	}
	if (parts[0] === 'workspaces' && parts[1]) {
		const workspaceId = parts[1];
		const body = await request.json().catch(() => ({}));
		if (parts[2] === 'projects' && !parts[3]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_projects');
			const project = await saveMcpProject(workspaceId, user, body);
			const knowledgeSync = project ? await syncMcpProjectKnowledge(user, workspaceId, project).catch(syncError) : { synced:false, reason:'project_not_created' };
			await auditMcp('project.created', { projectId: project?.id, knowledgeSync }, user.id, workspaceId);
			return ok({ project, knowledgeSync });
		}
		if (parts[2] === 'context-bundles' && !parts[3]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup');
			const bundle = await saveContextBundle(workspaceId, user, body);
			await auditMcp('context_bundle.created', { bundleId: bundle?.id }, user.id, workspaceId);
			return ok({ bundle });
		}
	}
	await requireAdmin(cookies);
	const db = getSupabaseAdmin();
	if (parts[0] === 'registry' && parts[1] === 'clients' && parts[2] && parts[3] === 'disconnect') {
		const clientId = decodeURIComponent(parts[2]);
		const result = await db.from('mcp_sessions').update({ status: 'revoked', last_seen_at: now() }).eq('client_id', clientId).eq('status', 'active');
		if (result.error) throw result.error;
		await auditMcp('client.disconnected', { clientId }, user.id);
		return ok({ disconnected: true });
	}
	if (parts[0] === 'registry' && parts[1] === 'sessions' && parts[2] && parts[3] === 'disconnect') {
		const sessionId = decodeURIComponent(parts[2]);
		const result = await db.from('mcp_sessions').update({ status: 'revoked', last_seen_at: now() }).eq('id', sessionId);
		if (result.error) throw result.error;
		await auditMcp('session.disconnected', { sessionId }, user.id);
		return ok({ disconnected: true });
	}
	throw error(404, 'MCP route not found');
};

export const DELETE: RequestHandler = async ({ cookies, params }) => {
	const user = await requireUser(cookies);
	await assertMcpLicensed();
	const parts = String(params.rest || '').split('/').filter(Boolean);
	if (parts[0] === 'workspaces' && parts[1]) {
		const workspaceId = parts[1];
		if (parts[2] === 'projects' && parts[3]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_projects');
			const existing = (await listMcpProjects(workspaceId)).find((project:any) => String(project.id) === String(parts[3]));
			await deleteMcpProject(workspaceId, parts[3]);
			const knowledgeSync = await removeMcpProjectKnowledge(user, workspaceId, { projectId: parts[3], name: existing?.name || '' }).catch(syncError);
			await auditMcp('project.deleted', { projectId: parts[3], knowledgeSync }, user.id, workspaceId);
			return ok({ deleted: true, knowledgeSync });
		}
		if (parts[2] === 'context-bundles' && parts[3]) {
			await requireMcpWorkspace(user, workspaceId, 'manage_mcp_startup');
			await deleteContextBundle(workspaceId, parts[3]);
			await auditMcp('context_bundle.deleted', { bundleId: parts[3] }, user.id, workspaceId);
			return ok({ deleted: true });
		}
	}
	throw error(404, 'MCP route not found');
};
