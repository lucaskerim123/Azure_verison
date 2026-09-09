import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { ensureInstallationIdentity } from '$lib/server/license';

export type SharedEngineHostStateName =
	| 'not_deployed'
	| 'provisioning'
	| 'deployed'
	| 'linking'
	| 'linked'
	| 'ready'
	| 'error';

export type SharedEngineHostState = {
	version: 1;
	state: SharedEngineHostStateName;
	provider: 'vercel';
	installationId: string;
	panelUrl: string | null;
	hostUrl: string | null;
	projectId: string | null;
	projectName: string | null;
	deploymentId: string | null;
	deploymentUrl: string | null;
	distribution: 'orbitfs-store-package-v1' | 'orbitfs-git-dev-v1' | null;
	releaseVersion: string | null;
	releaseId: string | null;
	releaseSha256: string | null;
	releaseSourceCommit: string | null;
	releaseFileCount: number | null;
	linkedAt: string | null;
	linkedByUserId: string | null;
	lastSyncAt: string | null;
	lastHealthAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
};

const SETTING_KEY = 'engine_host.shared';
const STATE_CACHE_MS = 10_000;
const now = () => new Date().toISOString();
let stateCache: { value: SharedEngineHostState; expiresAt: number } | null = null;
let statePromise: Promise<SharedEngineHostState> | null = null;

function objectValue(value: unknown): Record<string, any> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function normalizePublicHttpsUrl(value: unknown, label = 'URL') {
	try {
		const parsed = new URL(String(value || '').trim());
		const host = parsed.hostname.toLowerCase();
		if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
		if (['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error();
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		throw Object.assign(new Error(`${label} must be a public HTTPS URL`), { status: 400, code: 'PUBLIC_URL_REQUIRED' });
	}
}

export function configuredEngineHostUrl() {
	const explicit = String(env.ORBITFS_ENGINE_HOST_URL || '').trim();
	if (explicit) return normalizePublicHttpsUrl(explicit, 'Engine Host URL');
	return null;
}

export function configuredPanelUrl() {
	const explicit = String(env.ORBITFS_PANEL_URL || '').trim();
	if (explicit) return normalizePublicHttpsUrl(explicit, 'Panel URL');
	const vercelHost = String(env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '').trim();
	if (vercelHost) return normalizePublicHttpsUrl(vercelHost.startsWith('http') ? vercelHost : `https://${vercelHost}`, 'Panel URL');
	return 'https://orbitfs.vercel.app';
}

function baseState(installationId: string): SharedEngineHostState {
	const stamp = now();
	const configured = configuredEngineHostUrl();
	return {
		version: 1,
		state: configured ? 'deployed' : 'not_deployed',
		provider: 'vercel',
		installationId,
		panelUrl: configuredPanelUrl(),
		hostUrl: configured,
		projectId: null,
		projectName: null,
		deploymentId: null,
		deploymentUrl: null,
		distribution: null,
		releaseVersion: null,
		releaseId: null,
		releaseSha256: null,
		releaseSourceCommit: null,
		releaseFileCount: null,
		linkedAt: null,
		linkedByUserId: null,
		lastSyncAt: null,
		lastHealthAt: null,
		lastError: null,
		createdAt: stamp,
		updatedAt: stamp
	};
}

async function computeSharedEngineHostState(): Promise<SharedEngineHostState> {
	const installationId = await ensureInstallationIdentity();
	const db = getSupabaseAdmin();
	const result = await db
		.from('orbitfs_settings')
		.select('value')
		.eq('scope_type', 'global')
		.eq('scope_id', '')
		.eq('key', SETTING_KEY)
		.maybeSingle();
	if (result.error) throw result.error;
	const fallback = baseState(installationId);
	const stored = objectValue(result.data?.value);
	if (!Object.keys(stored).length) return fallback;
	const storedInstallation = String(stored.installationId || '').trim();
	if (storedInstallation && storedInstallation !== installationId) {
		throw Object.assign(new Error('Stored Shared Engine Host state belongs to another OrbitFS installation.'), { status: 409, code: 'ENGINE_HOST_INSTALLATION_MISMATCH' });
	}
	const validStates: SharedEngineHostStateName[] = ['not_deployed','provisioning','deployed','linking','linked','ready','error'];
	const state = validStates.includes(stored.state) ? stored.state as SharedEngineHostStateName : fallback.state;
	return {
		...fallback,
		...stored,
		version: 1,
		provider: 'vercel',
		installationId,
		state,
		panelUrl: stored.panelUrl ? normalizePublicHttpsUrl(stored.panelUrl, 'Panel URL') : fallback.panelUrl,
		hostUrl: stored.hostUrl ? normalizePublicHttpsUrl(stored.hostUrl, 'Engine Host URL') : fallback.hostUrl
	};
}

export async function getSharedEngineHostState(force = false): Promise<SharedEngineHostState> {
	if (!force && stateCache && stateCache.expiresAt > Date.now()) return stateCache.value;
	if (!force && statePromise) return statePromise;
	const promise = computeSharedEngineHostState();
	if (!force) statePromise = promise;
	try {
		const value = await promise;
		stateCache = { value, expiresAt: Date.now() + STATE_CACHE_MS };
		return value;
	} finally {
		if (!force) statePromise = null;
	}
}

export async function saveSharedEngineHostState(patch: Partial<SharedEngineHostState>, knownCurrent?: SharedEngineHostState) {
	const current = knownCurrent || await getSharedEngineHostState();
	const stamp = now();
	const next: SharedEngineHostState = {
		...current,
		...patch,
		version: 1,
		provider: 'vercel',
		installationId: current.installationId,
		panelUrl: patch.panelUrl ? normalizePublicHttpsUrl(patch.panelUrl, 'Panel URL') : current.panelUrl,
		hostUrl: patch.hostUrl ? normalizePublicHttpsUrl(patch.hostUrl, 'Engine Host URL') : current.hostUrl,
		createdAt: current.createdAt || stamp,
		updatedAt: stamp
	};
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').upsert({
		scope_type: 'global',
		scope_id: '',
		key: SETTING_KEY,
		value: next,
		updated_at: stamp
	}, { onConflict: 'scope_type,scope_id,key' });
	if (result.error) throw result.error;
	stateCache = { value: next, expiresAt: Date.now() + STATE_CACHE_MS };
	return next;
}

export async function assertSharedEngineHostReady() {
	const state = await getSharedEngineHostState();
	if (!state.hostUrl) {
		throw Object.assign(new Error('Deploy the Shared Engine Host before attaching an engine.'), { status: 409, code: 'ENGINE_HOST_NOT_DEPLOYED' });
	}
	if (!['linked','ready'].includes(state.state)) {
		throw Object.assign(new Error('Link the Shared Engine Host to this OrbitFS Panel before attaching an engine.'), { status: 409, code: 'ENGINE_HOST_NOT_LINKED' });
	}
	return state;
}

export async function resolvedSharedEngineHostUrl() {
	const state = await getSharedEngineHostState();
	if (state.hostUrl) return state.hostUrl;
	const configured = configuredEngineHostUrl();
	if (configured) return configured;
	throw Object.assign(new Error('Shared Engine Host has not been deployed for this OrbitFS installation.'), { status: 409, code: 'ENGINE_HOST_NOT_DEPLOYED' });
}
