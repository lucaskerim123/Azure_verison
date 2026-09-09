import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertMcpLicensed } from '$lib/server/mcp-cloud';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { knowledgeArchitectureHealth } from '$lib/server/knowledge-architecture';
import { getWorkspace, isSystemAdmin, managementPermissions, requireWorkspaceAccess } from '$lib/server/workspaces';

export async function GET({ cookies, params }: any) {
	try {
		const user = await requireUser(cookies);
		await assertMcpLicensed();
		const workspaceId = String(params.workspaceId || '').trim();
		const workspace = await getWorkspace(workspaceId);
		const role = await requireWorkspaceAccess(user, workspace);
		const permissions = await managementPermissions(user, workspace, role);
		const db = getSupabaseAdmin();

		const [membership, knowledge, bundles, projects, startup, startupProjects, defaultProfiles, defaultProfileBundles, legacyDefaults, legacyPresetPaths] = await Promise.all([
			db.from('orbitfs_workspace_members').select('mcp_enabled').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
			knowledgeArchitectureHealth(user, workspaceId),
			db.from('mcp_context_bundles').select('id,enabled').eq('workspace_id', workspaceId),
			db.from('mcp_projects').select('id').eq('workspace_id', workspaceId),
			db.from('mcp_workspace_startup').select('strength,updated_at').eq('workspace_id', workspaceId).maybeSingle(),
			db.from('mcp_workspace_startup_projects').select('project_id').eq('workspace_id', workspaceId),
			db.from('mcp_workspace_default_profiles').select('profile_id').eq('workspace_id', workspaceId),
			db.from('mcp_workspace_default_profile_bundles').select('profile_bundle_id').eq('workspace_id', workspaceId),
			db.from('mcp_workspace_default_items').select('item_path').eq('workspace_id', workspaceId),
			db.from('mcp_workspace_preset_items').select('item_path').eq('workspace_id', workspaceId)
		]);
		for (const result of [membership, bundles, projects, startup, startupProjects, defaultProfiles, defaultProfileBundles, legacyDefaults, legacyPresetPaths]) {
			if (result.error) throw result.error;
		}

		const admin = isSystemAdmin(user);
		const hasMembership = Boolean(membership.data);
		const memberEnabled = hasMembership
			? membership.data?.mcp_enabled === true
			: (admin || role === 'owner');
		const access = {
			active: workspace.status === 'active',
			systemEnabled: workspace.mcp_system_enabled !== false,
			workspaceEnabled: workspace.mcp_ui_enabled === true,
			permissionAllowed: permissions.mcp_use === true,
			memberEnabled
		};
		const accessReady = Object.values(access).every(Boolean);
		const knowledgeReady = knowledge.setup?.ok === true && knowledge.library?.ok === true;
		const enabledBundles = (bundles.data ?? []).filter((row: any) => row.enabled !== false).length;
		const startupConfigured = Boolean(startup.data);
		const contextConfigured = enabledBundles > 0 || (startupProjects.data ?? []).length > 0 || (defaultProfiles.data ?? []).length > 0 || (defaultProfileBundles.data ?? []).length > 0;
		const legacyPaths = (legacyDefaults.data ?? []).length + (legacyPresetPaths.data ?? []).length;

		const blockers: string[] = [];
		if (!access.active) blockers.push('Workspace is not active.');
		if (!access.systemEnabled) blockers.push('System MCP is blocked for this workspace.');
		if (!access.workspaceEnabled) blockers.push('Workspace MCP is disabled.');
		if (!access.permissionAllowed) blockers.push('Your workspace role does not allow mcp_use.');
		if (!access.memberEnabled) blockers.push('Your member MCP access is disabled.');
		if (!knowledge.setup?.ok) blockers.push('Knowledge Setup has not been completed.');
		if (knowledge.setup?.ok && !knowledge.library?.ok) blockers.push('Knowledge Setup references missing or unavailable Library items.');

		const recommendations: string[] = [];
		if (!startupConfigured) recommendations.push('Configure OSS startup behaviour for this workspace.');
		if (!contextConfigured) recommendations.push('Add a CCS bundle, startup project or startup profile so MCP has explicit context to load.');
		if (enabledBundles === 0) recommendations.push('Create at least one enabled CCS bundle for reusable Library/Profile context.');
		if (legacyPaths > 0) recommendations.push(`${legacyPaths} legacy filesystem path reference(s) remain and should be migrated to Library/Profile context.`);

		return json({
			workspace: { id: workspace.id, name: workspace.name, role, status: workspace.status },
			status: blockers.length ? 'blocked' : recommendations.length ? 'ready_with_recommendations' : 'ready',
			ready: blockers.length === 0,
			access: { ...access, hasMembership, ready: accessReady },
			knowledge: { ...knowledge, ready: knowledgeReady },
			context: {
				configured: contextConfigured,
				bundles: { total: (bundles.data ?? []).length, enabled: enabledBundles },
				projects: { total: (projects.data ?? []).length, startupSelected: (startupProjects.data ?? []).length },
				profiles: { defaults: (defaultProfiles.data ?? []).length, defaultBundles: (defaultProfileBundles.data ?? []).length }
			},
			startup: { configured: startupConfigured, strength: startup.data?.strength || 'medium', updatedAt: startup.data?.updated_at || null },
			legacy: { filesystem: false, pathReferences: legacyPaths },
			blockers,
			recommendations,
			engineHost: 'https://orbitfsengine.vercel.app',
			resource: 'https://orbitfsengine.vercel.app/mcp'
		});
	} catch (error: any) {
		return json({ error: String(error?.message || 'Could not calculate MCP workspace readiness') }, { status: Number(error?.status || 500) });
	}
}
