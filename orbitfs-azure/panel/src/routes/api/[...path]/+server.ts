import { json } from '@sveltejs/kit';
import JSZip from 'jszip';
import { createHash, randomBytes } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { requireUser, type OrbitUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { writeAudit } from '$lib/server/audit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import {
	accessibleWorkspaces,
	basename,
	createFolder,
	dirname,
	ensureCoreFolders,
	findEntry,
	fixedCoreRoot,
	listEntries,
	moveEntry,
	normalizePath,
	permissionsForPath,
	protectedWorkspacePath,
	purgeEntry,
	readEntryBytes,
	requireCapability,
	selectedWorkspace,
	writeFileBytes,
	STORAGE_BUCKET,
	storagePath
} from '$lib/server/base-compat';

const textMime = (mime: string | null | undefined) => {
	const value = String(mime || '').toLowerCase();
	return value.startsWith('text/') || value.includes('json') || value.includes('xml') || value.includes('javascript') || value.includes('markdown');
};

function apiError(error: any) {
	const status = Number(error?.status || 500);
	return json({
		error: String(error?.message || 'Request failed'),
		code: String(error?.code || (status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED')),
		component: error?.component ?? null,
		action: error?.action ?? null,
		license: error?.license ?? null,
		restricted: status === 403
	}, { status });
}

async function context(request: Request, cookies: any) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	return { user, supabase: getSupabaseAdmin(), workspace: await selectedWorkspace(request, user) };
}

function publicUserPermissions(user: OrbitUser) {
	const admin = user.role === 'owner' || user.role === 'admin';
	return {
		manage_users: admin,
		manage_workspaces: admin,
		manage_permissions: admin,
		view_audit: admin,
		manage_messages: admin,
		manage_license: admin,
		profile_use: true,
		file_use: true
	};
}

const PERMISSION_ROLES = ['editor', 'contributor', 'viewer'] as const;
const PERMISSION_ACTIONS = ['read', 'write', 'download', 'move', 'delete', 'create', 'share'] as const;

function rolePermissionDefaults(role: string) {
	if (role === 'editor') return { read: true, write: true, download: true, move: true, delete: true, create: true, share: true };
	if (role === 'contributor') return { read: true, write: true, download: true, move: true, delete: false, create: true, share: true };
	return { read: true, write: false, download: true, move: false, delete: false, create: false, share: false };
}

function permissionValues(row: any) {
	return { read: row.can_view === true, write: row.can_edit === true, download: row.can_download === true, move: row.can_move === true, delete: row.can_delete === true, create: row.can_create === true, share: row.can_share === true };
}

async function workspaceRowsForPath(workspaceId: string, path: string) {
	const supabase = getSupabaseAdmin();
	const clean = normalizePath(path);
	const { data, error } = await supabase.from('orbitfs_files').select('*').eq('workspace_id', workspaceId).is('deleted_at', null);
	if (error) throw error;
	return (data ?? []).filter((row) => row.path === clean || row.path.startsWith(`${clean}/`));
}

async function zipResponse(workspaceId: string, requestedPaths: string[], filename: string) {
	const zip = new JSZip();
	const supabase = getSupabaseAdmin();
	const { data, error } = await supabase.from('orbitfs_files').select('*').eq('workspace_id', workspaceId).is('deleted_at', null);
	if (error) throw error;
	const all = data ?? [];
	for (const original of requestedPaths) {
		const root = normalizePath(original);
		const selected = all.filter((row) => row.path === root || row.path.startsWith(`${root}/`));
		for (const row of selected) {
			const relative = requestedPaths.length === 1
				? (row.path === root ? basename(row.path) : `${basename(root)}/${row.path.slice(root.length + 1)}`)
				: row.path;
			if (row.kind === 'folder') zip.folder(relative);
			else zip.file(relative, await readEntryBytes(row));
		}
	}
	const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
	return new Response(Uint8Array.from(payload).buffer, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${filename.replace(/[\r\n"]/g, '')}"`,
			'cache-control': 'private, no-store'
		}
	});
}

async function fileResponse(entry: any, inline = false) {
	const bytes = await readEntryBytes(entry);
	return new Response(Uint8Array.from(bytes).buffer, {
		headers: {
			'content-type': entry.mime_type || 'application/octet-stream',
			'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(entry.name || 'download').replace(/[\r\n"]/g, '')}"`,
			'content-length': String(bytes.length),
			'accept-ranges': 'bytes',
			'cache-control': 'private, no-store'
		}
	});
}

export async function GET({ params, request, cookies, url }) {
	try {
		const path = String(params.path || '');
		const parts = path.split('/').filter(Boolean);
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		const supabase = getSupabaseAdmin();

		if (parts[0] === 'me') {
			return json({ user: { ...user, permissions: publicUserPermissions(user) }, username: user.username, role: user.role, email: user.email });
		}

		if (parts[0] === 'workspaces') {
			const workspaces = await accessibleWorkspaces(user);
			return json({ settings: { workspaceModeEnabled: true }, workspaces });
		}

		if (parts[0] === 'drive-config') {
			const { data } = await supabase.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', 'drive.google').maybeSingle();
			const value = (data?.value && typeof data.value === 'object') ? data.value as Record<string, any> : {};
			return json({ clientId: value.clientId ?? null, enabled: value.enabled === true, configured: Boolean(value.clientId) });
		}

		if (parts[0] === 'notifications') {
			const { data, error } = await supabase.from('orbitfs_notifications').select('*').or(`user_id.eq.${user.id},user_id.is.null`).order('created_at', { ascending: false });
			if (error) throw error;
			const notifications = (data ?? []).map((item) => ({
				id: item.id,
				title: item.title,
				message: item.body,
				severity: item.level === 'error' ? 'critical' : item.level,
				createdAt: item.created_at,
				createdBy: 'OrbitFS',
				read: Boolean(item.read_at)
			}));
			const unread = notifications.filter((item) => !item.read).length;
			return json({ notifications, unread, unreadCount: unread });
		}

		const workspace = await selectedWorkspace(request, user);
		await ensureCoreFolders(workspace.id, user.id);

		if (parts[0] === 'files') {
			const subpath = normalizePath(url.searchParams.get('subpath') ?? '');
			const permissions = await requireCapability(user, workspace.id, subpath, 'read');
			return json({
				entries: await listEntries(workspace.id, subpath),
				folderPermissions: {
					read: permissions.read,
					write: permissions.write,
					download: permissions.download,
					move: permissions.move,
					delete: permissions.delete,
					create: permissions.create,
					share: permissions.share
				},
				canManagePermissions: permissions.manage,
				canManageLibrary: user.role === 'owner' || user.role === 'admin' || ['owner','editor'].includes(String(workspace.permission || '')),
				workspace
			});
		}

		if (parts[0] === 'path-permissions') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			await requireCapability(user, workspace.id, subpath, 'manage');
			const { data: rows, error } = await supabase.from('orbitfs_file_permissions').select('*').eq('workspace_id', workspace.id).eq('principal_type', 'role').in('principal_id', [...PERMISSION_ROLES]);
			if (error) throw error;
			const effective: Record<string, any> = {};
			const explicit: Record<string, any> = {};
			for (const role of PERMISSION_ROLES) {
				const matching = (rows ?? []).filter((row) => row.principal_id === role && (!normalizePath(row.path_prefix) || subpath === normalizePath(row.path_prefix) || subpath.startsWith(`${normalizePath(row.path_prefix)}/`))).sort((a,b) => normalizePath(b.path_prefix).length - normalizePath(a.path_prefix).length);
				const exact = (rows ?? []).find((row) => row.principal_id === role && normalizePath(row.path_prefix) === subpath);
				effective[role] = matching[0] ? permissionValues(matching[0]) : rolePermissionDefaults(role);
				if (exact) explicit[role] = permissionValues(exact);
			}
			return json({ path: subpath, roles: [...PERMISSION_ROLES], actions: [...PERMISSION_ACTIONS], effective, explicit });
		}

		if (parts[0] === 'file-access') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			return json({ permissions: await permissionsForPath(user, workspace.id, subpath) });
		}

		if (parts[0] === 'file') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			const permissions = await requireCapability(user, workspace.id, subpath, 'read');
			const entry = await findEntry(workspace.id, subpath);
			if (!entry || entry.kind !== 'file') throw Object.assign(new Error('File not found'), { status: 404 });
			if (Number(entry.size_bytes || 0) > 5 * 1024 * 1024) throw Object.assign(new Error('File is too large for the text editor'), { status: 413 });
			const bytes = await readEntryBytes(entry);
			return json({ content: bytes.toString('utf8'), permissions });
		}

		if (parts[0] === 'preview') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			await requireCapability(user, workspace.id, subpath, 'read');
			const entry = await findEntry(workspace.id, subpath);
			if (!entry || entry.kind !== 'file') throw Object.assign(new Error('File not found'), { status: 404 });
			return fileResponse(entry, true);
		}

		if (parts[0] === 'download') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			if (fixedCoreRoot(subpath)) throw Object.assign(new Error('System root folders cannot be downloaded'), { status: 403 });
			await requireCapability(user, workspace.id, subpath, 'download');
			const entry = await findEntry(workspace.id, subpath);
			if (!entry || entry.kind !== 'file') throw Object.assign(new Error('File not found'), { status: 404 });
			return fileResponse(entry, false);
		}

		if (parts[0] === 'download-zip') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			if (fixedCoreRoot(subpath)) throw Object.assign(new Error('System root folders cannot be downloaded'), { status: 403 });
			await requireCapability(user, workspace.id, subpath, 'download');
			const rows = await workspaceRowsForPath(workspace.id, subpath);
			if (!rows.length) throw Object.assign(new Error('File or folder not found'), { status: 404 });
			return zipResponse(workspace.id, [subpath], `${basename(subpath) || 'workspace'}.zip`);
		}

		throw Object.assign(new Error('Not found'), { status: 404 });
	} catch (error) {
		return apiError(error);
	}
}

export async function POST({ params, request, cookies, url }) {
	try {
		const path = String(params.path || '');
		const parts = path.split('/').filter(Boolean);
		const { user, supabase, workspace } = await context(request, cookies);
		await ensureCoreFolders(workspace.id, user.id);

		if (parts[0] === 'mkdir') {
			const body = await request.json().catch(() => ({}));
			const target = normalizePath(body.path);
			if (fixedCoreRoot(target)) throw Object.assign(new Error('Core workspace folder already exists'), { status: 409 });
			await requireCapability(user, workspace.id, target, 'create');
			const item = await createFolder(workspace.id, target, user.id);
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.mkdir', targetType: 'folder', targetId: item.id, detail: { path: target } });
			return json({ ok: true });
		}

		if (parts[0] === 'trash') {
			const body = await request.json().catch(() => ({}));
			const source = normalizePath(body.path);
			if (!source) throw Object.assign(new Error('A file or folder path is required'), { status: 400 });
			if (fixedCoreRoot(source)) throw Object.assign(new Error('Core workspace folders cannot be deleted'), { status: 403 });
			await requireCapability(user, workspace.id, source, 'delete');
			if (source.startsWith('_trash/')) {
				await purgeEntry(workspace.id, source);
			} else {
				const stamp = new Date().toISOString().replace(/[:.]/g, '-');
				await moveEntry(workspace.id, source, `_trash/${stamp}-${basename(source)}`);
			}
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.trash', targetType: 'file', targetId: null, detail: { path: source } });
			return json({ ok: true });
		}

		if (parts[0] === 'move') {
			const body = await request.json().catch(() => ({}));
			const from = normalizePath(body.from), to = normalizePath(body.to);
			await requireCapability(user, workspace.id, from, 'move');
			await requireCapability(user, workspace.id, dirname(to), 'create');
			await moveEntry(workspace.id, from, to);
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.move', targetType: 'file', targetId: null, detail: { from, to } });
			return json({ ok: true });
		}

		if (parts[0] === 'bulk-move') {
			const body = await request.json().catch(() => ({}));
			const destination = normalizePath(body.destination ?? '');
			await requireCapability(user, workspace.id, destination, 'create');
			for (const value of Array.isArray(body.paths) ? body.paths : []) {
				const source = normalizePath(value);
				await requireCapability(user, workspace.id, source, 'move');
				await moveEntry(workspace.id, source, [destination, basename(source)].filter(Boolean).join('/'));
			}
			return json({ ok: true });
		}

		if (parts[0] === 'bulk-download' && parts[1] === 'validate') {
			const body = await request.json().catch(() => ({}));
			for (const value of Array.isArray(body.paths) ? body.paths : []) await requireCapability(user, workspace.id, normalizePath(value), 'download');
			return json({ ok: true, valid: true });
		}

		if (parts[0] === 'download-zip-selected') {
			const body = await request.json().catch(() => ({}));
			const paths = (Array.isArray(body.paths) ? body.paths : []).map(normalizePath).filter(Boolean);
			if (!paths.length) throw Object.assign(new Error('Select at least one file or folder'), { status: 400 });
			for (const value of paths) {
				if (fixedCoreRoot(value)) throw Object.assign(new Error('System root folders cannot be downloaded'), { status: 403 });
				await requireCapability(user, workspace.id, value, 'download');
			}
			return zipResponse(workspace.id, paths, 'selected-items.zip');
		}

		if (parts[0] === 'upload-chunked') {
			const target = normalizePath(url.searchParams.get('path') ?? 'upload.bin');
			await requireCapability(user, workspace.id, dirname(target), 'create');
			const body = await request.json().catch(() => ({}));
			const action = String(body.action || '');
			const objectPath = storagePath(workspace.id, target);
			if (action === 'init') {
				const signed = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(objectPath, { upsert:true });
				if (signed.error || !signed.data) throw signed.error ?? new Error('Could not create upload URL');
				return json({ signedUrl:signed.data.signedUrl, storagePath:objectPath });
			}
			if (action === 'finalize') {
				if (String(body.storagePath || '') !== objectPath) throw Object.assign(new Error('Upload path mismatch'), { status:400 });
				const objectDir = dirname(objectPath);
				const objectName = basename(objectPath);
				const uploaded = await supabase.storage.from(STORAGE_BUCKET).list(objectDir, { search:objectName, limit:100 });
				if (uploaded.error) throw uploaded.error;
				if (!(uploaded.data || []).some((item:any) => item.name === objectName)) {
					throw Object.assign(new Error('Storage upload did not complete. Retry the file upload.'), { status:409, code:'UPLOAD_NOT_STORED' });
				}
				const existing = await findEntry(workspace.id, target);
				const payload = { workspace_id:workspace.id, name:basename(target), path:target, kind:'file', mime_type:String(body.mimeType || 'application/octet-stream'), content_text:'', storage_path:objectPath, size_bytes:Math.max(0,Number(body.size)||0), created_by:existing?.created_by ?? user.id, deleted_at:null, updated_at:new Date().toISOString() };
				const result = existing ? await supabase.from('orbitfs_files').update(payload).eq('id',existing.id).select('*').single() : await supabase.from('orbitfs_files').insert(payload).select('*').single();
				if (result.error) throw result.error;
				await writeAudit({ actorUserId:user.id, workspaceId:workspace.id, action:'file.upload', targetType:'file', targetId:result.data.id, detail:{path:target,size:payload.size_bytes,directStorage:true} });
				return json({ok:true,item:result.data});
			}
			throw Object.assign(new Error('Unknown upload action'), { status:400 });
		}

		if (parts[0] === 'upload') {
			const target = normalizePath(url.searchParams.get('path') ?? 'upload.bin');
			await requireCapability(user, workspace.id, dirname(target), 'create');
			const buffer = Buffer.from(await request.arrayBuffer());
			const mimeType = request.headers.get('content-type') || 'application/octet-stream';
			const item = await writeFileBytes({ workspaceId: workspace.id, path: target, bytes: buffer, mimeType, userId: user.id, preferText: textMime(mimeType) });
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.upload', targetType: 'file', targetId: item.id, detail: { path: target, size: buffer.length } });
			return json({ ok: true, item });
		}

		if (parts[0] === 'upload-zip-extract') {
			const destination = normalizePath(url.searchParams.get('path') ?? '');
			await requireCapability(user, workspace.id, destination, 'create');
			const archive = await JSZip.loadAsync(Buffer.from(await request.arrayBuffer()));
			for (const [rawName, zipEntry] of Object.entries(archive.files)) {
				const safeName = normalizePath(rawName);
				if (!safeName) continue;
				const target = [destination, safeName].filter(Boolean).join('/');
				if (zipEntry.dir) await createFolder(workspace.id, target, user.id);
				else {
					const bytes = Buffer.from(await zipEntry.async('uint8array'));
					await writeFileBytes({ workspaceId: workspace.id, path: target, bytes, mimeType: 'application/octet-stream', userId: user.id });
				}
			}
			return json({ ok: true });
		}

		if (parts[0] === 'share') {
			const body = await request.json().catch(() => ({}));
			const subpath = normalizePath(body.path);
			if (!subpath || protectedWorkspacePath(subpath)) throw Object.assign(new Error('System folders cannot be shared'), { status: 403 });
			await requireCapability(user, workspace.id, subpath, 'share');
			const entry = await findEntry(workspace.id, subpath);
			if (!entry) throw Object.assign(new Error('Only files and folders can be shared'), { status: 400 });
			const days = Math.min(30, Math.max(1, Math.round(Number(body.days) || 7)));
			const token = randomBytes(32).toString('base64url');
			const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
			const tokenHash = createHash('sha256').update(token).digest('hex');
			const { data: share, error } = await supabase.from('orbitfs_shares').insert({ token_hash: tokenHash, workspace_id: workspace.id, file_id: entry.id, path: subpath, kind: entry.kind, created_by: user.id, expires_at: expiresAt }).select('id').single();
			if (error) throw error;
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.share', targetType: entry.kind, targetId: entry.id, detail: { path: subpath, days } });
			return json({ id: share.id, url: `${url.origin}/api/public-shares/${token}`, expiresAt });
		}

		if (parts[0] === 'notifications' && parts[1] && parts[2] === 'read') {
			const { error } = await supabase.from('orbitfs_notifications').update({ read_at: new Date().toISOString() }).eq('id', parts[1]).or(`user_id.eq.${user.id},user_id.is.null`);
			if (error) throw error;
			return json({ ok: true });
		}

		throw Object.assign(new Error('Not found'), { status: 404 });
	} catch (error) {
		return apiError(error);
	}
}

export async function PUT({ params, request, cookies, url }) {
	try {
		const path = String(params.path || '');
		const parts = path.split('/').filter(Boolean);
		const { user, workspace, supabase } = await context(request, cookies);
		if (parts[0] === 'path-permissions') {
			const body = await request.json().catch(() => ({}));
			const subpath = normalizePath(body.path ?? '');
			const role = String(body.role ?? '');
			if (!PERMISSION_ROLES.includes(role as any)) throw Object.assign(new Error('Invalid workspace role'), { status: 400 });
			await requireCapability(user, workspace.id, subpath, 'manage');
			const values = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
			await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id', workspace.id).eq('path_prefix', subpath).eq('principal_type', 'role').eq('principal_id', role);
			const { error } = await supabase.from('orbitfs_file_permissions').insert({ workspace_id: workspace.id, path_prefix: subpath, principal_type: 'role', principal_id: role, can_view: values.read === true, can_edit: values.write === true, can_download: values.download === true, can_move: values.move === true, can_delete: values.delete === true, can_create: values.create === true, can_share: values.share === true, can_manage_permissions: false, inherit: true });
			if (error) throw error;
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'permissions.update', targetType: 'path', targetId: null, detail: { path: subpath, role } });
			return json({ ok: true });
		}
		if (parts[0] !== 'file' && parts[0] !== 'document') throw Object.assign(new Error('Not found'), { status: 404 });
		const body = await request.json().catch(() => ({}));
		const subpath = normalizePath(body.path ?? url.searchParams.get('path') ?? 'untitled.txt');
		await requireCapability(user, workspace.id, subpath, 'write');
		if (parts[0] === 'document') {
			if (!subpath.toLowerCase().endsWith('.docx')) throw Object.assign(new Error('Document editor currently supports DOCX files only'), { status: 415 });
			const text = String(body.text ?? '');
			const paragraphs = text.replace(/\r\n/g, '\n').split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }));
			const document = new Document({ sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }] });
			const bytes = Buffer.from(await Packer.toBuffer(document));
			const item = await writeFileBytes({ workspaceId: workspace.id, path: subpath, bytes, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', userId: user.id });
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'document.write', targetType: 'file', targetId: item.id, detail: { path: subpath } });
			return json({ ok: true, size: bytes.length });
		}
		const content = String(body.content ?? '');
		const item = await writeFileBytes({ workspaceId: workspace.id, path: subpath, bytes: Buffer.from(content, 'utf8'), mimeType: 'text/plain; charset=utf-8', userId: user.id, preferText: true });
		await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'file.write', targetType: 'file', targetId: item.id, detail: { path: subpath } });
		return json({ ok: true });
	} catch (error) {
		return apiError(error);
	}
}

export async function DELETE({ params, request, cookies, url }) {
	try {
		const path = String(params.path || '');
		const parts = path.split('/').filter(Boolean);
		const { user, supabase, workspace } = await context(request, cookies);
		if (parts[0] === 'path-permissions') {
			const subpath = normalizePath(url.searchParams.get('path') ?? '');
			const role = String(url.searchParams.get('role') ?? '');
			if (!PERMISSION_ROLES.includes(role as any)) throw Object.assign(new Error('Invalid workspace role'), { status: 400 });
			await requireCapability(user, workspace.id, subpath, 'manage');
			const deletion = await supabase.from('orbitfs_file_permissions').delete().eq('workspace_id', workspace.id).eq('path_prefix', subpath).eq('principal_type', 'role').eq('principal_id', role);
			if (deletion.error) throw deletion.error;
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'permissions.reset', targetType: 'path', targetId: null, detail: { path: subpath, role } });
			return json({ ok: true });
		}
		if (parts[0] === 'workspaces' && parts[1] && parts[2] === 'trash') {
			if (workspace.id !== parts[1]) throw Object.assign(new Error('Select the workspace before emptying its trash'), { status: 409 });
			await requireCapability(user, workspace.id, '_trash', 'delete');
			const children = await listEntries(workspace.id, '_trash');
			for (const child of children) await purgeEntry(workspace.id, `_trash/${child.name}`);
			await writeAudit({ actorUserId: user.id, workspaceId: workspace.id, action: 'trash.empty', targetType: 'workspace', targetId: workspace.id, detail: { count: children.length } });
			return json({ ok: true, purged: children.length });
		}
		if (parts[0] === 'share' && parts[1]) {
			const { data: share } = await supabase.from('orbitfs_shares').select('*').eq('id', parts[1]).maybeSingle();
			if (!share) throw Object.assign(new Error('Share link not found'), { status: 404 });
			if (!['owner', 'admin'].includes(user.role) && share.created_by !== user.id) throw Object.assign(new Error('Share link access denied'), { status: 403 });
			const deletion = await supabase.from('orbitfs_shares').delete().eq('id', share.id);
			if (deletion.error) throw deletion.error;
			return json({ ok: true });
		}
		if (parts[0] === 'notifications' && parts[1]) {
			const deletion = await supabase.from('orbitfs_notifications').delete().eq('id', parts[1]).or(`user_id.eq.${user.id},user_id.is.null`);
			if (deletion.error) throw deletion.error;
			return json({ ok: true });
		}
		throw Object.assign(new Error('Not found'), { status: 404 });
	} catch (error) {
		return apiError(error);
	}
}
