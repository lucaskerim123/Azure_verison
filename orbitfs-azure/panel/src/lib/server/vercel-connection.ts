import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';

const API = 'https://api.vercel.com';
const SETTING_KEY = 'vercel.connection';
const AAD = Buffer.from('orbitfs-vercel-connection-v1');

type StoredConnection = {
	version: 1;
	ciphertext: string;
	iv: string;
	tag: string;
	teamId: string | null;
	accountId: string | null;
	accountName: string | null;
	connectedAt: string;
	validatedAt: string;
};

function fail(message: string, status = 500, code = 'VERCEL_CONNECTION_FAILED') {
	return Object.assign(new Error(message), { status, code });
}

function encryptionKey() {
	const secret = String(env.ORBITFS_DB_SECRET || '').trim();
	if (!secret) throw fail('OrbitFS database secret is required to store the Vercel connection securely.', 503, 'DB_SECRET_REQUIRED');
	return createHash('sha256').update(`orbitfs:vercel:${secret}`).digest();
}

function encryptToken(token: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
	cipher.setAAD(AAD);
	const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
	return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decryptToken(stored: StoredConnection) {
	try {
		const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(stored.iv, 'base64'));
		decipher.setAAD(AAD);
		decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8');
	} catch {
		throw fail('Stored Vercel credentials could not be decrypted. Reconnect Vercel.', 409, 'VERCEL_RECONNECT_REQUIRED');
	}
}

async function readStored(): Promise<StoredConnection | null> {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').select('value').eq('scope_type', 'global').eq('scope_id', '').eq('key', SETTING_KEY).maybeSingle();
	if (result.error) throw result.error;
	const value = result.data?.value;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const stored = value as StoredConnection;
	if (stored.version !== 1 || !stored.ciphertext || !stored.iv || !stored.tag) return null;
	return stored;
}

async function vercelJson(path: string, token: string) {
	const response = await fetch(`${API}${path}`, {
		headers: { authorization: `Bearer ${token}` },
		cache: 'no-store',
		signal: AbortSignal.timeout(15_000)
	});
	const body: any = await response.json().catch(() => ({}));
	if (!response.ok) throw fail(String(body?.error?.message || body?.message || `Vercel returned ${response.status}`), response.status === 401 ? 401 : 400, 'VERCEL_TOKEN_INVALID');
	return body;
}

export async function validateVercelConnection(tokenInput: unknown, teamIdInput?: unknown) {
	const token = String(tokenInput || '').trim();
	if (!token) throw fail('Enter a Vercel API token.', 400, 'VERCEL_TOKEN_REQUIRED');
	const userBody = await vercelJson('/v2/user', token);
	const user = userBody?.user || userBody;
	const accountId = String(user?.id || user?.uid || '').trim() || null;
	const accountName = String(user?.username || user?.name || user?.email || '').trim() || 'Vercel account';
	const requestedTeamId = String(teamIdInput || '').trim();
	let teamId: string | null = null;
	let teamName: string | null = null;
	if (requestedTeamId) {
		const teamsBody = await vercelJson('/v2/teams?limit=100', token);
		const teams = Array.isArray(teamsBody?.teams) ? teamsBody.teams : [];
		const team = teams.find((item: any) => String(item?.id || '') === requestedTeamId || String(item?.slug || '') === requestedTeamId);
		if (!team) throw fail('That Vercel team is not available to this token.', 400, 'VERCEL_TEAM_INVALID');
		teamId = String(team.id || '').trim() || null;
		teamName = String(team.name || team.slug || '').trim() || null;
	}
	return { token, teamId, accountId, accountName, teamName };
}

export async function saveVercelConnection(tokenInput: unknown, teamIdInput?: unknown) {
	const validated = await validateVercelConnection(tokenInput, teamIdInput);
	const encrypted = encryptToken(validated.token);
	const stamp = new Date().toISOString();
	const stored: StoredConnection = {
		version: 1,
		...encrypted,
		teamId: validated.teamId,
		accountId: validated.accountId,
		accountName: validated.teamName || validated.accountName,
		connectedAt: stamp,
		validatedAt: stamp
	};
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').upsert({ scope_type: 'global', scope_id: '', key: SETTING_KEY, value: stored, updated_at: stamp }, { onConflict: 'scope_type,scope_id,key' });
	if (result.error) throw result.error;
	return { connected: true, teamId: stored.teamId, accountId: stored.accountId, accountName: stored.accountName, connectedAt: stored.connectedAt, validatedAt: stored.validatedAt };
}

export async function getVercelConnectionSummary() {
	const stored = await readStored();
	if (!stored) return { connected: false, teamId: null, accountId: null, accountName: null, connectedAt: null, validatedAt: null };
	return { connected: true, teamId: stored.teamId, accountId: stored.accountId, accountName: stored.accountName, connectedAt: stored.connectedAt, validatedAt: stored.validatedAt };
}

export async function getVercelCredentials() {
	const stored = await readStored();
	if (!stored) return null;
	return { token: decryptToken(stored), teamId: stored.teamId };
}

export async function deleteVercelConnection() {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').delete().eq('scope_type', 'global').eq('scope_id', '').eq('key', SETTING_KEY);
	if (result.error) throw result.error;
	return { connected: false };
}
