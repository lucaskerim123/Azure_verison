import { randomUUID, verify } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';

export const PANEL_COMPONENT = 'orbitfs_base';
export const STABLE_LICENSE_COMPONENTS = ['orbitfs_base', 'orbitfs_mcp', 'orbitfs_apex', 'orbitfs_studio'] as const;

const LICENSE_ID = 'primary';
const MASTER_PROVIDER = 'https://orbitfsstore.vercel.app/api/license/v1';
const LICENSE_PROVIDER_SETTING_KEY = 'license_provider';
const ALLOWED_ENTITLEMENT_ISSUERS = new Set(['orbitfs-website']);
const ROW_CACHE_MS = 10_000;
const SUMMARY_CACHE_MS = 5_000;

export const LICENSE_SYSTEMS = [
	{
		id: 'orbitfs_official_v1',
		name: 'OrbitFS Official Licensing',
		description: 'Master OrbitFS customer licensing service',
		providerBase: MASTER_PROVIDER
	}
] as const;

export const ALLOWED_LICENSE_API_BASES = [MASTER_PROVIDER] as const;

type LicenseRow = {
	id: string;
	license_key: string | null;
	status: string;
	plan: string | null;
	licensed_to: string | null;
	expires_at: string | null;
	metadata: Record<string, unknown> | null;
};

type EntitlementPayload = Record<string, any> & {
	iss?: string;
	aud?: string;
	exp?: number;
	installationId?: string;
	valid?: boolean;
	components?: Record<string, any>;
};

export type PanelLicenseSummary = {
	valid: boolean;
	licensed: boolean;
	enforcement: true;
	reason: string | null;
	status: string;
	keyHint: string | null;
	installationId: string;
	lastCheckedAt: string | null;
	lastRevisionCheckedAt: null;
	masterRevision: null;
	nextValidationAt: string | null;
	nextRevisionCheckAt: null;
	offlineGrace: false;
	refreshError: string | null;
	component: Record<string, any>;
	components: Record<string, any>;
	plan: string | null;
	licensedTo: string | null;
	expiresAt: string | null;
};

const nowIso = () => new Date().toISOString();
const validationMs = () => Math.max(60_000, Number(env.ORBITFS_LICENSE_REFRESH_MINUTES || 30) * 60_000);
const timeoutMs = () => Math.max(1000, Number(env.ORBITFS_LICENSE_TIMEOUT_MS || 8000));
const keyHint = (value: string) => (value.length > 4 ? `****${value.slice(-4)}` : '****');
const timeMs = (value: unknown) => (typeof value === 'string' && value ? new Date(value).getTime() : 0);
const nextIso = (value: unknown, interval: number) => {
	const base = timeMs(value);
	return base ? new Date(base + interval).toISOString() : null;
};

let rowCache: { value: LicenseRow | null; expiresAt: number } | null = null;
let rowReadPromise: Promise<LicenseRow | null> | null = null;
let summaryCache: { value: PanelLicenseSummary; expiresAt: number } | null = null;
let summaryPromise: Promise<PanelLicenseSummary> | null = null;
let memoryPublicKey: string | null = null;

function invalidateSummaryCache() {
	summaryCache = null;
}

function cacheRow(row: LicenseRow | null) {
	rowCache = { value: row, expiresAt: Date.now() + ROW_CACHE_MS };
	return row;
}

function normalizeProviderBase(value: string) {
	try {
		const parsed = new URL(String(value || '').trim());
		if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
		return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
	} catch {
		throw Object.assign(new Error('Licence API must be a public HTTPS URL'), { code: 'LICENSE_PROVIDER_INVALID', status: 400 });
	}
}

function canonicalLicenseMetadata(metadata: Record<string, any>, patch: Record<string, any> = {}) {
	const next: Record<string, any> = {};
	for (const key of ['installationId', 'installationCreatedAt', 'entitlement', 'keyHint', 'lastCheckedAt']) {
		const value = patch[key] !== undefined ? patch[key] : metadata[key];
		if (value !== undefined && value !== null && value !== '') next[key] = value;
	}
	return next;
}

async function getRow(force = false): Promise<LicenseRow | null> {
	if (!force && rowCache && rowCache.expiresAt > Date.now()) return rowCache.value;
	if (!force && rowReadPromise) return rowReadPromise;
	const read = (async () => {
		const supabase = getSupabaseAdmin();
		const { data, error } = await supabase
			.from('orbitfs_license')
			.select('id,license_key,status,plan,licensed_to,expires_at,metadata')
			.eq('id', LICENSE_ID)
			.maybeSingle();
		if (error) throw error;
		return cacheRow(data as LicenseRow | null);
	})();
	if (!force) rowReadPromise = read;
	try {
		return await read;
	} finally {
		if (!force) rowReadPromise = null;
	}
}

async function saveRow(patch: Record<string, unknown>, knownRow?: LicenseRow | null) {
	const supabase = getSupabaseAdmin();
	const row = knownRow === undefined ? await getRow() : knownRow;
	const stamp = nowIso();
	const payload = { ...patch, updated_at: stamp };
	if (row) {
		const result = await supabase.from('orbitfs_license').update(payload).eq('id', LICENSE_ID);
		if (result.error) throw result.error;
		cacheRow({ ...row, ...patch, id: LICENSE_ID } as LicenseRow);
	} else {
		const inserted = { id: LICENSE_ID, status: 'unconfigured', metadata: {}, ...patch, updated_at: stamp };
		const result = await supabase.from('orbitfs_license').insert(inserted);
		if (result.error) throw result.error;
		cacheRow(inserted as LicenseRow);
	}
	invalidateSummaryCache();
	return rowCache?.value ?? null;
}

async function readStoredPublicKey() {
	const supabase = getSupabaseAdmin();
	const result = await supabase
		.from('orbitfs_settings')
		.select('value')
		.eq('scope_type', 'global')
		.eq('scope_id', '')
		.eq('key', LICENSE_PROVIDER_SETTING_KEY)
		.maybeSingle();
	if (result.error) throw result.error;
	const stored = result.data?.value && typeof result.data.value === 'object' ? (result.data.value as Record<string, any>) : {};
	if (stored.providerBase !== MASTER_PROVIDER) return null;
	return typeof stored.publicKey === 'string' && stored.publicKey.includes('BEGIN PUBLIC KEY') ? stored.publicKey : null;
}

async function savePublicKey(publicKey: string) {
	const supabase = getSupabaseAdmin();
	const result = await supabase.from('orbitfs_settings').upsert(
		{
			scope_type: 'global',
			scope_id: '',
			key: LICENSE_PROVIDER_SETTING_KEY,
			value: { providerBase: MASTER_PROVIDER, publicKey, publicKeyUpdatedAt: nowIso() }
		},
		{ onConflict: 'scope_type,scope_id,key' }
	);
	if (result.error) throw result.error;
}

async function fetchMasterPublicKey(force = false) {
	if (!force) {
		const configured = String(env.ORBITFS_ENTITLEMENT_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
		if (configured) return configured;
		if (memoryPublicKey) return memoryPublicKey;
		const stored = await readStoredPublicKey();
		if (stored) {
			memoryPublicKey = stored;
			return stored;
		}
	}
	const response = await fetch(`${MASTER_PROVIDER}/public-key`, {
		cache: 'no-store',
		signal: AbortSignal.timeout(timeoutMs())
	});
	const publicKey = (await response.text()).trim();
	if (!response.ok || !publicKey.includes('BEGIN PUBLIC KEY')) {
		throw Object.assign(new Error(`Licence public key endpoint returned ${response.status}`), {
			code: 'LICENSE_PUBLIC_KEY_UNAVAILABLE',
			status: 503
		});
	}
	memoryPublicKey = publicKey;
	await savePublicKey(publicKey);
	return publicKey;
}

async function verifyEntitlement(token: string, installationId: string): Promise<EntitlementPayload> {
	const parts = String(token || '').split('.');
	if (parts.length !== 3) throw Object.assign(new Error('Invalid signed entitlement'), { code: 'LICENSE_SIGNATURE_INVALID' });
	const [headerPart, payloadPart, signaturePart] = parts;
	const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
	if (header.alg !== 'RS256') throw Object.assign(new Error('Unsupported entitlement algorithm'), { code: 'LICENSE_SIGNATURE_INVALID' });
	const signed = Buffer.from(`${headerPart}.${payloadPart}`);
	const signature = Buffer.from(signaturePart, 'base64url');
	let verified = verify('RSA-SHA256', signed, await fetchMasterPublicKey(false), signature);
	if (!verified) verified = verify('RSA-SHA256', signed, await fetchMasterPublicKey(true), signature);
	if (!verified) throw Object.assign(new Error('Entitlement signature check failed'), { code: 'LICENSE_SIGNATURE_INVALID' });

	const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as EntitlementPayload;
	const current = Math.floor(Date.now() / 1000);
	if (!ALLOWED_ENTITLEMENT_ISSUERS.has(String(payload.iss || '')) || payload.aud !== 'orbitfs-runtime' || !payload.exp || current > payload.exp) {
		throw Object.assign(new Error('Signed entitlement expired or invalid'), { code: 'LICENSE_ENTITLEMENT_EXPIRED' });
	}
	if (payload.installationId !== installationId) {
		throw Object.assign(new Error('Entitlement belongs to another installation identity'), { code: 'LICENSE_INSTALLATION_MISMATCH' });
	}
	return payload;
}

function panelComponent(payload: EntitlementPayload) {
	return payload.components?.[PANEL_COMPONENT] || { state: 'blocked', allowed: false, reason: 'not_included' };
}

export function componentLicensed(component: Record<string, any>) {
	return ['enabled', 'active', 'locked'].includes(String(component?.state || '')) && component?.allowed === true;
}

function summaryFromPayload(payload: EntitlementPayload, row: LicenseRow | null, extra: Partial<PanelLicenseSummary> = {}): PanelLicenseSummary {
	const component = panelComponent(payload);
	const licensed = payload.valid === true && componentLicensed(component);
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const lastCheckedAt = typeof metadata.lastCheckedAt === 'string' ? metadata.lastCheckedAt : null;
	return {
		valid: payload.valid === true,
		licensed,
		enforcement: true,
		reason: licensed ? null : String(component.reason || payload.reason || 'LICENSE_REQUIRED'),
		status: licensed ? 'active' : 'invalid',
		keyHint: typeof metadata.keyHint === 'string' ? metadata.keyHint : null,
		installationId: String(payload.installationId || metadata.installationId || ''),
		lastCheckedAt,
		lastRevisionCheckedAt: null,
		masterRevision: null,
		nextValidationAt: nextIso(lastCheckedAt, validationMs()),
		nextRevisionCheckAt: null,
		offlineGrace: false,
		refreshError: null,
		component,
		components: payload.components && typeof payload.components === 'object' ? payload.components : { [PANEL_COMPONENT]: component },
		plan: String(payload.plan || payload.tier || row?.plan || '') || null,
		licensedTo: String(payload.licensedTo || payload.customerName || payload.sub || row?.licensed_to || '') || null,
		expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : row?.expires_at || null,
		...extra
	};
}

function unlicensedSummary(installationId: string, row: LicenseRow | null, reason: string, refreshError: string | null = null): PanelLicenseSummary {
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const lastCheckedAt = typeof metadata.lastCheckedAt === 'string' ? metadata.lastCheckedAt : null;
	return {
		valid: false,
		licensed: false,
		enforcement: true,
		reason,
		status: row?.status || 'unconfigured',
		keyHint: typeof metadata.keyHint === 'string' ? metadata.keyHint : null,
		installationId,
		lastCheckedAt,
		lastRevisionCheckedAt: null,
		masterRevision: null,
		nextValidationAt: nextIso(lastCheckedAt, validationMs()),
		nextRevisionCheckAt: null,
		offlineGrace: false,
		refreshError,
		component: { state: 'blocked', allowed: false, reason },
		components: { [PANEL_COMPONENT]: { state: 'blocked', allowed: false, reason } },
		plan: row?.plan || null,
		licensedTo: row?.licensed_to || null,
		expiresAt: row?.expires_at || null
	};
}

async function installationIdentityFromRow(row: LicenseRow | null) {
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	if (typeof metadata.installationId === 'string' && metadata.installationId) return { installationId: metadata.installationId, row };
	const installationId = `ofs-${randomUUID()}`;
	const saved = await saveRow({ metadata: canonicalLicenseMetadata(metadata, { installationId, installationCreatedAt: nowIso() }) }, row);
	return { installationId, row: saved };
}

export async function ensureInstallationIdentity() {
	const result = await installationIdentityFromRow(await getRow());
	return result.installationId;
}

function requestHeaders() {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const token = String(env.ORBITFS_LICENSE_API_TOKEN || '').trim();
	if (token) headers.authorization = `Bearer ${token}`;
	return headers;
}

async function providerRequest(path: string, init: RequestInit = {}) {
	return fetch(`${MASTER_PROVIDER}${path}`, {
		...init,
		headers: { ...requestHeaders(), ...(init.headers || {}) },
		cache: 'no-store',
		signal: AbortSignal.timeout(timeoutMs())
	});
}

async function callProvider(licenseKey: string, installationId: string, activate: boolean, components: string[] = [...STABLE_LICENSE_COMPONENTS]) {
	if (!licenseKey) throw Object.assign(new Error('Licence key is required'), { code: 'LICENSE_KEY_REQUIRED', status: 400 });
	const payload = { licenseKey, installationId, components, deviceName: 'OrbitFS Vercel', platform: 'vercel', appVersion: 'cloud' };
	if (activate) {
		const activation = await providerRequest('/activate', { method: 'POST', body: JSON.stringify(payload) });
		const activationBody = await activation.json().catch(() => ({}));
		if (!activation.ok) {
			throw Object.assign(new Error(activationBody.error || activationBody.message || `Licence activation returned ${activation.status}`), {
				code: activationBody.code || 'LICENSE_ACTIVATION_ERROR', status: activation.status < 500 ? activation.status : 503
			});
		}
	}
	const response = await providerRequest('/validate', { method: 'POST', body: JSON.stringify({ ...payload, activate: false }) });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw Object.assign(new Error(body.error || body.message || `Licence validation returned ${response.status}`), {
			code: body.code || 'LICENSE_PROVIDER_ERROR', status: response.status < 500 ? response.status : 503
		});
	}
	if (!body.entitlement) throw Object.assign(new Error('Licence API returned no signed entitlement'), { code: 'LICENSE_UNSIGNED_RESPONSE', status: 503 });
	return { payload: await verifyEntitlement(String(body.entitlement), installationId), entitlement: String(body.entitlement) };
}

async function persistEntitlement(licenseKey: string, payload: EntitlementPayload, entitlement: string, row: LicenseRow | null) {
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const component = panelComponent(payload);
	const licensed = payload.valid === true && componentLicensed(component);
	const checkedAt = nowIso();
	const saved = await saveRow({
		license_key: licenseKey,
		status: licensed ? 'active' : 'invalid',
		plan: String(payload.plan || payload.tier || '') || null,
		licensed_to: String(payload.licensedTo || payload.customerName || payload.sub || '') || null,
		expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
		metadata: canonicalLicenseMetadata(metadata, {
			installationId: payload.installationId, entitlement, keyHint: keyHint(licenseKey), lastCheckedAt: checkedAt
		})
	}, row);
	return summaryFromPayload(payload, saved);
}

async function clearRejectedLocalKey(row: LicenseRow | null, installationId: string, reason: string) {
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const saved = await saveRow({
		license_key: null, status: 'unconfigured', plan: null, licensed_to: null, expires_at: null,
		metadata: canonicalLicenseMetadata(metadata, { installationId, entitlement: null, keyHint: null, lastCheckedAt: nowIso() })
	}, row);
	return unlicensedSummary(installationId, saved, reason);
}

async function invalidateCachedEntitlement(row: LicenseRow | null, installationId: string, reason: string) {
	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const saved = await saveRow({
		status: 'invalid', expires_at: null,
		metadata: canonicalLicenseMetadata(metadata, { entitlement: null, lastCheckedAt: nowIso() })
	}, row);
	return unlicensedSummary(installationId, saved, reason);
}

function isMissingKeyFailure(error: any) {
	return Number(error?.status || 0) === 404 || String(error?.code || '') === 'LICENSE_NOT_FOUND';
}

function definitiveProviderFailure(error: any) {
	const status = Number(error?.status || 0);
	return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function computePanelLicenseSummary(options: { refresh?: boolean } = {}): Promise<PanelLicenseSummary> {
	const identity = await installationIdentityFromRow(await getRow(options.refresh === true));
	const installationId = identity.installationId;
	const row = identity.row;
	const licenseKey = String(row?.license_key || '').trim();
	if (!licenseKey) return unlicensedSummary(installationId, row, 'not_activated');

	const metadata = { ...(row?.metadata || {}) } as Record<string, any>;
	const cachedToken = typeof metadata.entitlement === 'string' ? metadata.entitlement : '';
	let cached: EntitlementPayload | null = null;
	let cacheError: string | null = null;
	if (cachedToken) {
		try { cached = await verifyEntitlement(cachedToken, installationId); }
		catch (error: any) { cacheError = String(error?.code || error?.message || 'cached_entitlement_invalid'); }
	}
	const validationDue = options.refresh === true || !cached || !timeMs(metadata.lastCheckedAt) || Date.now() - timeMs(metadata.lastCheckedAt) >= validationMs();
	if (validationDue) {
		try {
			const result = await callProvider(licenseKey, installationId, false, [...STABLE_LICENSE_COMPONENTS]);
			return await persistEntitlement(licenseKey, result.payload, result.entitlement, row);
		} catch (error: any) {
			if (isMissingKeyFailure(error)) {
				const cleared = await clearRejectedLocalKey(row, installationId, 'license_not_found');
				return { ...cleared, refreshError: String(error?.message || error) };
			}
			if (definitiveProviderFailure(error)) {
				const invalid = await invalidateCachedEntitlement(row, installationId, String(error?.code || 'license_invalid'));
				return { ...invalid, refreshError: String(error?.message || error) };
			}
			if (cached) return summaryFromPayload(cached, row, { refreshError: String(error?.message || error) });
			const invalid = await invalidateCachedEntitlement(row, installationId, cacheError || String(error?.code || 'provider_unavailable'));
			return { ...invalid, refreshError: String(error?.message || error) };
		}
	}
	if (cached) return summaryFromPayload(cached, row);
	return unlicensedSummary(installationId, row, cacheError || 'not_activated');
}

export async function getPanelLicenseSummary(options: { refresh?: boolean } = {}): Promise<PanelLicenseSummary> {
	if (options.refresh === true) {
		invalidateSummaryCache();
		return computePanelLicenseSummary(options);
	}
	if (summaryCache && summaryCache.expiresAt > Date.now()) return summaryCache.value;
	if (summaryPromise) return summaryPromise;
	summaryPromise = computePanelLicenseSummary(options);
	try {
		const value = await summaryPromise;
		summaryCache = { value, expiresAt: Date.now() + SUMMARY_CACHE_MS };
		return value;
	} finally {
		summaryPromise = null;
	}
}

export async function activatePanelLicense(licenseKey: string) {
	const identity = await installationIdentityFromRow(await getRow());
	const cleanKey = String(licenseKey || '').trim();
	const result = await callProvider(cleanKey, identity.installationId, true, [...STABLE_LICENSE_COMPONENTS]);
	const component = panelComponent(result.payload);
	if (!(result.payload.valid === true && componentLicensed(component))) {
		throw Object.assign(new Error('Licence does not include an active OrbitFS Base entitlement for this installation'), {
			code: component.reason || result.payload.reason || 'LICENSE_COMPONENT_DENIED', status: 403
		});
	}
	return persistEntitlement(cleanKey, result.payload, result.entitlement, identity.row);
}

export async function activateLicenseComponent(componentId: string) {
	const identity = await installationIdentityFromRow(await getRow());
	const licenseKey = String(identity.row?.license_key || '').trim();
	if (!licenseKey) throw Object.assign(new Error('Licence key is not activated'), { code: 'LICENSE_KEY_REQUIRED', status: 400 });
	const result = await callProvider(licenseKey, identity.installationId, true, [PANEL_COMPONENT, componentId]);
	const component = result.payload.components?.[componentId] || {};
	if (!(result.payload.valid === true && componentLicensed(component))) {
		throw Object.assign(new Error(`Licence does not include ${componentId} for this installation`), {
			code: component.reason || result.payload.reason || 'LICENSE_COMPONENT_DENIED', status: 403
		});
	}
	const summary = await persistEntitlement(licenseKey, result.payload, result.entitlement, identity.row);
	return { summary, component: summary.components?.[componentId] || component };
}

export async function clearPanelLicense() {
	const identity = await installationIdentityFromRow(await getRow());
	const metadata = { ...(identity.row?.metadata || {}) } as Record<string, any>;
	const saved = await saveRow({
		license_key: null, status: 'unconfigured', plan: null, licensed_to: null, expires_at: null,
		metadata: canonicalLicenseMetadata(metadata, { installationId: identity.installationId, entitlement: null, keyHint: null, lastCheckedAt: null })
	}, identity.row);
	return unlicensedSummary(identity.installationId, saved, 'not_activated');
}

export async function getLicenseProviderDiagnostics() {
	let row: LicenseRow | null = null;
	let database = { ok: false, error: null as string | null };
	try { row = await getRow(true); database = { ok: true, error: null }; }
	catch (error: any) { database = { ok: false, error: String(error?.message || error || 'Database unavailable') }; }
	let provider = { ok: false, status: null as number | null, revision: null as string | null, error: null as string | null };
	try {
		const response = await providerRequest('/health', { method: 'GET' });
		const payload = await response.json().catch(() => ({}));
		provider = { ok: response.ok, status: response.status, revision: null, error: response.ok ? null : String(payload?.error || payload?.message || `HTTP ${response.status}`) };
	} catch (error: any) {
		provider = { ok: false, status: null, revision: null, error: String(error?.message || error || 'Provider unreachable') };
	}
	return {
		providerBase: MASTER_PROVIDER, validatePath: '/validate', validateUrl: `${MASTER_PROVIDER}/validate`,
		allowedProviderBases: [...ALLOWED_LICENSE_API_BASES], recommendedProviderBases: [...ALLOWED_LICENSE_API_BASES],
		licenseSystems: LICENSE_SYSTEMS.map((system) => ({ ...system })), configurable: false, database, provider,
		configSource: 'official-master', storedKey: Boolean(row?.license_key)
	};
}

export async function getLicenseProviderSettings() {
	return {
		providerBase: MASTER_PROVIDER,
		publicKeyCached: Boolean(memoryPublicKey || await readStoredPublicKey()),
		publicKeyUpdatedAt: null,
		allowedProviderBases: [...ALLOWED_LICENSE_API_BASES],
		recommendedProviderBases: [...ALLOWED_LICENSE_API_BASES],
		licenseSystems: LICENSE_SYSTEMS.map((system) => ({ ...system })),
		configurable: false
	};
}

export async function setLicenseProviderBase(value: string) {
	if (normalizeProviderBase(value) !== MASTER_PROVIDER) {
		throw Object.assign(new Error('OrbitFS-Website is the fixed master licence service'), { code: 'LICENSE_PROVIDER_FIXED', status: 400 });
	}
	return getLicenseProviderSettings();
}

export async function assertPanelLicensed() {
	const summary = await getPanelLicenseSummary();
	if (summary.licensed) return summary;
	throw Object.assign(new Error('OrbitFS Base System licence is required'), { code: 'LICENSE_REQUIRED', status: 403, license: summary });
}
