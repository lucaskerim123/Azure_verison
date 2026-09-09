<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import { fileContext } from '$lib/context.svelte';
	import {
		Badge,
		Button,
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
		Input
	} from '$lib/components/ui';
	import {
		Building2,
		HardDrive,
		LoaderCircle,
		MessageSquare,
		Plus,
		RefreshCw,
		Shield,
		Trash2,
		Users
	} from '@lucide/svelte';
	import PathPicker from '$lib/components/path-picker.svelte';

	const GiB = 1024 ** 3;
	const MiB = 1024 ** 2;
	const roles = ['owner', 'editor', 'contributor', 'viewer'];
	const editableRoles = ['editor', 'contributor', 'viewer'];
	let fileActions = $state<string[]>(['read','write','download','move','delete','create','share']);
	let managementActions = $state<string[]>([
		'view_settings','edit_settings','manage_members','manage_permissions','manage_library','view_protected_folders','manage_protected_folders',
		'ventmode_use','ventmode_configure','ventmode_read','ventmode_load','ventmode_create','ventmode_draft','ventmode_upload','ventmode_discard','ventmode_read_others','ventmode_manage_others','send_messages','delete_workspace'
	]);
	const coreManagementLabels: Record<string, string> = {
		view_settings:'View workspace settings', edit_settings:'Edit workspace settings', manage_members:'Manage members', manage_permissions:'Manage permissions', manage_library:'Manage Library / Knowledge',
		view_protected_folders:'View protected folders', manage_protected_folders:'Manage protected folders', ventmode_use:'Use Vent Mode', ventmode_configure:'Configure Vent Mode', ventmode_read:'View Vent Mode vents', ventmode_load:'Load Vent Mode vents', ventmode_create:'Create Vent Mode vents', ventmode_draft:'Save Vent Mode drafts', ventmode_upload:'Upload/finalise Vent Mode vents', ventmode_discard:'Discard Vent Mode working vents', ventmode_read_others:'View other users Vent Mode vents', ventmode_manage_others:'Manage other users Vent Mode vents', send_messages:'Send workspace messages', delete_workspace:'Delete workspace'
	};
	let managementLabels = $state<Record<string, string>>({ ...coreManagementLabels });
	const profileActions = [
		'view',
		'create',
		'edit',
		'edit_assigned',
		'queue_profile_commands',
		'approve_profile_commands',
		'delete',
		'import',
		'export',
		'repair',
		'manage_fields',
		'manage_templates',
		'manage_startup',
		'load_context',
		'view_restricted',
		'edit_restricted',
		'manage_permissions'
	];
	const profileLabels: Record<string, string> = {
		view: 'View profiles',
		create: 'Create profiles',
		edit: 'Edit profiles in panel',
		edit_assigned: 'Edit assigned profiles only',
		queue_profile_commands: 'Queue profile commands for approval',
		approve_profile_commands: 'Approve queued profile commands',
		delete: 'Delete profiles',
		import: 'Import profiles',
		export: 'Export profiles',
		repair: 'Repair / migrate profiles',
		manage_fields: 'Manage profile fields',
		manage_templates: 'Manage profile templates',
		manage_startup: 'Manage profile loading rules',
		load_context: 'Load profiles into MCP',
		view_restricted: 'View restricted profiles / allow MCP requests on restricted profiles',
		edit_restricted: 'Edit restricted profiles',
		manage_permissions: 'Manage profile permissions'
	};
	const profileDefaults: Record<string, Record<string, boolean>> = {
		editor: {
			view: true,
			create: true,
			edit: true,
			edit_assigned: true,
			queue_profile_commands: true,
			approve_profile_commands: true,
			delete: true,
			import: true,
			export: true,
			repair: false,
			manage_fields: false,
			manage_templates: false,
			manage_startup: false,
			load_context: true,
			view_restricted: false,
			edit_restricted: false,
			manage_permissions: false
		},
		contributor: {
			view: true,
			create: true,
			edit: false,
			edit_assigned: true,
			queue_profile_commands: true,
			approve_profile_commands: false,
			delete: false,
			import: true,
			export: false,
			repair: false,
			manage_fields: false,
			manage_templates: false,
			manage_startup: false,
			load_context: true,
			view_restricted: false,
			edit_restricted: false,
			manage_permissions: false
		},
		viewer: {
			view: true,
			create: false,
			edit: false,
			edit_assigned: false,
			queue_profile_commands: false,
			approve_profile_commands: false,
			delete: false,
			import: false,
			export: false,
			repair: false,
			manage_fields: false,
			manage_templates: false,
			manage_startup: false,
			load_context: false,
			view_restricted: false,
			edit_restricted: false,
			manage_permissions: false
		}
	};

	type Workspace = {
		id: string;
		name: string;
		description?: string;
		status: string;
		is_main: boolean;
		is_public?: boolean;
		delete_protected?: boolean;
		auto_delete_immune?: boolean;
		offline_message?: string;
		permission: string;
		owner_username?: string;
		storage_quota_bytes?: number;
		storage_used_bytes?: number;
		trash_limit_bytes?: number;
		trash_used_bytes?: number;
		file_count?: number;
		folder_count?: number;
		drive_state?: string;
		filesystem_root?: string;
		quota_used_bytes?: number;
		total_physical_used_bytes?: number;
		system_used_bytes?: number;
		profile_storage_used_bytes?: number;
		suspension_reason?: string;
		mcp_ui_enabled?: boolean;
		mcp_system_enabled?: boolean;
		apex_system_enabled?: boolean;
		management_permissions?: Record<string, boolean>;
	};
	type Member = {
		user_id: string;
		username: string;
		permission: string;
		system_role?: string;
		mcp_enabled?: boolean;
	};
	type WorkspaceInvitation = {
		id: string;
		workspace_id: string;
		workspace_name: string;
		username: string;
		permission: string;
		status: string;
		requested_by_username: string;
		created_at: string;
	};
	type StorageRequest = {
		id: string;
		workspace_id: string;
		workspace_name?: string;
		requester_username: string;
		current_quota_bytes: number;
		requested_quota_bytes: number;
		request_type: 'upgrade' | 'downgrade';
		message?: string;
		status: string;
		created_at: string;
	};
	type OwnershipRequest = {
		id: string;
		workspace_id: string;
		workspace_name: string;
		from_user_id: string;
		from_username: string;
		target_user_id: string;
		target_username: string;
		message?: string;
		status: string;
		created_at: string;
	};
	type FileOverride = { path: string; role: string; permissions: Record<string, boolean> };
	type WorkspaceMessage = {
		id: string;
		title: string;
		message: string;
		severity: string;
		created_by: string;
		created_at: string;
	};
	type GlobalSettings = {
		publicWorkspaceVisible: boolean;
		maxWorkspacesPerUser: number;
		inactiveBeforeOfflineDays: number;
		offlineWarningDays: number;
		deleteAfterOfflineDays: number;
		deletionWarningDays: number;
		apexAccessMode: 'admins_only' | 'workspace_owners' | 'workspace_permissions';
		defaultMaxProfiles: number;
		defaultMaxProfileSizeMB: number;
		defaultMaxTotalProfileStorageMB: number;
	};
	type TrashEntry = { name: string; type: 'file' | 'dir'; size?: number; mtime?: string };
	type ManagementResponse = {
		overrides: Record<string, Record<string, boolean>>;
		effective: Record<string, Record<string, boolean>>;
	};
	type ManagementGroup = { id:string; label:string; addonId:string; attached?:boolean; permissions:string[] };
	type ManagementCatalog = { groups:ManagementGroup[]; labels?:Record<string,string>; count:number };

	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let busy = $state('');
	let canManageGlobal = $state(false);
	let currentUser = $state<{id:string;username:string;role:string}|null>(null);
	let userPermissions = $state({
		create_workspaces: true,
		access_public_workspace: true,
		invite_workspace_members: true,
		share_files: true
	});
	let workspaces = $state<Workspace[]>([]);
	let selectedId = $state<string | null>(null);
	let tab = $state<'overview' | 'profiles' | 'members' | 'permissions' | 'storage' | 'settings' | 'activity' | 'mcp' | 'system'>('overview');
	let permissionTab = $state<'files' | 'workspace' | 'profiles'>('files');
	let members = $state<Member[]>([]);
	let invitations = $state<WorkspaceInvitation[]>([]);
	let storageRequests = $state<StorageRequest[]>([]);
	let ownershipRequests = $state<OwnershipRequest[]>([]);
	let trashEntries = $state<TrashEntry[]>([]);
	let showTrash = $state(false);
	let overrides = $state<FileOverride[]>([]);
	let management = $state<ManagementResponse>({ overrides: {}, effective: {} });
	let managementCatalog = $state<ManagementCatalog>({ groups:[], count:0 });
	let permissionSearch = $state('');
	let messages = $state<WorkspaceMessage[]>([]);
	let globalSettings = $state<GlobalSettings>({
		publicWorkspaceVisible: false,
		maxWorkspacesPerUser: 1,
		inactiveBeforeOfflineDays: 30,
		offlineWarningDays: 7,
		deleteAfterOfflineDays: 30,
		deletionWarningDays: 7,
		apexAccessMode: 'workspace_owners',
		defaultMaxProfiles: 20,
		defaultMaxProfileSizeMB: 50,
		defaultMaxTotalProfileStorageMB: 0
	});
	let showGlobal = $state(false);
	let showManagerPanel = $state(false);
	let showAllWorkspaces = $state(false);
	let createOpen = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let memberName = $state('');
	let memberRole = $state('viewer');
	let memberMcp = $state(false);
	let overridePath = $state('');
	let overrideRole = $state('viewer');
	let overridePerms = $state<Record<string, boolean>>({
		read: true,
		write: false,
		download: false,
		move: false,
		delete: false,
		create: false,
		share: false
	});
	let managementRole = $state('editor');
	let managementDraft = $state<Record<string, boolean>>({});
	let profileRole = $state('editor');
	let profileRoleOverrides = $state<Record<string, Record<string, boolean>>>({});
	let profileMemberOverrides = $state<Record<string, Record<string, boolean>>>({});
	let profileDraft = $state<Record<string, boolean>>({});
	let profileMemberId = $state('');
	let profileMemberDraft = $state<Record<string, boolean>>({});
	let profilePermissionsReady = $state(false);
	let profileStatistics = $state<any>(null);
	let profileMaxProfiles = $state(20);
	let profileMaxSizeMb = $state(50);
	let profileMaxTotalMb = $state(0);
	let messageTitle = $state('');
	let messageBody = $state('');
	let messageSeverity = $state('info');
	let settingsName = $state('');
	let settingsDescription = $state('');
	let settingsQuotaGb = $state(1);
	let settingsTrashMb = $state(200);
	let settingsOwner = $state('');
	let settingsStatus = $state('active');
	let settingsAutoDeleteImmune = $state(false);
	let offlineMessage = $state('');
	let suspensionReason = $state('');
	let requestedQuotaGb = $state(5);
	let quotaMessage = $state('');
	let transferTarget = $state('');
	let transferMessage = $state('');

	const selected = $derived(workspaces.find((item) => item.id === selectedId) ?? null);
	const displayedWorkspaces = $derived(
		canManageGlobal && !showAllWorkspaces
			? workspaces.filter((item) => item.permission === 'owner' || item.is_main)
			: workspaces
	);
	const pendingInvitations = $derived(invitations.filter((item) => item.status === 'pending'));
	const pendingStorageRequests = $derived(
		storageRequests.filter((item) => item.status === 'pending')
	);
	const pendingOwnershipRequests = $derived(ownershipRequests.filter((item) => ['pending','admin_pending'].includes(item.status)));
	const targetOwnershipRequests = $derived(ownershipRequests.filter((item) => item.status === 'awaiting_target' && item.target_user_id === currentUser?.id));
	const selectedOwnershipRequests = $derived(ownershipRequests.filter((item) => item.workspace_id === selectedId && ['pending','admin_pending','awaiting_target'].includes(item.status)));
	const transferCandidates = $derived(members.filter((member) => member.permission !== 'owner'));
	const allowed = (action: string) =>
		selected?.permission === 'owner' || !!selected?.management_permissions?.[action];
	const canAccessWorkspace = (workspace: Workspace) =>
		workspace.status !== 'suspended' || canManageGlobal;
	const formatBytes = (bytes = 0) =>
		bytes >= GiB
			? `${(bytes / GiB).toFixed(2)} GB`
			: bytes >= MiB
				? `${(bytes / MiB).toFixed(1)} MB`
				: `${Math.round(bytes / 1024)} KB`;
	const messageFor = (err: unknown, fallback: string) =>
		err instanceof ApiError ? err.message : fallback;

	function syncSettings() {
		if (!selected) return;
		settingsName = selected.name;
		settingsDescription = selected.description ?? '';
		settingsQuotaGb = Number(((selected.storage_quota_bytes ?? GiB) / GiB).toFixed(2));
		settingsTrashMb = Math.round((selected.trash_limit_bytes ?? 200 * MiB) / MiB);
		settingsOwner = selected.owner_username ?? '';
		settingsStatus = selected.status;
		settingsAutoDeleteImmune = !!(selected.delete_protected || selected.auto_delete_immune);
		offlineMessage = selected.offline_message ?? '';
		suspensionReason = selected.suspension_reason ?? '';
		requestedQuotaGb = Number(((selected.storage_quota_bytes ?? 5 * GiB) / GiB).toFixed(2));
	}
	function prepareManagement(role = managementRole) {
		managementRole = role;
		const source = management.overrides[role] ?? management.effective[role] ?? {};
		managementDraft = Object.fromEntries(
			managementActions.map((action) => [action, ['ventmode_read_others','ventmode_manage_others'].includes(action) ? false : !!source[action]])
		);
	}
	function visibleManagementGroups() {
		const q=permissionSearch.trim().toLowerCase();
		const fallback:ManagementGroup[]=[{id:'workspace',label:'Workspace permissions',addonId:'base',permissions:managementActions}];
		return (managementCatalog.groups.length?managementCatalog.groups:fallback).map((group)=>({ ...group, permissions:group.permissions.filter((id)=>managementActions.includes(id) && (!q || `${managementLabels[id] || id} ${group.label}`.toLowerCase().includes(q))) })).filter((group)=>group.permissions.length>0);
	}
	function setManagementGroup(group:ManagementGroup, enabled:boolean) { managementDraft={...managementDraft,...Object.fromEntries(group.permissions.map((id)=>[id,enabled]))}; }
	function groupOverrideCount(group:ManagementGroup) { const o=management.overrides[managementRole] || {}; return group.permissions.filter((id)=>Object.prototype.hasOwnProperty.call(o,id)).length; }

	function prepareProfilePermissions(role = profileRole) {
		profileRole = role;
		const source = profileRoleOverrides[role] ?? profileDefaults[role] ?? {};
		profileDraft = Object.fromEntries(profileActions.map((action) => [action, !!source[action]]));
	}
	function prepareProfileMember(userId = profileMemberId) {
		profileMemberId = userId;
		const member = members.find((item) => item.user_id === userId);
		const roleSource = member ? (profileRoleOverrides[member.permission] ?? profileDefaults[member.permission] ?? {}) : {};
		const source = profileMemberOverrides[userId] ?? roleSource;
		profileMemberDraft = Object.fromEntries(profileActions.map((action) => [action, !!source[action]]));
	}
	async function loadDetails() {
		if (!selectedId) return;
		const workspace = workspaces.find((item) => item.id === selectedId);
		if (!workspace || !canAccessWorkspace(workspace)) {
			members = [];
			overrides = [];
			messages = [];
			return;
		}
		const id = selectedId;
		const [memberData, overrideData, managementData, messageData] = await Promise.all([
			api.get<{ members: Member[] }>(`/workspaces/${id}/members`),
			api.get<{ overrides: FileOverride[] }>(`/workspaces/${id}/permission-overrides`),
			api.get<ManagementResponse>(`/workspaces/${id}/management-permissions`),
			api.get<{ messages: WorkspaceMessage[] }>(`/workspaces/${id}/messages`)
		]);
		members = memberData.members;
		overrides = overrideData.overrides;
		management = managementData;
		messages = messageData.messages;
		try {
			const profileData = await api.get<any>(`/profiles/${id}/catalog`);
			profileRoleOverrides = profileData.roleOverrides ?? {};
			profileMemberOverrides = profileData.memberOverrides ?? {};
			profileStatistics = profileData.statistics ?? null;
			profileMaxProfiles = Number(profileData.settings?.maxProfiles ?? 20);
			profileMaxSizeMb = Math.max(1, Math.round(Number(profileData.settings?.maxProfileSizeBytes ?? 50 * MiB) / MiB));
			profileMaxTotalMb = Math.max(0, Math.round(Number(profileData.settings?.maxTotalProfileStorageBytes ?? 0) / MiB));
			profilePermissionsReady = true;
		} catch {
			profileRoleOverrides = {};
			profileMemberOverrides = {};
			profileStatistics = null;
			profilePermissionsReady = false;
		}
		prepareManagement();
		prepareProfilePermissions();
		if (!profileMemberId || !members.some((m) => m.user_id === profileMemberId)) profileMemberId = members[0]?.user_id ?? '';
		prepareProfileMember();
		syncSettings();
	}
	async function load() {
		loading = true;
		error = '';
		try {
			const data = await api.get<{
				workspaces: Workspace[];
				settings: GlobalSettings;
				canManageGlobal: boolean;
				userPermissions: typeof userPermissions;
				fileActions?: string[]; managementActions?: string[]; managementLabels?: Record<string,string>; managementCatalog?: ManagementCatalog; currentUser?: {id:string;username:string;role:string};
			}>('/workspaces');
			workspaces = data.workspaces;
			globalSettings = { ...globalSettings, ...data.settings };
			canManageGlobal = data.canManageGlobal;
			currentUser = data.currentUser || null;
			userPermissions = data.userPermissions;
			if (data.fileActions?.length) fileActions = data.fileActions;
			if (data.managementActions?.length) managementActions = data.managementActions;
			managementLabels = { ...coreManagementLabels, ...(data.managementLabels || {}) };
			managementCatalog = data.managementCatalog || { groups:[], count:data.managementActions?.length || managementActions.length };
			invitations = data.canManageGlobal
				? (await api.get<{ invitations: WorkspaceInvitation[] }>('/workspace-invitations'))
						.invitations
				: [];
			[storageRequests, ownershipRequests] = await Promise.all([
				api
					.get<{ requests: StorageRequest[] }>('/workspace-storage-requests')
					.then((result) => result.requests),
				api
					.get<{ requests: OwnershipRequest[] }>('/workspace-ownership-requests')
					.then((result) => result.requests)
			]);
			if (
				!selectedId ||
				!workspaces.some((item) => item.id === selectedId && canAccessWorkspace(item))
			)
				selectedId = workspaces.find(canAccessWorkspace)?.id ?? null;
			await loadDetails();
		} catch (err) {
			error = messageFor(err, 'Failed to load workspaces');
		} finally {
			loading = false;
		}
	}
	async function run(key: string, action: () => Promise<unknown>, reload = true) {
		busy = key;
		error = '';
		notice = '';
		try {
			await action();
			if (reload) await load();
			notice = 'Changes saved.';
		} catch (err) {
			error = messageFor(err, 'Action failed');
		} finally {
			busy = '';
		}
	}
	async function choose(id: string) {
		const workspace = workspaces.find((item) => item.id === id);
		if (!workspace || !canAccessWorkspace(workspace)) return;
		selectedId = id;
		error = '';
		showTrash = false;
		await loadDetails();
	}
	async function openSelected() {
		if (!selected || !canAccessWorkspace(selected)) return;
		fileContext.set(selected.id, selected.name);
		await goto('/');
	}
	async function refreshStats() {
		if (!selected) return;
		await run(
			'stats',
			async () => {
				const result = await api.get<{ workspace: Workspace }>(`/workspaces/${selected.id}/stats`);
				workspaces = workspaces.map((item) =>
					item.id === result.workspace.id ? result.workspace : item
				);
			},
			false
		);
	}
	async function createWorkspace() {
		await run('create', () =>
			api.post('/workspaces', { name: newName, description: newDescription })
		);
		createOpen = false;
		newName = '';
		newDescription = '';
	}
	async function viewTrash() {
		if (!selected) return;
		busy = 'trash-view';
		error = '';
		try {
			const result = await api.get<{ entries: TrashEntry[] }>(`/workspaces/${selected.id}/trash`);
			trashEntries = result.entries;
			showTrash = true;
		} catch (err) {
			error = messageFor(err, 'Could not load trash');
		} finally {
			busy = '';
		}
	}
	async function emptyTrash() {
		if (!selected || !confirm(`Permanently empty trash for ${selected.name}?`)) return;
		await run('trash-empty', () => api.delete(`/workspaces/${selected.id}/trash`));
		trashEntries = [];
		showTrash = false;
	}
	async function saveGlobal() {
		await run('global', () => api.patch('/workspaces/settings', globalSettings));
	}
	async function saveWorkspace() {
		if (!selected) return;
		const changes: Record<string, unknown> = {
			name: settingsName,
			description: settingsDescription
		};
		if (canManageGlobal) {
			changes.deleteProtected = settingsAutoDeleteImmune;
			changes.autoDeleteImmune = settingsAutoDeleteImmune;
			changes.offlineMessage = offlineMessage;
		}
		if (canManageGlobal) {
			changes.storageQuotaBytes = settingsQuotaGb * GiB;
			changes.trashLimitBytes = settingsTrashMb * MiB;
			changes.status = settingsStatus;
			changes.suspensionReason = suspensionReason;
		}
		await run('settings', () => api.patch(`/workspaces/${selected.id}`, changes));
	}
	async function setOffline() {
		if (!selected) return;
		const status = selected.status === 'offline' ? 'active' : 'offline';
		await run('offline', () => api.patch(`/workspaces/${selected.id}`, { status }));
	}
	async function toggleMcp() {
		if (!selected || (!canManageGlobal && selected.permission !== 'owner') || selected.mcp_system_enabled === false) return;
		await run('mcp', () =>
			api.patch(`/workspaces/${selected.id}`, { mcpEnabled: !selected.mcp_ui_enabled })
		);
	}
	async function toggleMcpSystem() {
		if (!selected || !canManageGlobal) return;
		await run('mcp-system', () =>
			api.patch(`/workspaces/${selected.id}`, {
				mcpSystemEnabled: selected.mcp_system_enabled === false
			})
		);
	}
	async function addMember() {
		if (!selected || !memberName.trim()) return;
		busy = 'member-add';
		error = '';
		notice = '';
		try {
			const result = await api.put<{ pendingApproval: boolean }>(
				`/workspaces/${selected.id}/members/${encodeURIComponent(memberName.trim())}`,
				{ permission: memberRole, mcpEnabled: memberMcp }
			);
			memberName = '';
			memberRole = 'viewer';
			memberMcp = false;
			await load();
			notice = result.pendingApproval
				? 'User does not exist. An Owner/Admin approval request was created; approval creates the account with temporary PIN 0000.'
				: 'Member added. Their user account remains independent of workspace membership.';
		} catch (err) {
			error = messageFor(err, 'Could not add member');
		} finally {
			busy = '';
		}
	}
	async function respondInvitation(invitationId: string, decision: 'approved' | 'denied') {
		await run(`invitation-${invitationId}`, () =>
			api.post(`/workspace-invitations/${invitationId}/respond`, { decision })
		);
	}
	async function requestQuota() {
		if (!selected) return;
		await run('quota-request', () =>
			api.post(`/workspaces/${selected.id}/storage-request`, {
				requestedQuotaBytes: requestedQuotaGb * GiB,
				message: quotaMessage
			})
		);
		quotaMessage = '';
	}
	async function respondQuota(requestId: string, decision: 'approved' | 'denied') {
		await run(`quota-${requestId}`, () =>
			api.post(`/workspace-storage-requests/${requestId}/respond`, { decision })
		);
	}
	async function requestTransfer() {
		if (!selected || !transferTarget) return;
		await run('ownership-request', () =>
			api.post(`/workspaces/${selected.id}/ownership-request`, {
				targetUsername: transferTarget,
				message: transferMessage
			})
		);
		transferTarget = '';
		transferMessage = '';
	}
	async function setOwnerDirect() {
		if (!selected || !canManageGlobal || selected.is_main || !settingsOwner.trim()) return;
		await run('owner-direct', () => api.patch(`/workspaces/${selected.id}`, { ownerUsername: settingsOwner.trim() }));
	}
	async function respondTransfer(requestId: string, decision: 'approved' | 'denied') {
		await run(`ownership-${requestId}`, () => api.post(`/workspace-ownership-requests/${requestId}/respond`, { decision }));
	}
	async function respondTargetTransfer(requestId:string, decision:'accepted'|'declined') {
		await run(`ownership-target-${requestId}`, () => api.post(`/workspace-ownership-requests/${requestId}/target-respond`, { decision }));
	}
	async function saveMember(member: Member) {
		if (!selected) return;
		await run(`member-${member.user_id}`, () =>
			api.put(`/workspaces/${selected.id}/members/${encodeURIComponent(member.username)}`, {
				permission: member.permission,
				mcpEnabled: member.mcp_enabled
			})
		);
	}
	async function removeMember(member: Member) {
		if (!selected || !confirm(`Remove ${member.username} from this workspace?`)) return;
		await run(`remove-${member.user_id}`, () =>
			api.delete(`/workspaces/${selected.id}/members/${member.user_id}`)
		);
	}
	async function saveFileOverride() {
		if (!selected) return;
		await run('file-permission', () =>
			api.put(`/workspaces/${selected.id}/permission-overrides`, {
				path: overridePath,
				role: overrideRole,
				permissions: overridePerms
			})
		);
	}
	async function removeFileOverride(item: FileOverride) {
		if (!selected) return;
		await run('file-permission-remove', () =>
			api.delete(
				`/workspaces/${selected.id}/permission-overrides?path=${encodeURIComponent(item.path)}&role=${item.role}`
			)
		);
	}
	async function saveManagement() {
		if (!selected) return;
		await run('management-permission', () =>
			api.put(`/workspaces/${selected.id}/management-permissions`, {
				role: managementRole,
				permissions: managementDraft
			})
		);
	}
	async function resetManagement() {
		if (!selected) return;
		await run('management-reset', () =>
			api.delete(`/workspaces/${selected.id}/management-permissions?role=${managementRole}`)
		);
	}
	async function saveProfileLimits() {
		if (!selected) return;
		await run('profile-limits', () => api.put(`/profiles/${selected.id}/module-settings`, { maxProfiles: profileMaxProfiles, maxProfileSizeMB: profileMaxSizeMb, maxTotalProfileStorageMB: profileMaxTotalMb }));
	}
	async function saveProfileAccess() {
		if (!selected) return;
		const roleOverrides = { ...profileRoleOverrides, [profileRole]: profileDraft };
		await run('profile-permission', () =>
			api.put(`/profiles/${selected.id}/permissions`, {
				roleOverrides,
				memberOverrides: profileMemberOverrides
			})
		);
	}
	async function resetProfileAccess() {
		if (!selected) return;
		const roleOverrides = { ...profileRoleOverrides };
		delete roleOverrides[profileRole];
		await run('profile-permission-reset', () =>
			api.put(`/profiles/${selected.id}/permissions`, {
				roleOverrides,
				memberOverrides: profileMemberOverrides
			})
		);
	}
	async function saveProfileMemberAccess() {
		if (!selected || !profileMemberId) return;
		const memberOverrides = { ...profileMemberOverrides, [profileMemberId]: profileMemberDraft };
		await run('profile-member-permission', () => api.put(`/profiles/${selected.id}/permissions`, { roleOverrides: profileRoleOverrides, memberOverrides }));
	}
	async function resetProfileMemberAccess() {
		if (!selected || !profileMemberId) return;
		const memberOverrides = { ...profileMemberOverrides }; delete memberOverrides[profileMemberId];
		await run('profile-member-permission-reset', () => api.put(`/profiles/${selected.id}/permissions`, { roleOverrides: profileRoleOverrides, memberOverrides }));
	}
	async function sendMessage() {
		if (!selected || !messageTitle.trim() || !messageBody.trim()) return;
		await run('message', () =>
			api.post(`/workspaces/${selected.id}/messages`, {
				title: messageTitle,
				message: messageBody,
				severity: messageSeverity
			})
		);
		messageTitle = '';
		messageBody = '';
		messageSeverity = 'info';
	}
	async function deleteWorkspace() {
		if (!selected || !confirm(`Move ${selected.name} to recoverable system trash?`)) return;
		await run('delete', () => api.delete(`/workspaces/${selected.id}`));
	}
	load();
</script>

<div class="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-4 lg:p-6">
	<header class="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="min-w-0">
			<div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><Building2 class="size-4" /> Workspace manager</div>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight">Workspaces</h1>
			<p class="text-sm text-muted-foreground">Manage workspace access, members, profiles, storage and system settings.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={load} disabled={loading}><RefreshCw class="size-4" /> Refresh</Button>
			<Button onclick={() => (createOpen = true)} disabled={!userPermissions.create_workspaces}><Plus class="size-4" /> New workspace</Button>
		</div>
	</header>

	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>{/if}
	{#if notice}<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">{notice}</div>{/if}

	{#if loading}
		<div class="grid min-h-[45vh] place-items-center"><LoaderCircle class="size-7 animate-spin" /></div>
	{:else}
		<div class="grid gap-4 xl:grid-cols-[270px_minmax(0,1fr)]">
			<aside class="space-y-3 xl:sticky xl:top-4 xl:self-start">
				<Card>
					<CardHeader class="pb-3"><CardTitle class="text-base">Your workspaces</CardTitle><CardDescription>{displayedWorkspaces.length} shown · {workspaces.length} total</CardDescription></CardHeader>
					<CardContent class="space-y-2">
						{#each displayedWorkspaces as item}
							<button class="w-full rounded-lg border px-3 py-2.5 text-left transition {selectedId === item.id ? 'border-primary bg-primary/10' : 'border-border/70 hover:bg-muted/50'} {canAccessWorkspace(item) ? '' : 'cursor-not-allowed opacity-45'}" onclick={() => choose(item.id)} disabled={!canAccessWorkspace(item)}>
								<div class="flex items-center justify-between gap-2"><strong class="truncate text-sm">{item.name}</strong><Badge variant={item.status === 'active' ? 'success' : 'secondary'}>{item.status}</Badge></div>
								<div class="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{item.permission}</span><span>{formatBytes(item.quota_used_bytes ?? item.storage_used_bytes ?? 0)}</span></div>
							</button>
						{/each}
						{#if canManageGlobal}<Button class="w-full" size="sm" variant="ghost" onclick={() => (showAllWorkspaces = !showAllWorkspaces)}>{showAllWorkspaces ? 'Show my / main only' : 'Show all workspaces'}</Button>{/if}
					</CardContent>
				</Card>
				{#if canManageGlobal}<Card><CardContent class="p-3"><button class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-muted/50" onclick={() => (showManagerPanel = !showManagerPanel)}><span><span class="block text-sm font-medium">System administration</span><span class="block text-xs text-muted-foreground">Global defaults, approvals and lifecycle rules</span></span><Shield class="size-4 text-muted-foreground" /></button></CardContent></Card>{/if}
			</aside>

			<main class="min-w-0 space-y-4">
				{#if targetOwnershipRequests.length > 0}<Card class="border-primary/40"><CardHeader><CardTitle>Workspace ownership invitation</CardTitle><CardDescription>An admin approved an ownership transfer to you. Nothing changes until you accept.</CardDescription></CardHeader><CardContent class="space-y-3">{#each targetOwnershipRequests as request (request.id)}<div class="rounded-lg border p-3"><strong>{request.workspace_name}</strong><p class="mt-1 text-sm text-muted-foreground">{request.from_username} wants to transfer full ownership of this workspace to you.</p>{#if request.message}<p class="mt-2 text-sm">{request.message}</p>{/if}<div class="mt-3 flex flex-wrap gap-2"><Button onclick={()=>respondTargetTransfer(request.id,'accepted')}>Accept ownership</Button><Button variant="outline" onclick={()=>respondTargetTransfer(request.id,'declined')}>Decline</Button></div></div>{/each}</CardContent></Card>{/if}
				{#if canManageGlobal && showManagerPanel}
					<Card class="border-primary/30"><CardHeader><div class="flex items-start justify-between gap-3"><div><CardTitle>System Administration</CardTitle><CardDescription>Global Workspaces settings and approval queues. These settings are not part of the selected workspace.</CardDescription></div><Button size="sm" variant="ghost" onclick={() => (showManagerPanel = false)}>Close</Button></div></CardHeader><CardContent class="space-y-4">
						<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label class="space-y-1 text-sm"><span>Max workspaces per user</span><Input type="number" min="0" bind:value={globalSettings.maxWorkspacesPerUser} /></label><label class="space-y-1 text-sm"><span>Inactive before offline (days)</span><Input type="number" min="0" bind:value={globalSettings.inactiveBeforeOfflineDays} /></label><label class="space-y-1 text-sm"><span>Delete after offline (days)</span><Input type="number" min="0" bind:value={globalSettings.deleteAfterOfflineDays} /></label><label class="space-y-1 text-sm"><span>Default profiles</span><Input type="number" min="1" bind:value={globalSettings.defaultMaxProfiles} /></label><div class="rounded-lg border p-3 text-sm sm:col-span-2 xl:col-span-4"><label class="flex items-center justify-between gap-3"><span><span class="block font-medium">Show Public Workspace</span><span class="block text-xs text-muted-foreground">Ownerless shared workspace. Non-admins can only read it; hiding removes it from normal workspace lists.</span></span><span class="flex items-center gap-3"><Badge variant={globalSettings.publicWorkspaceVisible ? 'success' : 'secondary'}>{globalSettings.publicWorkspaceVisible ? 'Shown' : 'Hidden'}</Badge><input class="h-5 w-5 accent-primary" type="checkbox" bind:checked={globalSettings.publicWorkspaceVisible} /></span></label></div></div>
						<div class="flex flex-wrap gap-2"><Button onclick={saveGlobal} disabled={busy === 'global'}>Save global Workspaces settings</Button><Badge variant="outline">{pendingInvitations.length} member approvals</Badge><Badge variant="outline">{pendingStorageRequests.length} quota approvals</Badge><Badge variant="outline">{pendingOwnershipRequests.length} ownership approvals</Badge></div>
						<div class="grid gap-3 xl:grid-cols-3"><div class="rounded-lg border p-3"><p class="font-medium">Member approvals</p>{#each pendingInvitations as invitation (invitation.id)}<div class="mt-2 rounded-md border p-2"><p class="text-sm">{invitation.username} → {invitation.workspace_name}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondInvitation(invitation.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondInvitation(invitation.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingInvitations.length === 0}<p class="mt-2 text-sm text-muted-foreground">No pending requests.</p>{/if}</div><div class="rounded-lg border p-3"><p class="font-medium">Quota approvals</p>{#each pendingStorageRequests as request (request.id)}<div class="mt-2 rounded-md border p-2"><p class="text-sm">{request.workspace_name}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondQuota(request.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondQuota(request.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingStorageRequests.length === 0}<p class="mt-2 text-sm text-muted-foreground">No pending requests.</p>{/if}</div><div class="rounded-lg border p-3"><p class="font-medium">Ownership approvals</p>{#each pendingOwnershipRequests as request (request.id)}<div class="mt-2 rounded-md border p-2"><p class="text-sm">{request.workspace_name}: {request.from_username} → {request.target_username}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondTransfer(request.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondTransfer(request.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingOwnershipRequests.length === 0}<p class="mt-2 text-sm text-muted-foreground">No pending requests.</p>{/if}</div></div>
					</CardContent></Card>
				{/if}
				{#if selected}
					<Card class="overflow-hidden">
						<CardContent class="p-0">
							<div class="flex flex-col gap-4 border-b border-border/70 bg-muted/15 p-4 lg:flex-row lg:items-center lg:justify-between">
								<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="truncate text-xl font-semibold">{selected.name}</h2><Badge variant={selected.status === 'active' ? 'success' : 'secondary'}>{selected.status}</Badge>{#if selected.is_public}<Badge variant="outline">Public</Badge>{/if}</div><p class="mt-1 max-w-3xl text-sm text-muted-foreground">{selected.description || 'No workspace description set.'}</p></div>
								<div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" onclick={refreshStats} disabled={busy === 'stats'}><RefreshCw class="size-4" /> Stats</Button><Button size="sm" onclick={openSelected}>Open files</Button></div>
							</div>
							<div class="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4 lg:grid-cols-6">
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Role</p><p class="mt-1 font-medium capitalize">{selected.permission}</p></div>
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Members</p><p class="mt-1 font-medium">{members.length}</p></div>
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Profiles</p><p class="mt-1 font-medium">{profileStatistics?.profileCount ?? 0} / {profileStatistics?.maxProfiles ?? profileMaxProfiles}</p></div>
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Quota used</p><p class="mt-1 font-medium">{formatBytes(selected.quota_used_bytes ?? selected.storage_used_bytes ?? 0)}</p></div>
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Physical</p><p class="mt-1 font-medium">{formatBytes(selected.total_physical_used_bytes ?? selected.storage_used_bytes ?? 0)}</p></div>
								<div class="bg-card p-3"><p class="text-[11px] uppercase tracking-wide text-muted-foreground">Drive</p><p class="mt-1 font-medium capitalize">{selected.drive_state || 'online'}</p></div>
							</div>
						</CardContent>
					</Card>

					<div class="-mx-1 overflow-x-auto px-1 pb-1"><div class="flex min-w-max gap-2">
						{#each [['overview','Overview'],['members','People'],['permissions','Permissions'],['profiles','Profiles'],['storage','Storage'],['settings','Setup'],['mcp','Integrations'],['activity','Activity']] as item}
							<button class="shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition {tab === item[0] ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card hover:bg-muted/50'}" onclick={() => (tab = item[0] as typeof tab)}>{item[1]}</button>
						{/each}
					</div></div>

					{#if tab === 'overview'}
						<div class="grid gap-4 lg:grid-cols-3">
							<Card class="lg:col-span-2"><CardHeader><CardTitle>Workspace overview</CardTitle><CardDescription>Current state and key workspace information.</CardDescription></CardHeader><CardContent class="grid gap-3 sm:grid-cols-2">
								<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Owner</p><p class="mt-1 font-medium">{selected.is_public ? 'No owner' : (selected.owner_username || 'Unassigned')}</p></div>
								<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Status</p><p class="mt-1 font-medium capitalize">{selected.status}</p></div>
								<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Files / folders</p><p class="mt-1 font-medium">{selected.file_count ?? 0} / {selected.folder_count ?? 0}</p></div>
								<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Profile storage</p><p class="mt-1 font-medium">{formatBytes(selected.profile_storage_used_bytes ?? 0)}</p><p class="text-xs text-muted-foreground">Excluded from normal quota</p></div>
							</CardContent></Card>
							<Card><CardHeader><CardTitle>Workspace setup</CardTitle><CardDescription>At-a-glance setup state and common controls.</CardDescription></CardHeader><CardContent class="space-y-2">
								<div class="flex items-center justify-between rounded-lg border p-2 text-sm"><span>Owner</span><Badge variant={selected.is_public || selected.owner_username ? 'success' : 'secondary'}>{selected.is_public ? 'Public' : (selected.owner_username || 'Missing')}</Badge></div>
								<div class="flex items-center justify-between rounded-lg border p-2 text-sm"><span>Members</span><Badge variant="outline">{members.length}</Badge></div>
								<div class="flex items-center justify-between rounded-lg border p-2 text-sm"><span>Profiles</span><Badge variant={profilePermissionsReady ? 'success' : 'secondary'}>{profilePermissionsReady ? `${profileStatistics?.profileCount ?? 0} ready` : 'Unavailable'}</Badge></div>
								<div class="flex items-center justify-between rounded-lg border p-2 text-sm"><span>Studio</span><Badge variant={managementCatalog.groups.some((g)=>g.addonId==='studio' && g.attached!==false) ? 'success' : 'secondary'}>{managementCatalog.groups.some((g)=>g.addonId==='studio' && g.attached!==false) ? 'Attached' : 'Not attached'}</Badge></div>
								<div class="flex items-center justify-between rounded-lg border p-2 text-sm"><span>MCP</span><Badge variant={selected.mcp_system_enabled !== false && selected.mcp_ui_enabled ? 'success' : 'secondary'}>{selected.mcp_system_enabled === false ? 'Blocked' : selected.mcp_ui_enabled ? 'Enabled' : 'Disabled'}</Badge></div>

								<div class="grid grid-cols-2 gap-2 pt-1"><Button size="sm" variant="outline" onclick={() => (tab = 'members')}>People</Button><Button size="sm" variant="outline" onclick={() => (tab = 'permissions')}>Permissions</Button><Button size="sm" variant="outline" onclick={() => (tab = 'settings')}>Setup</Button><Button size="sm" variant="outline" onclick={() => (tab = 'mcp')}>Integrations</Button></div>
							</CardContent></Card>
						</div>

					{:else if tab === 'profiles'}
						<div class="space-y-4">
							<Card><CardHeader><CardTitle>Profile allocation</CardTitle><CardDescription>Profiles are structured Supabase data and do not consume normal workspace file quota.</CardDescription></CardHeader><CardContent>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Profiles used</p><p class="mt-1 text-xl font-semibold">{profileStatistics?.profileCount ?? 0}</p></div>
									<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Profiles allowed</p><p class="mt-1 text-xl font-semibold">{profileStatistics?.maxProfiles ?? profileMaxProfiles}</p></div>
									<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Profile storage</p><p class="mt-1 text-xl font-semibold">{formatBytes(profileStatistics?.totalStorageBytes ?? selected.profile_storage_used_bytes ?? 0)}</p></div>
									<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Largest profile</p><p class="mt-1 text-xl font-semibold">{formatBytes(profileStatistics?.largestProfileBytes ?? 0)}</p></div>
								</div>
							</CardContent></Card>
							<Card><CardHeader><CardTitle>Profile limits</CardTitle><CardDescription>Workspace-specific limits for structured Profile data in Supabase.</CardDescription></CardHeader><CardContent class="grid gap-4 md:grid-cols-3">
								<label class="space-y-1 text-sm"><span>Maximum profiles</span><Input type="number" min="1" bind:value={profileMaxProfiles} /></label>
								<label class="space-y-1 text-sm"><span>Maximum profile size (MB)</span><Input type="number" min="1" bind:value={profileMaxSizeMb} /></label>
								<label class="space-y-1 text-sm"><span>Total profile allowance (MB, 0 unlimited)</span><Input type="number" min="0" bind:value={profileMaxTotalMb} /></label>
								<div class="md:col-span-3"><Button onclick={saveProfileLimits} disabled={busy === 'profile-limits'}>Save profile limits</Button></div>
							</CardContent></Card>
						</div>

					{:else if tab === 'members'}
						<div class="space-y-4">
							<Card><CardHeader><CardTitle>Members</CardTitle><CardDescription>Manage workspace membership, roles and MCP access.</CardDescription></CardHeader><CardContent class="space-y-3">
								{#if allowed('manage_members')}
									<div class="grid gap-3 rounded-lg border bg-muted/10 p-3 md:grid-cols-[1fr_180px_auto_auto] md:items-end">
										<label class="space-y-1 text-sm"><span>Username</span><Input bind:value={memberName} placeholder="Username" /></label>
										<label class="space-y-1 text-sm"><span>Role</span><select class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={memberRole}>{#each editableRoles as role}<option value={role}>{role}</option>{/each}</select></label>
										<label class="flex h-9 items-center gap-2 text-sm"><input type="checkbox" bind:checked={memberMcp} /> MCP enabled</label>
										<Button onclick={addMember} disabled={busy === 'member-add' || !memberName.trim()}>Add member</Button>
									</div>
								{/if}
								<div class="grid gap-2">
									{#each members as member (member.user_id)}
										<div class="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_170px_130px_auto] md:items-center">
											<div class="min-w-0"><div class="flex items-center gap-2"><strong class="truncate">{member.username}</strong>{#if member.system_role}<Badge variant="outline">{member.system_role}</Badge>{/if}</div><p class="text-xs text-muted-foreground">User ID: {member.user_id}</p></div>
											<select class="h-9 rounded-md border border-input bg-background px-3 text-sm" bind:value={member.permission} disabled={member.permission === 'owner' || !allowed('manage_members')}>{#each roles as role}<option value={role}>{role}</option>{/each}</select>
											<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={member.mcp_enabled} disabled={!allowed('manage_members')} /> MCP access</label>
											<div class="flex gap-2 md:justify-end">{#if allowed('manage_members')}<Button size="sm" variant="outline" onclick={() => saveMember(member)}>Save</Button>{#if member.permission !== 'owner'}<Button size="sm" variant="ghost" class="text-destructive" onclick={() => removeMember(member)}>Remove</Button>{/if}{/if}</div>
										</div>
									{/each}
									{#if members.length === 0}<p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No members are currently assigned.</p>{/if}
								</div>
							</CardContent></Card>
						</div>

					{:else if tab === 'permissions'}
						<div class="space-y-4">
							<div class="grid grid-cols-3 gap-2"><button class="rounded-lg border px-3 py-2 text-sm {permissionTab === 'files' ? 'border-primary bg-primary/10' : ''}" onclick={() => (permissionTab = 'files')}>Files</button><button class="rounded-lg border px-3 py-2 text-sm {permissionTab === 'workspace' ? 'border-primary bg-primary/10' : ''}" onclick={() => (permissionTab = 'workspace')}>Workspace</button><button class="rounded-lg border px-3 py-2 text-sm {permissionTab === 'profiles' ? 'border-primary bg-primary/10' : ''}" onclick={() => (permissionTab = 'profiles')}>Profiles</button></div>
							{#if permissionTab === 'files'}
								<Card><CardHeader><CardTitle>File and folder permissions</CardTitle><CardDescription>Profile permissions are separate. Protected folders require their own authority.</CardDescription></CardHeader><CardContent class="space-y-4">
									<div class="grid gap-3 md:grid-cols-[1fr_160px]"><label class="space-y-1 text-sm"><span>Path</span><Input bind:value={overridePath} placeholder="Folder or file path" /></label><label class="space-y-1 text-sm"><span>Role</span><select class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={overrideRole}>{#each editableRoles as role}<option value={role}>{role}</option>{/each}</select></label></div>
									<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{#each fileActions as action}<label class="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" bind:checked={overridePerms[action]} /> <span class="capitalize">{action}</span></label>{/each}</div>
									<Button onclick={saveFileOverride} disabled={!allowed('manage_permissions')}>Save file override</Button>
									<div class="space-y-2">{#each overrides as item}<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><strong>{item.path || '/'}</strong><p class="text-xs text-muted-foreground">Role: {item.role}</p></div><Button size="sm" variant="ghost" class="text-destructive" onclick={() => removeFileOverride(item)}>Remove</Button></div>{/each}</div>
								</CardContent></Card>

							{:else if permissionTab === 'workspace'}
								<Card><CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Workspace & addon permissions</CardTitle><CardDescription>Every installed Base/addon workspace capability is listed here automatically. Changes apply to the selected workspace role.</CardDescription></div><Badge variant="outline">{managementCatalog.count || managementActions.length} permissions</Badge></div></CardHeader><CardContent class="space-y-4">
									<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div class="flex flex-wrap gap-2">{#each editableRoles as role}<Button size="sm" variant={managementRole === role ? 'default' : 'outline'} onclick={() => prepareManagement(role)}>{role}</Button>{/each}</div><div class="w-full lg:max-w-sm"><Input bind:value={permissionSearch} placeholder="Search permissions or systems…" /></div></div>
									<div class="space-y-3">{#each visibleManagementGroups() as group (group.id)}
										<div class="rounded-xl border p-3 sm:p-4"><div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><strong>{group.label}</strong>{#if group.addonId !== 'base'}<Badge variant="outline">addon</Badge>{/if}{#if group.attached === false}<Badge variant="secondary">detached</Badge>{/if}{#if groupOverrideCount(group)}<Badge variant="outline">{groupOverrideCount(group)} custom</Badge>{/if}</div><p class="mt-1 text-xs text-muted-foreground">{group.permissions.length} permission{group.permissions.length === 1 ? '' : 's'}</p></div><div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" onclick={() => setManagementGroup(group,true)}>Enable all</Button><Button size="sm" variant="outline" onclick={() => setManagementGroup(group,false)}>Disable all</Button></div></div>
										<div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{#each group.permissions as action}<label class="flex items-start gap-2 rounded-lg border p-3 text-sm"><input class="mt-0.5" type="checkbox" bind:checked={managementDraft[action]} disabled={['ventmode_configure','ventmode_read_others','ventmode_manage_others'].includes(action) && managementRole !== 'owner'} /><span class="min-w-0"><span class="block">{managementLabels[action] || action}</span>{#if ['ventmode_configure','ventmode_read_others','ventmode_manage_others'].includes(action)}<span class="block text-[11px] text-muted-foreground">Workspace Owner / System Admin only</span>{/if}<code class="mt-1 block break-all text-[10px] text-muted-foreground">{action}</code></span></label>{/each}</div>
										</div>
									{/each}</div>
									<div class="sticky bottom-2 flex flex-wrap gap-2 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur"><Button onclick={saveManagement} disabled={!allowed('manage_permissions')}>Save {managementRole} permissions</Button><Button variant="outline" onclick={resetManagement} disabled={!allowed('manage_permissions')}>Reset role to defaults</Button><span class="self-center text-xs text-muted-foreground">Role overrides affect this workspace only.</span></div>
								</CardContent></Card>
							{:else}
								<Card><CardHeader><CardTitle>Profile permissions</CardTitle><CardDescription>These permissions control structured Profiles and Profile APIs only. They do not grant workspace file permissions.</CardDescription></CardHeader><CardContent class="space-y-4">
									<div class="flex flex-wrap gap-2">{#each editableRoles as role}<Button size="sm" variant={profileRole === role ? 'default' : 'outline'} onclick={() => prepareProfilePermissions(role)}>{role}</Button>{/each}</div>
									<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{#each profileActions as action}<label class="flex items-start gap-2 rounded-lg border p-3 text-sm"><input class="mt-0.5" type="checkbox" bind:checked={profileDraft[action]} /><span>{profileLabels[action] || action}</span></label>{/each}</div>
									<div class="flex gap-2"><Button onclick={saveProfileAccess} disabled={!profilePermissionsReady}>Save profile permissions</Button><Button variant="outline" onclick={resetProfileAccess} disabled={!profilePermissionsReady}>Reset role</Button></div>
					{#if members.length}<div class="border-t pt-4 space-y-3"><h3 class="font-medium">Member-specific profile permissions</h3><select class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={profileMemberId} onchange={() => prepareProfileMember(profileMemberId)}>{#each members as member}<option value={member.user_id}>{member.username} ? {member.permission}</option>{/each}</select><div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{#each profileActions as action}<label class="flex items-start gap-2 rounded-lg border p-3 text-sm"><input class="mt-0.5" type="checkbox" bind:checked={profileMemberDraft[action]} /><span>{profileLabels[action] || action}</span></label>{/each}</div><div class="flex gap-2"><Button onclick={saveProfileMemberAccess} disabled={!profilePermissionsReady || !profileMemberId}>Save member override</Button><Button variant="outline" onclick={resetProfileMemberAccess} disabled={!profilePermissionsReady || !profileMemberId}>Reset member</Button></div></div>{/if}
								</CardContent></Card>
							{/if}
						</div>

					{:else if tab === 'storage'}
						<div class="grid gap-4 lg:grid-cols-2">
							<Card><CardHeader><CardTitle>Storage breakdown</CardTitle><CardDescription>Quota usage and actual physical usage are tracked separately.</CardDescription></CardHeader><CardContent class="space-y-2">
								<div class="flex justify-between rounded-lg border p-3"><span>Normal workspace quota</span><strong>{formatBytes(selected.quota_used_bytes ?? selected.storage_used_bytes ?? 0)} / {formatBytes(selected.storage_quota_bytes ?? 0)}</strong></div>
								<div class="flex justify-between rounded-lg border p-3"><span>Profiles</span><strong>{formatBytes(selected.profile_storage_used_bytes ?? 0)}</strong></div>
								<div class="flex justify-between rounded-lg border p-3"><span>Other system data</span><strong>{formatBytes(Math.max(0,(selected.system_used_bytes ?? 0) - (selected.profile_storage_used_bytes ?? 0)))}</strong></div>
								<div class="flex justify-between rounded-lg border p-3"><span>Trash</span><strong>{formatBytes(selected.trash_used_bytes ?? 0)}</strong></div>
								<div class="flex justify-between rounded-lg border bg-muted/20 p-3"><span>Total physical usage</span><strong>{formatBytes(selected.total_physical_used_bytes ?? selected.storage_used_bytes ?? 0)}</strong></div>
							</CardContent></Card>
							<Card><CardHeader><CardTitle>Quota request</CardTitle><CardDescription>Workspace owners can request a quota change for system approval.</CardDescription></CardHeader><CardContent class="space-y-3">
								<label class="space-y-1 text-sm"><span>Requested quota (GB)</span><Input type="number" min="0" step="0.25" bind:value={requestedQuotaGb} /></label>
								<label class="space-y-1 text-sm"><span>Reason</span><Input bind:value={quotaMessage} placeholder="Optional note" /></label>
								<Button onclick={requestQuota}>Submit quota request</Button>
							</CardContent></Card>
						</div>

					{:else if tab === 'settings'}
						<div class="grid gap-4 xl:grid-cols-2">
							<Card class="xl:col-span-2"><CardHeader><CardTitle>Knowledge setup</CardTitle><CardDescription>Configure global authority, project context and routing for this workspace.</CardDescription></CardHeader><CardContent class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p class="text-sm text-muted-foreground">Stored in Supabase using canonical Library/Profile IDs. Knowledge Setup does not scan or depend on workspace files.</p><Button onclick={() => goto(`/knowledge-setup?workspace=${encodeURIComponent(selected.id)}`)}>Open Knowledge Setup</Button></CardContent></Card>
							<Card><CardHeader><CardTitle>General settings</CardTitle><CardDescription>Workspace identity and owner-managed settings.</CardDescription></CardHeader><CardContent class="grid gap-4">
								<label class="space-y-1 text-sm"><span>Name</span><Input bind:value={settingsName} /></label>
								<label class="space-y-1 text-sm"><span>Description</span><Input bind:value={settingsDescription} /></label>
								{#if canManageGlobal}<div class="grid gap-3 sm:grid-cols-2"><label class="space-y-1 text-sm"><span>Quota (GB)</span><Input type="number" min="0" bind:value={settingsQuotaGb} /></label><label class="space-y-1 text-sm"><span>Trash limit (MB)</span><Input type="number" min="0" bind:value={settingsTrashMb} /></label></div>{/if}
								<Button onclick={saveWorkspace} disabled={!allowed('edit_settings') && !canManageGlobal}>Save workspace settings</Button>
							</CardContent></Card>

							<Card><CardHeader><CardTitle>Ownership and lifecycle</CardTitle><CardDescription>Workspace owners can request a transfer. System Owner/Admin can directly set the owner.</CardDescription></CardHeader><CardContent class="space-y-4">
								<div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">Current owner</p><p class="mt-1 font-medium">{selected.is_public ? 'No owner' : (selected.owner_username || 'Unassigned')}</p></div>
								{#if !selected.is_main && (selected.permission === 'owner' || canManageGlobal)}<div class="grid gap-3 rounded-lg border p-3"><div><p class="font-medium">Transfer ownership</p><p class="text-xs text-muted-foreground">Enter any existing OrbitFS username. The user does not need to already be a workspace member.</p></div><label class="space-y-1 text-sm"><span>New owner username</span><Input bind:value={transferTarget} placeholder="Username" /></label>{#if transferCandidates.length > 0}<div class="flex flex-wrap gap-2">{#each transferCandidates as member}<Button size="sm" variant="outline" onclick={() => (transferTarget = member.username)}>{member.username}</Button>{/each}</div>{/if}<label class="space-y-1 text-sm"><span>Message</span><Input bind:value={transferMessage} placeholder="Optional transfer note" /></label><Button variant="outline" onclick={requestTransfer} disabled={!transferTarget.trim() || selectedOwnershipRequests.length > 0}>Request ownership transfer</Button>{#if selectedOwnershipRequests.length > 0}<p class="text-xs text-amber-500">A transfer is already pending for this workspace.</p>{:else}<p class="text-xs text-muted-foreground">Request flow: System Owner/Admin approval → new owner accepts or declines.</p>{/if}</div>{/if}
								{#if canManageGlobal && !selected.is_main}<div class="grid gap-3 rounded-lg border border-primary/30 p-3"><div><p class="font-medium">Admin: set workspace owner</p><p class="text-xs text-muted-foreground">Immediately changes ownership to an existing OrbitFS user and clears any pending transfer for this workspace.</p></div><label class="space-y-1 text-sm"><span>Owner username</span><Input bind:value={settingsOwner} placeholder="Username" /></label><Button onclick={setOwnerDirect} disabled={!settingsOwner.trim() || settingsOwner.trim().toLowerCase() === (selected.owner_username || '').toLowerCase() || busy === 'owner-direct'}>Set owner now</Button></div>{/if}
								{#if canManageGlobal}<div class="space-y-3 border-t pt-4"><label class="flex items-start gap-2 rounded-lg border p-3 text-sm"><input class="mt-1" type="checkbox" bind:checked={settingsAutoDeleteImmune} /><span><strong>Auto-delete immune</strong><span class="block text-xs text-muted-foreground">Workspace may go offline but lifecycle cleanup cannot delete it automatically.</span></span></label><label class="space-y-1 text-sm"><span>Status</span><select class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={settingsStatus}><option value="active">active</option><option value="offline">offline</option><option value="suspended">suspended</option></select></label><label class="space-y-1 text-sm"><span>Offline message</span><Input bind:value={offlineMessage} /></label><label class="space-y-1 text-sm"><span>Suspension reason</span><Input bind:value={suspensionReason} /></label><div class="flex flex-wrap gap-2"><Button variant="outline" onclick={setOffline}>{selected.status === 'offline' ? 'Bring online' : 'Take offline'}</Button></div></div>{/if}
							</CardContent></Card>
						</div>

					{:else if tab === 'mcp'}
						<div class="space-y-4">
							<Card><CardHeader><CardTitle>MCP</CardTitle><CardDescription>Workspace access controls for the MCP add-on. Other engines are added only when their Panel integration exists.</CardDescription></CardHeader><CardContent>
								<div class="space-y-3 rounded-lg border p-4"><div><p class="font-semibold">MCP workspace access</p><p class="text-xs text-muted-foreground">System gate plus this workspace's MCP switch.</p></div>
									<div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span><strong>System MCP</strong><span class="block text-xs text-muted-foreground">Controlled by system owner/admin</span></span><Badge variant={selected.mcp_system_enabled === false ? 'destructive' : 'success'}>{selected.mcp_system_enabled === false ? 'Blocked' : 'Allowed'}</Badge></div>
									<div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span><strong>Workspace MCP</strong><span class="block text-xs text-muted-foreground">Workspace owner/admin access</span></span><Badge variant={selected.mcp_ui_enabled ? 'success' : 'secondary'}>{selected.mcp_ui_enabled ? 'Enabled' : 'Disabled'}</Badge></div>
									<div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" onclick={toggleMcp} disabled={(!canManageGlobal && selected.permission !== 'owner') || selected.mcp_system_enabled === false || busy === 'mcp'}>{selected.mcp_ui_enabled ? 'Disable Workspace MCP' : 'Enable Workspace MCP'}</Button>{#if canManageGlobal}<Button size="sm" variant={selected.mcp_system_enabled === false ? 'outline' : 'destructive'} onclick={toggleMcpSystem} disabled={busy === 'mcp-system'}>{selected.mcp_system_enabled === false ? 'Allow System MCP' : 'Block System MCP'}</Button>{/if}</div>
								</div>
							</CardContent></Card>
						</div>

					{:else if tab === 'activity'}
						<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
							<Card><CardHeader><CardTitle>Workspace activity</CardTitle><CardDescription>Workspace messages and administrative notes.</CardDescription></CardHeader><CardContent class="space-y-2">
								{#each messages as message (message.id)}<div class="rounded-lg border p-3"><div class="flex flex-wrap items-center justify-between gap-2"><strong>{message.title}</strong><Badge variant="outline">{message.severity}</Badge></div><p class="mt-2 text-sm">{message.message}</p><p class="mt-2 text-xs text-muted-foreground">{message.created_by} · {message.created_at}</p></div>{/each}
								{#if messages.length === 0}<p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No workspace activity messages yet.</p>{/if}
							</CardContent></Card>
							{#if allowed('send_messages')}<Card><CardHeader><CardTitle>Post message</CardTitle><CardDescription>Send an administrative message to this workspace.</CardDescription></CardHeader><CardContent class="space-y-3"><label class="space-y-1 text-sm"><span>Title</span><Input bind:value={messageTitle} /></label><label class="space-y-1 text-sm"><span>Message</span><textarea class="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm" bind:value={messageBody}></textarea></label><label class="space-y-1 text-sm"><span>Severity</span><select class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" bind:value={messageSeverity}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><Button onclick={sendMessage}>Post message</Button></CardContent></Card>{/if}
						</div>

					{:else if tab === 'system' && canManageGlobal}
						<div class="space-y-4">
							<Card><CardHeader><CardTitle>System workspace defaults</CardTitle><CardDescription>Global limits and lifecycle rules for the built-in Workspaces system.</CardDescription></CardHeader><CardContent class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
								<label class="space-y-1 text-sm"><span>Max workspaces per user</span><Input type="number" min="0" bind:value={globalSettings.maxWorkspacesPerUser} /></label><label class="space-y-1 text-sm"><span>Inactive before offline (days)</span><Input type="number" min="0" bind:value={globalSettings.inactiveBeforeOfflineDays} /></label><label class="space-y-1 text-sm"><span>Offline warning (days)</span><Input type="number" min="0" bind:value={globalSettings.offlineWarningDays} /></label><label class="space-y-1 text-sm"><span>Delete after offline (days)</span><Input type="number" min="0" bind:value={globalSettings.deleteAfterOfflineDays} /></label>
								<label class="space-y-1 text-sm"><span>Deletion warning (days)</span><Input type="number" min="0" bind:value={globalSettings.deletionWarningDays} /></label><label class="space-y-1 text-sm"><span>Default profiles</span><Input type="number" min="1" bind:value={globalSettings.defaultMaxProfiles} /></label><label class="space-y-1 text-sm"><span>Default profile size (MB)</span><Input type="number" min="1" bind:value={globalSettings.defaultMaxProfileSizeMB} /></label><label class="space-y-1 text-sm"><span>Total profile allowance (MB)</span><Input type="number" min="0" bind:value={globalSettings.defaultMaxTotalProfileStorageMB} /></label><div class="rounded-lg border p-3 text-sm sm:col-span-2 xl:col-span-4"><label class="flex items-center justify-between gap-3"><span><span class="block font-medium">Show Public Workspace</span><span class="block text-xs text-muted-foreground">Ownerless shared workspace. Non-admins can only read it; hiding removes it from normal workspace lists.</span></span><span class="flex items-center gap-3"><Badge variant={globalSettings.publicWorkspaceVisible ? 'success' : 'secondary'}>{globalSettings.publicWorkspaceVisible ? 'Shown' : 'Hidden'}</Badge><input class="h-5 w-5 accent-primary" type="checkbox" bind:checked={globalSettings.publicWorkspaceVisible} /></span></label></div>
								<div class="md:col-span-2 xl:col-span-4"><Button onclick={saveGlobal} disabled={busy === 'global'}>Save global defaults</Button></div>
							</CardContent></Card>

							<div class="grid gap-4 xl:grid-cols-3">
								<Card><CardHeader><CardTitle>Member approvals</CardTitle><CardDescription>{pendingInvitations.length} pending</CardDescription></CardHeader><CardContent class="space-y-2">{#each pendingInvitations as invitation (invitation.id)}<div class="rounded-lg border p-3"><strong>{invitation.username}</strong><p class="text-xs text-muted-foreground">{invitation.workspace_name} · {invitation.permission}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondInvitation(invitation.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondInvitation(invitation.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingInvitations.length === 0}<p class="text-sm text-muted-foreground">No pending member approvals.</p>{/if}</CardContent></Card>
								<Card><CardHeader><CardTitle>Quota approvals</CardTitle><CardDescription>{pendingStorageRequests.length} pending</CardDescription></CardHeader><CardContent class="space-y-2">{#each pendingStorageRequests as request (request.id)}<div class="rounded-lg border p-3"><strong>{request.workspace_name}</strong><p class="text-xs text-muted-foreground">{formatBytes(request.current_quota_bytes)} → {formatBytes(request.requested_quota_bytes)}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondQuota(request.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondQuota(request.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingStorageRequests.length === 0}<p class="text-sm text-muted-foreground">No pending quota requests.</p>{/if}</CardContent></Card>
								<Card><CardHeader><CardTitle>Ownership approvals</CardTitle><CardDescription>{pendingOwnershipRequests.length} pending</CardDescription></CardHeader><CardContent class="space-y-2">{#each pendingOwnershipRequests as request (request.id)}<div class="rounded-lg border p-3"><strong>{request.workspace_name}</strong><p class="text-xs text-muted-foreground">{request.from_username} → {request.target_username}</p><div class="mt-2 flex gap-2"><Button size="sm" onclick={() => respondTransfer(request.id,'approved')}>Approve</Button><Button size="sm" variant="outline" onclick={() => respondTransfer(request.id,'denied')}>Deny</Button></div></div>{/each}{#if pendingOwnershipRequests.length === 0}<p class="text-sm text-muted-foreground">No pending ownership transfers.</p>{/if}</CardContent></Card>
							</div>
							<Card class="border-destructive/30"><CardHeader><CardTitle>Danger zone</CardTitle><CardDescription>Destructive workspace operations remain recoverable through system trash where supported.</CardDescription></CardHeader><CardContent><Button variant="outline" class="text-destructive" onclick={deleteWorkspace} disabled={selected.delete_protected || !allowed('delete_workspace')}>Delete workspace</Button></CardContent></Card>
						</div>
					{/if}
				{:else}
					<Card><CardContent class="p-8 text-center text-sm text-muted-foreground">No workspace is available.</CardContent></Card>
				{/if}
			</main>
		</div>
	{/if}
</div>

{#if createOpen}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) createOpen = false; }}>
		<Card class="w-full max-w-lg"><CardHeader><CardTitle>Create workspace</CardTitle><CardDescription>Create a new isolated workspace.</CardDescription></CardHeader><CardContent class="space-y-4"><label class="space-y-1 text-sm"><span>Name</span><Input bind:value={newName} placeholder="Workspace name" /></label><label class="space-y-1 text-sm"><span>Description</span><Input bind:value={newDescription} placeholder="Optional description" /></label><div class="flex justify-end gap-2"><Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button><Button onclick={createWorkspace} disabled={!newName.trim() || busy === 'create'}>Create workspace</Button></div></CardContent></Card>
	</div>
{/if}
