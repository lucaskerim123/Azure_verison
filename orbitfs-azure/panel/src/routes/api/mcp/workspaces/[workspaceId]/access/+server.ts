import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { writeAudit } from '$lib/server/audit';
import {
  getWorkspace,
  isSystemAdmin,
  managementPermissions,
  requireWorkspaceAccess,
  workspaceMembers
} from '$lib/server/workspaces';

const now = () => new Date().toISOString();

async function context(cookies: any, workspaceId: string) {
  const user = await requireUser(cookies);
  await assertPanelLicensed();
  const workspace = await getWorkspace(workspaceId);
  const role = await requireWorkspaceAccess(user, workspace);
  const permissions = await managementPermissions(user, workspace, role);
  const admin = isSystemAdmin(user);
  const canManageWorkspace = admin || role === 'owner' || permissions.manage_mcp_settings === true;
  const canManageMembers = admin || role === 'owner' || permissions.manage_members === true || permissions.manage_permissions === true;
  return { user, workspace, role, permissions, admin, canManageWorkspace, canManageMembers };
}

function reasonFor(state: any) {
  if (state.workspace.status !== 'active') return 'workspace_not_active';
  if (state.workspace.mcp_system_enabled === false) return 'mcp_system_blocked';
  if (state.workspace.mcp_ui_enabled !== true) return 'workspace_mcp_disabled';
  if (state.permissions.mcp_use !== true) return 'mcp_use_permission_denied';
  if (!state.memberEnabled) return 'member_mcp_disabled';
  return 'allowed';
}

export async function GET({ cookies, params }: any) {
  try {
    const state = await context(cookies, String(params.workspaceId || ''));
    const db = getSupabaseAdmin();
    const currentMembership = await db.from('orbitfs_workspace_members')
      .select('mcp_enabled')
      .eq('workspace_id', state.workspace.id)
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (currentMembership.error) throw currentMembership.error;
    const hasMembership = Boolean(currentMembership.data);
    const memberEnabled = hasMembership
      ? currentMembership.data?.mcp_enabled === true
      : (state.admin || state.role === 'owner');
    const members = state.canManageMembers
      ? await workspaceMembers(state.workspace.id)
      : (await workspaceMembers(state.workspace.id)).filter((member: any) => member.user_id === state.user.id);
    const reason = reasonFor({ ...state, memberEnabled });

    return json({
      workspace: {
        id: state.workspace.id,
        name: state.workspace.name,
        status: state.workspace.status,
        systemEnabled: state.workspace.mcp_system_enabled !== false,
        workspaceEnabled: state.workspace.mcp_ui_enabled === true
      },
      currentUser: {
        id: state.user.id,
        username: state.user.username,
        role: state.role,
        memberEnabled,
        hasMembership,
        permissionAllowed: state.permissions.mcp_use === true,
        allowed: reason === 'allowed',
        reason
      },
      members,
      canManageWorkspace: state.canManageWorkspace,
      canManageMembers: state.canManageMembers,
      engineHost: 'https://orbitfsengine.vercel.app',
      resource: 'https://orbitfsengine.vercel.app/mcp'
    });
  } catch (error: any) {
    return json({ error: String(error?.message || 'Could not load MCP workspace access') }, { status: Number(error?.status || 500) });
  }
}

export async function PATCH({ cookies, params, request }: any) {
  try {
    const state = await context(cookies, String(params.workspaceId || ''));
    const body = await request.json().catch(() => ({}));
    const db = getSupabaseAdmin();

    if (body.workspaceEnabled !== undefined) {
      if (!state.canManageWorkspace) throw Object.assign(new Error('MCP workspace settings permission required'), { status: 403 });
      const enabled = body.workspaceEnabled === true;
      if (enabled && state.workspace.mcp_system_enabled === false)
        throw Object.assign(new Error('System MCP is blocked for this workspace'), { status: 409 });

      const updated = await db.from('orbitfs_workspaces')
        .update({ mcp_ui_enabled: enabled, updated_at: now() })
        .eq('id', state.workspace.id);
      if (updated.error) throw updated.error;

      if (enabled) {
        const ownerId = state.workspace.owner_id || state.workspace.created_by || (state.role === 'owner' ? state.user.id : null);
        if (ownerId) {
          const existing = await db.from('orbitfs_workspace_members')
            .select('role')
            .eq('workspace_id', state.workspace.id)
            .eq('user_id', ownerId)
            .maybeSingle();
          if (existing.error) throw existing.error;
          const ownerMember = await db.from('orbitfs_workspace_members').upsert({
            workspace_id: state.workspace.id,
            user_id: ownerId,
            role: existing.data?.role || 'owner',
            mcp_enabled: true
          }, { onConflict: 'workspace_id,user_id' });
          if (ownerMember.error) throw ownerMember.error;
        }
      }

      await writeAudit({
        actorUserId: state.user.id,
        workspaceId: state.workspace.id,
        action: enabled ? 'mcp.workspace.enabled' : 'mcp.workspace.disabled',
        targetType: 'workspace',
        targetId: state.workspace.id,
        detail: { workspaceEnabled: enabled }
      });
    }

    if (body.memberUserId !== undefined && body.memberEnabled !== undefined) {
      if (!state.canManageMembers) throw Object.assign(new Error('Workspace member management permission required'), { status: 403 });
      const memberUserId = String(body.memberUserId || '').trim();
      const existing = await db.from('orbitfs_workspace_members')
        .select('user_id,role')
        .eq('workspace_id', state.workspace.id)
        .eq('user_id', memberUserId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw Object.assign(new Error('Workspace member not found'), { status: 404 });
      const memberEnabled = body.memberEnabled === true;
      const updated = await db.from('orbitfs_workspace_members')
        .update({ mcp_enabled: memberEnabled })
        .eq('workspace_id', state.workspace.id)
        .eq('user_id', memberUserId);
      if (updated.error) throw updated.error;
      await writeAudit({
        actorUserId: state.user.id,
        workspaceId: state.workspace.id,
        action: 'mcp.member.access.updated',
        targetType: 'user',
        targetId: memberUserId,
        detail: { mcpEnabled: memberEnabled }
      });
    }

    return GET({ cookies, params } as any);
  } catch (error: any) {
    return json({ error: String(error?.message || 'Could not update MCP workspace access') }, { status: Number(error?.status || 500) });
  }
}
