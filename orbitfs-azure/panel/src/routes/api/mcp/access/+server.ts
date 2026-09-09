import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { isSystemAdmin, visibleWorkspaces } from '$lib/server/workspaces';

export async function GET({ cookies }: any) {
  try {
    const user = await requireUser(cookies);
    await assertPanelLicensed();
    const workspaces = await visibleWorkspaces(user);
    const db = getSupabaseAdmin();
    const memberships = await db.from('orbitfs_workspace_members')
      .select('workspace_id,mcp_enabled')
      .eq('user_id', user.id);
    if (memberships.error) throw memberships.error;
    const memberMcp = new Map((memberships.data ?? []).map((row: any) => [String(row.workspace_id), row]));
    const admin = isSystemAdmin(user);

    const access = workspaces.map((workspace: any) => {
      const active = workspace.status === 'active';
      const systemEnabled = workspace.mcp_system_enabled !== false;
      const workspaceEnabled = workspace.mcp_ui_enabled === true;
      const permissionAllowed = workspace.management_permissions?.mcp_use === true;
      const membership: any = memberMcp.get(String(workspace.id));
      const hasMembership = Boolean(membership);
      const memberEnabled = hasMembership
        ? membership.mcp_enabled === true
        : (admin || workspace.permission === 'owner');
      const mcpAllowed = active && systemEnabled && workspaceEnabled && permissionAllowed && memberEnabled;
      const reason = !active ? 'workspace_not_active'
        : !systemEnabled ? 'mcp_system_blocked'
        : !workspaceEnabled ? 'workspace_mcp_disabled'
        : !permissionAllowed ? 'mcp_use_permission_denied'
        : !memberEnabled ? 'member_mcp_disabled'
        : 'allowed';
      return {
        id: workspace.id,
        name: workspace.name,
        permission: workspace.permission,
        status: workspace.status,
        systemEnabled,
        workspaceEnabled,
        permissionAllowed,
        memberEnabled,
        hasMembership,
        mcpAllowed,
        reason,
        management_permissions: workspace.management_permissions || {}
      };
    });

    const allowedWorkspaces = access.filter((workspace: any) => workspace.mcpAllowed);
    const navigationWorkspaces = access.filter((workspace: any) =>
      workspace.mcpAllowed || workspace.permission === 'owner'
    );

    return json({
      mcpWorkspaces: navigationWorkspaces,
      allowedWorkspaces,
      workspaces: access,
      count: allowedWorkspaces.length,
      blockedCount: access.filter((workspace: any) => !workspace.mcpAllowed).length,
      resource: 'https://orbitfsengine.vercel.app/mcp',
      engineHost: 'https://orbitfsengine.vercel.app'
    });
  } catch (error: any) {
    return json({ error: String(error?.message || 'Could not resolve MCP access') }, { status: Number(error?.status || 500) });
  }
}
