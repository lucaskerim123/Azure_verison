import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { ensureInstallationIdentity } from '$lib/server/license';

const DEFAULT_PROVIDER = 'https://orbitfsstore.vercel.app/api/license/v1';
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 75 * 1024 * 1024;
const MAX_FILES = 2000;
const ENGINE_COMPONENTS = new Set(['apex', 'mcp', 'studio']);
export const SUPPORTED_ENGINE_DEPLOYER_PROTOCOL = 1;

export type EngineReleaseFile = {
	file: string;
	data: string;
	encoding: 'base64' | 'utf-8';
	size?: number;
};

export type EngineReleasePackage = {
	format: 'orbitfs-engine-release-v1';
	version: string;
	releaseId: string;
	sourceCommit: string | null;
	createdAt: string;
	components: string[];
	checkpointRequired: boolean;
	minimumEngineDeployerProtocol: number;
	projectSettings: {
		framework?: string;
		buildCommand?: string;
		installCommand?: string;
		outputDirectory?: string;
	};
	files: EngineReleaseFile[];
};

export type EngineReleaseDescriptor = {
	version: string;
	releaseId: string;
	sourceCommit: string | null;
	sha256: string;
	size: number;
	fileCount: number;
	downloadUrl: string;
	expiresIn: number;
	projectSettings: EngineReleasePackage['projectSettings'];
	components: string[];
	checkpointRequired: boolean;
	minimumEngineDeployerProtocol: number;
	distribution: 'orbitfs-store-package-v1';
};

function fail(message: string, status = 500, code = 'ENGINE_RELEASE_FAILED') {
	return Object.assign(new Error(message), { status, code });
}

function timeoutMs() {
	return Math.max(5_000, Number(env.ORBITFS_ENGINE_RELEASE_TIMEOUT_MS || 30_000));
}

function providerBase() {
	const raw = String(env.ORBITFS_ENGINE_RELEASE_PROVIDER || DEFAULT_PROVIDER).trim();
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
	} catch {
		throw fail('Engine release provider must be a public HTTPS URL.', 500, 'ENGINE_RELEASE_PROVIDER_INVALID');
	}
}

function safeDownloadUrl(value: unknown) {
	try {
		const url = new URL(String(value || '').trim());
		if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
		return url.toString();
	} catch {
		throw fail('Engine release provider returned an invalid download URL.', 502, 'ENGINE_RELEASE_URL_INVALID');
	}
}

function safeFilePath(value: unknown) {
	const path = String(value || '').trim().replace(/\\/g, '/');
	return Boolean(path && !path.startsWith('/') && !path.startsWith('../') && !path.includes('/../') && !path.includes('\0'));
}

function normalizedComponents(value: unknown) {
	return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter((item) => ENGINE_COMPONENTS.has(item)))];
}

async function storedLicenseIdentity() {
	const installationId = await ensureInstallationIdentity();
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_license').select('license_key').eq('id', 'primary').maybeSingle();
	if (result.error) throw result.error;
	const licenseKey = String(result.data?.license_key || '').trim();
	if (!licenseKey) throw fail('Activate the OrbitFS licence before deploying the Shared Engine Host.', 409, 'LICENSE_KEY_REQUIRED');
	return { installationId, licenseKey };
}

async function requestReleaseDescriptor() {
	const { installationId, licenseKey } = await storedLicenseIdentity();
	const response = await fetch(`${providerBase()}/engine-release`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			licenseKey,
			installationId,
			deviceName: 'OrbitFS Shared Engine Provisioner',
			platform: 'vercel',
			appVersion: 'cloud'
		}),
		cache: 'no-store',
		signal: AbortSignal.timeout(timeoutMs())
	});
	const body: any = await response.json().catch(() => ({}));
	if (!response.ok) throw fail(String(body?.error || body?.message || `Engine release provider returned ${response.status}`), response.status < 500 ? response.status : 503, String(body?.code || 'ENGINE_RELEASE_PROVIDER_ERROR'));
	const raw = body?.release as Partial<EngineReleaseDescriptor> | undefined;
	if (!raw?.version || !raw?.releaseId || !raw?.sha256 || !raw?.downloadUrl || raw.distribution !== 'orbitfs-store-package-v1') {
		throw fail('Engine release provider returned incomplete release metadata.', 502, 'ENGINE_RELEASE_METADATA_INVALID');
	}
	const minimumEngineDeployerProtocol = Math.max(1, Number(raw.minimumEngineDeployerProtocol || 1));
	if (!Number.isInteger(minimumEngineDeployerProtocol)) throw fail('Engine release provider returned an invalid deployer protocol requirement.', 502, 'ENGINE_RELEASE_PROTOCOL_INVALID');
	if (minimumEngineDeployerProtocol > SUPPORTED_ENGINE_DEPLOYER_PROTOCOL) {
		throw fail(`Engine release ${raw.version} requires Engine Deployer protocol ${minimumEngineDeployerProtocol}, but this OrbitFS Base supports protocol ${SUPPORTED_ENGINE_DEPLOYER_PROTOCOL}. Update the Panel/Base first.`, 409, 'ENGINE_DEPLOYER_UPDATE_REQUIRED');
	}
	const components = normalizedComponents(raw.components);
	if (!components.length) throw fail('Engine release provider returned no Engine components.', 502, 'ENGINE_RELEASE_COMPONENTS_INVALID');
	if (raw.checkpointRequired === false) throw fail('Engine update is missing the required update checkpoint contract.', 502, 'ENGINE_RELEASE_CHECKPOINT_INVALID');
	const release = { ...raw, components, checkpointRequired: true, minimumEngineDeployerProtocol, downloadUrl: safeDownloadUrl(raw.downloadUrl) } as EngineReleaseDescriptor;
	return { installationId, release };
}

function parsePackage(archive: Buffer, descriptor: EngineReleaseDescriptor) {
	if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) throw fail('Engine release package size is invalid.', 502, 'ENGINE_RELEASE_SIZE_INVALID');
	const digest = createHash('sha256').update(archive).digest('hex');
	if (digest.toLowerCase() !== String(descriptor.sha256).toLowerCase()) throw fail('Engine release checksum verification failed.', 502, 'ENGINE_RELEASE_CHECKSUM_FAILED');
	let payload: EngineReleasePackage;
	try {
		payload = JSON.parse(gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8')) as EngineReleasePackage;
	} catch {
		throw fail('Engine release package could not be unpacked.', 502, 'ENGINE_RELEASE_PACKAGE_INVALID');
	}
	if (payload?.format !== 'orbitfs-engine-release-v1' || payload.version !== descriptor.version || payload.releaseId !== descriptor.releaseId) {
		throw fail('Engine release package identity does not match its signed descriptor.', 502, 'ENGINE_RELEASE_IDENTITY_MISMATCH');
	}
	const packageProtocol = Math.max(1, Number(payload.minimumEngineDeployerProtocol || 1));
	if (!Number.isInteger(packageProtocol) || packageProtocol !== descriptor.minimumEngineDeployerProtocol) throw fail('Engine package deployer protocol does not match its Store descriptor.', 502, 'ENGINE_RELEASE_PROTOCOL_MISMATCH');
	if (payload.checkpointRequired !== true) throw fail('Engine package does not require the mandatory update checkpoint.', 502, 'ENGINE_RELEASE_CHECKPOINT_INVALID');
	const packageComponents = normalizedComponents(payload.components);
	if (!packageComponents.length || packageComponents.join(',') !== descriptor.components.slice().sort().join(',')) {
		const descriptorComponents = descriptor.components.slice().sort();
		if (packageComponents.slice().sort().join(',') !== descriptorComponents.join(',')) throw fail('Engine package components do not match its Store descriptor.', 502, 'ENGINE_RELEASE_COMPONENTS_MISMATCH');
	}
	if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) throw fail('Engine release file list is invalid.', 502, 'ENGINE_RELEASE_FILES_INVALID');
	const seen = new Set<string>();
	for (const item of payload.files) {
		if (!safeFilePath(item?.file) || seen.has(item.file)) throw fail(`Unsafe or duplicate Engine release file: ${String(item?.file || '')}`, 502, 'ENGINE_RELEASE_FILE_INVALID');
		seen.add(item.file);
		if (!['base64', 'utf-8'].includes(item.encoding) || typeof item.data !== 'string') throw fail(`Invalid Engine release file encoding: ${item.file}`, 502, 'ENGINE_RELEASE_FILE_INVALID');
	}
	if (!seen.has('package.json') || ![...seen].some((path) => path.startsWith('src/'))) throw fail('Engine release is missing required project files.', 502, 'ENGINE_RELEASE_FILES_REQUIRED');
	return payload;
}

export async function fetchLatestEngineRelease() {
	const { installationId, release } = await requestReleaseDescriptor();
	const response = await fetch(release.downloadUrl, {
		cache: 'no-store',
		signal: AbortSignal.timeout(timeoutMs())
	});
	if (!response.ok) throw fail(`Engine release download returned ${response.status}.`, 503, 'ENGINE_RELEASE_DOWNLOAD_FAILED');
	const declared = Number(response.headers.get('content-length') || 0);
	if (declared > MAX_ARCHIVE_BYTES) throw fail('Engine release package is too large.', 502, 'ENGINE_RELEASE_SIZE_INVALID');
	const archive = Buffer.from(await response.arrayBuffer());
	const packageData = parsePackage(archive, release);
	return {
		installationId,
		descriptor: release,
		package: packageData,
		files: packageData.files.map((file) => ({ file: file.file, data: file.data, encoding: file.encoding }))
	};
}
