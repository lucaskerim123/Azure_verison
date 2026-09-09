import { createHash } from 'node:crypto';
import { assertPanelLicensed } from '$lib/server/license';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { basename, dirname, findEntry, listEntries, normalizePath, readEntryBytes } from '$lib/server/base-compat';

function escapeHtml(value: unknown) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

async function fileResponse(entry: any) {
	const bytes = await readEntryBytes(entry);
	return new Response(Uint8Array.from(bytes).buffer, {
		headers: {
			'content-type': entry.mime_type || 'application/octet-stream',
			'content-disposition': `attachment; filename="${String(entry.name || 'download').replace(/[\r\n"]/g, '')}"`,
			'content-length': String(bytes.length),
			'cache-control': 'private, no-store'
		}
	});
}

export async function GET({ params, url }) {
	try {
		await assertPanelLicensed();
		const token = String(params.token || '');
		const tokenHash = createHash('sha256').update(token).digest('hex');
		const supabase = getSupabaseAdmin();
		const { data: share, error } = await supabase
			.from('orbitfs_shares')
			.select('*')
			.eq('token_hash', tokenHash)
			.gt('expires_at', new Date().toISOString())
			.maybeSingle();
		if (error) throw error;
		if (!share) return new Response('Share link is invalid or expired', { status: 404 });
		const { data: workspace } = await supabase.from('orbitfs_workspaces').select('status').eq('id', share.workspace_id).maybeSingle();
		if (!workspace || workspace.status !== 'active') return new Response('Shared workspace is unavailable', { status: 423 });

		const sharedRoot = normalizePath(share.path);
		const rootEntry = await findEntry(share.workspace_id, sharedRoot);
		if (!rootEntry) return new Response('Shared item not found', { status: 404 });
		if (rootEntry.kind === 'file') return fileResponse(rootEntry);
		if (rootEntry.kind !== 'folder') return new Response('Shared item is unavailable', { status: 404 });

		const relative = normalizePath(url.searchParams.get('path') ?? '');
		const targetPath = [sharedRoot, relative].filter(Boolean).join('/');
		if (!(targetPath === sharedRoot || targetPath.startsWith(`${sharedRoot}/`))) return new Response('Shared item not found', { status: 404 });
		const target = await findEntry(share.workspace_id, targetPath);
		if (!target) return new Response('Shared item not found', { status: 404 });
		if (target.kind === 'file') return fileResponse(target);
		const entries = await listEntries(share.workspace_id, targetPath);
		const parent = relative.split('/').filter(Boolean).slice(0, -1).join('/');
		const rows = entries
			.sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name))
			.map((entry) => {
				const child = [relative, entry.name].filter(Boolean).join('/');
				return `<li><a href="?path=${encodeURIComponent(child)}">${entry.type === 'dir' ? '&#128193;' : '&#128196;'} ${escapeHtml(entry.name)}</a></li>`;
			})
			.join('');
		const up = relative ? `<li><a href="?path=${encodeURIComponent(parent)}">&#8592; Parent folder</a></li>` : '';
		const title = escapeHtml(basename(sharedRoot));
		return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;background:#0b0b0e;color:#f5f5f5;max-width:850px;margin:40px auto;padding:0 20px}a{color:#8ab4ff;text-decoration:none}a:hover{text-decoration:underline}li{padding:10px 0;border-bottom:1px solid #25252b}ul{list-style:none;padding:0}</style><h1>${title}</h1><p>Shared OrbitFS folder</p><ul>${up}${rows}</ul>`, {
			headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }
		});
	} catch (error: any) {
		return new Response(String(error?.message || 'Request failed'), { status: Number(error?.status || 500) });
	}
}
