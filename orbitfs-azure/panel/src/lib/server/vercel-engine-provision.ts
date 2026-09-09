import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { configuredPanelUrl, getSharedEngineHostState, saveSharedEngineHostState } from '$lib/server/engine-host-state';
import { fetchLatestEngineRelease } from '$lib/server/engine-release-client';
import { getVercelCredentials } from '$lib/server/vercel-connection';

const API = 'https://api.vercel.com';
export const ENGINE_DEPLOYER_PROTOCOL = 1;

function fail(message: string, status = 500, code = 'ENGINE_HOST_PROVISION_FAILED') {
	return Object.assign(new Error(message), { status, code });
}

async function credentialsFrom(input: Record<string, any> = {}) {
	const requestToken = String(input.vercelToken || '').trim();
	const requestTeam = String(input.teamId || '').trim();
	if (requestToken) return { token: requestToken, teamId: requestTeam };

	const stored = await getVercelCredentials();
	if (stored?.token) return { token: stored.token, teamId: String(stored.teamId || '').trim() };

	const fallbackToken = String(env.ORBITFS_VERCEL_TOKEN || env.VERCEL_API_TOKEN || '').trim();
	const fallbackTeam = String(env.ORBITFS_VERCEL_TEAM_ID || env.VERCEL_ORG_ID || '').trim();
	return { token: fallbackToken, teamId: fallbackTeam };
}

function projectName(installationId: string) {
	const prefix = String(env.ORBITFS_ENGINE_PROJECT_PREFIX || 'orbitfs-engine').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'orbitfs-engine';
	const suffix = installationId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'host';
	return `${prefix}-${suffix}`.slice(0, 100);
}

function requestUrl(path: string, teamId: string, extra: Record<string, string> = {}) {
	const url = new URL(path, API);
	if (teamId) url.searchParams.set('teamId', teamId);
	for (const [key, value] of Object.entries(extra)) if (value) url.searchParams.set(key, value);
	return url;
}

async function vercelRequest(path: string, token: string, teamId: string, init: RequestInit = {}, extra: Record<string, string> = {}) {
	const response = await fetch(requestUrl(path, teamId, extra), {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			...(init.body ? { 'content-type': 'application/json' } : {}),
			...(init.headers || {})
		},
		cache: 'no-store',
		signal: AbortSignal.timeout(Math.max(8_000, Number(env.ORBITFS_VERCEL_TIMEOUT_MS || 30_000)))
	});
	const body: any = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw fail(String(body?.error?.message || body?.message || `Vercel returned ${response.status}`), response.status < 500 ? response.status : 503, String(body?.error?.code || 'VERCEL_API_FAILED'));
	}
	return body;
}

function requiredEngineEnvironment() {
	const values = {
		SUPABASE_URL: String(env.SUPABASE_URL || '').trim(),
		SUPABASE_PUBLISHABLE_KEY: String(env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
		ORBITFS_DB_SECRET: String(env.ORBITFS_DB_SECRET || '').trim(),
		ORBITFS_ENGINE_SECRET: String(env.ORBITFS_ENGINE_SECRET || env.ORBITFS_DB_SECRET || '').trim(),
		ORBITFS_PANEL_URL: configuredPanelUrl()
	};
	for (const [key, value] of Object.entries(values)) {
		if (!value) throw fail(`${key} is required before the Shared Engine Host can be provisioned.`, 409, 'ENGINE_HOST_ENV_REQUIRED');
	}
	return Object.entries(values).map(([key, value]) => ({ key, value, type: 'encrypted', target: ['production', 'preview'] }));
}

function publicVercelUrl(value: unknown) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	return raw.startsWith('http://') || raw.startsWith('https://') ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}

function deploymentReadyState(deployment: any) {
	return String(deployment?.readyState || deployment?.state || deployment?.status || 'UNKNOWN').trim().toUpperCase();
}

function deploymentFailed(state: string) {
	return ['ERROR', 'CANCELED', 'CANCELLED'].includes(state);
}

async function uploadReleaseFiles(files: Array<{ file: string; data: string; encoding: 'base64' | 'utf-8' }>, token: string, teamId: string) {
	const uploaded: Array<{ file: string; sha: string; size: number }> = [];
	for (const file of files) {
		const bytes = file.encoding === 'base64' ? Buffer.from(file.data, 'base64') : Buffer.from(file.data, 'utf8');
		const sha = createHash('sha1').update(bytes).digest('hex');
		let response = await fetch(requestUrl('/v2/files', teamId), {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/octet-stream',
				'content-length': String(bytes.length),
				'x-vercel-digest': sha
			},
			body: new Uint8Array(bytes),
			signal: AbortSignal.timeout(Math.max(8_000, Number(env.ORBITFS_VERCEL_TIMEOUT_MS || 30_000)))
		});
		if (!response.ok && response.status === 404) {
			response = await fetch(requestUrl('/v2/now/files', teamId), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/octet-stream',
					'content-length': String(bytes.length),
					'x-now-digest': sha
				},
				body: new Uint8Array(bytes),
				signal: AbortSignal.timeout(Math.max(8_000, Number(env.ORBITFS_VERCEL_TIMEOUT_MS || 30_000)))
			});
		}
		if (!response.ok && response.status !== 409) {
			throw fail(`Vercel file upload failed for ${file.file}: ${await response.text()}`, response.status < 500 ? response.status : 503, 'VERCEL_FILE_UPLOAD_FAILED');
		}
		uploaded.push({ file: file.file, sha, size: bytes.length });
	}
	return uploaded;
}

export async function engineHostProvisioningAvailable() {
	const credentials = await credentialsFrom();
	return Boolean(credentials.token);
}

export async function refreshSharedEngineDeployment(input: Record<string, any> = {}) {
	const current = await getSharedEngineHostState();
	if (!current.deploymentId) {
		return { host: current, ready: Boolean(current.hostUrl), readyState: current.hostUrl ? 'READY' : 'UNKNOWN', deployment: null };
	}
	const { token, teamId } = await credentialsFrom(input);
	if (!token) throw fail('Connect Vercel in OrbitFS before reading Shared Engine deployment status.', 409, 'VERCEL_TOKEN_REQUIRED');
	const deployment = await vercelRequest(`/v13/deployments/${encodeURIComponent(current.deploymentId)}`, token, teamId);
	const readyState = deploymentReadyState(deployment);
	const deploymentUrl = publicVercelUrl(deployment?.url) || current.deploymentUrl;
	const stableProjectUrl = current.projectName ? publicVercelUrl(`${current.projectName}.vercel.app`) : null;
	const hostUrl = current.hostUrl || stableProjectUrl || deploymentUrl;
	if (deploymentFailed(readyState)) {
		const host = await saveSharedEngineHostState({ state: 'error', deploymentUrl, hostUrl, lastSyncAt: new Date().toISOString(), lastError: `Vercel deployment ended in ${readyState}.` });
		throw Object.assign(new Error(host.lastError || 'Shared Engine deployment failed.'), { status: 502, code: 'ENGINE_HOST_DEPLOYMENT_FAILED', host, readyState });
	}
	const ready = readyState === 'READY';
	const nextState = ready ? (['linked', 'ready'].includes(current.state) ? current.state : 'deployed') : 'provisioning';
	const host = await saveSharedEngineHostState({ state: nextState, deploymentUrl, hostUrl, lastSyncAt: new Date().toISOString(), lastError: null });
	return { host, ready, readyState, deployment };
}

export async function provisionSharedEngineHost(input: Record<string, any> = {}) {
	const { token, teamId } = await credentialsFrom(input);
	if (!token) throw fail('Connect Vercel in OrbitFS before deploying the Shared Engine Host.', 409, 'VERCEL_TOKEN_REQUIRED');
	const current = await getSharedEngineHostState();
	const panelUrl = configuredPanelUrl();
	const name = current.projectName || projectName(current.installationId);
	const environmentVariables = requiredEngineEnvironment();

	// Production Engine deployments always come from the private, licensed Store package service.
	// Customer Vercel accounts never need access to the private V1-vercel-engine GitHub repository.
	const release = await fetchLatestEngineRelease();
	if (release.installationId !== current.installationId) {
		throw fail('Engine release was authorized for a different OrbitFS installation.', 409, 'ENGINE_RELEASE_INSTALLATION_MISMATCH');
	}
	const descriptor = release.descriptor;
	const projectSettings = {
		framework: descriptor.projectSettings?.framework || release.package.projectSettings?.framework || 'sveltekit',
		buildCommand: descriptor.projectSettings?.buildCommand || release.package.projectSettings?.buildCommand || 'npm run build',
		installCommand: descriptor.projectSettings?.installCommand || release.package.projectSettings?.installCommand || 'npm ci',
		...(descriptor.projectSettings?.outputDirectory || release.package.projectSettings?.outputDirectory ? { outputDirectory: descriptor.projectSettings?.outputDirectory || release.package.projectSettings?.outputDirectory } : {})
	};

	await saveSharedEngineHostState({
		state: 'provisioning', panelUrl, projectName: name, distribution: 'orbitfs-store-package-v1',
		releaseVersion: descriptor.version, releaseId: descriptor.releaseId, releaseSha256: descriptor.sha256,
		releaseSourceCommit: descriptor.sourceCommit, releaseFileCount: descriptor.fileCount, lastError: null
	});

	try {
		let project: any = null;
		if (current.projectId) {
			try {
				project = await vercelRequest(`/v9/projects/${encodeURIComponent(current.projectId)}`, token, teamId);
			} catch (error: any) {
				if (Number(error?.status) !== 404) throw error;
			}
		}
		if (!project) {
			try {
				project = await vercelRequest('/v11/projects', token, teamId, {
					method: 'POST',
					body: JSON.stringify({
						name,
						...projectSettings,
						environmentVariables: environmentVariables.map((item) => ({ ...item, target: 'production' }))
					})
				});
			} catch (error: any) {
				if (Number(error?.status) !== 409) throw error;
				project = await vercelRequest(`/v9/projects/${encodeURIComponent(name)}`, token, teamId);
			}
		}
		const projectId = String(project?.id || current.projectId || '').trim();
		if (!projectId) throw fail('Vercel did not return the Shared Engine project id.', 503, 'VERCEL_PROJECT_ID_MISSING');

		await vercelRequest(`/v10/projects/${encodeURIComponent(projectId)}/env`, token, teamId, {
			method: 'POST', body: JSON.stringify(environmentVariables)
		}, { upsert: 'true' });

		const files = await uploadReleaseFiles(release.files, token, teamId);
		const deployment = await vercelRequest('/v13/deployments', token, teamId, {
			method: 'POST',
			body: JSON.stringify({
				name,
				project: projectId,
				target: 'production',
				files,
				projectSettings,
				meta: {
					orbitfsDistribution: 'store-package-v1',
					orbitfsInstallationId: current.installationId,
					orbitfsReleaseVersion: descriptor.version,
					orbitfsReleaseId: descriptor.releaseId,
					orbitfsEngineDeployerProtocol: String(ENGINE_DEPLOYER_PROTOCOL)
				}
			})
		});
		const readyState = deploymentReadyState(deployment);
		const aliases = Array.isArray(deployment?.alias) ? deployment.alias : [];
		const hostUrl = publicVercelUrl(aliases[0] || project?.alias?.[0] || `${name}.vercel.app`);
		const deploymentUrl = publicVercelUrl(deployment?.url);
		return saveSharedEngineHostState({
			state: readyState === 'READY' ? 'deployed' : 'provisioning', panelUrl, hostUrl, projectId, projectName: name,
			deploymentId: String(deployment?.id || '') || null, deploymentUrl, distribution: 'orbitfs-store-package-v1',
			releaseVersion: descriptor.version, releaseId: descriptor.releaseId, releaseSha256: descriptor.sha256,
			releaseSourceCommit: descriptor.sourceCommit, releaseFileCount: descriptor.fileCount,
			lastError: null, lastSyncAt: new Date().toISOString()
		});
	} catch (error: any) {
		const detail = String(error?.message || 'Shared Engine Host provisioning failed.');
		await saveSharedEngineHostState({ state: 'error', lastError: detail }).catch(() => undefined);
		throw Object.assign(error instanceof Error ? error : new Error(detail), { message: detail });
	}
}
