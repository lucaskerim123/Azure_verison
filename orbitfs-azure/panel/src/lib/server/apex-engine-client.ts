import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { resolvedEngineHostBaseUrl } from '$lib/server/engine-host';

const defaultTimeout = () => Math.max(5_000, Number(env.ORBITFS_ENGINE_TIMEOUT_MS || 15_000));
const processingTimeout = () => Math.max(defaultTimeout(), Number(env.ORBITFS_APEX_PROCESSING_TIMEOUT_MS || 90_000));

function engineSecret() {
	const secret = String(env.ORBITFS_ENGINE_SECRET || env.ORBITFS_DB_SECRET || '').trim();
	if (!secret) {
		throw Object.assign(new Error('OrbitFS Engine Host shared secret is not configured'), {
			status: 503,
			code: 'ENGINE_SECRET_REQUIRED'
		});
	}
	return secret;
}

async function engineRequest(path: string, options: {
	method?: 'GET' | 'POST';
	body?: Record<string, unknown> | null;
	query?: Record<string, string | number | null | undefined>;
	timeoutMs?: number;
} = {}) {
	const method = options.method || 'GET';
	const rawBody = method === 'POST' ? JSON.stringify(options.body || {}) : '';
	const timestamp = String(Math.floor(Date.now() / 1000));
	const secret = engineSecret();
	const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	const url = new URL(path, `${await resolvedEngineHostBaseUrl()}/`);
	for (const [key, value] of Object.entries(options.query || {})) {
		if (value !== null && value !== undefined && String(value) !== '') url.searchParams.set(key, String(value));
	}
	const response = await fetch(url, {
		method,
		body: method === 'POST' ? rawBody : undefined,
		cache: 'no-store',
		headers: {
			...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
			'x-orbitfs-engine-secret': secret,
			'x-orbitfs-timestamp': timestamp,
			'x-orbitfs-signature': signature
		},
		signal: AbortSignal.timeout(options.timeoutMs || defaultTimeout())
	});
	const payload: any = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw Object.assign(new Error(String(payload?.error || payload?.message || `Engine Host returned ${response.status}`)), {
			status: response.status < 500 ? response.status : 503,
			code: String(payload?.code || 'ENGINE_HOST_REQUEST_FAILED'),
			engineStatus: response.status
		});
	}
	return payload;
}

export async function getApexEngineCapabilities() {
	return engineRequest('/api/engine/apex/capabilities');
}

export async function listApexEngineJobs(workspaceId: string, actorUserId: string) {
	const payload = await engineRequest('/api/engine/apex/jobs', { query: { workspaceId, actorUserId } });
	return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export async function createApexEngineJob(input: {
	workspaceId: string;
	actorUserId: string;
	sourceId: string;
	importMode: 'knowledge' | 'reference' | 'draft';
	type?: 'knowledge_import' | 'reprocess' | 'revision_import' | 'conversion';
}) {
	const payload = await engineRequest('/api/engine/apex/jobs', { method: 'POST', body: input });
	return payload?.job;
}

export async function getApexEngineJob(workspaceId: string, actorUserId: string, jobId: string) {
	return engineRequest(`/api/engine/apex/jobs/${encodeURIComponent(jobId)}`, { query: { workspaceId, actorUserId } });
}

export async function processApexEngineJob(workspaceId: string, actorUserId: string, jobId: string) {
	return engineRequest(`/api/engine/apex/jobs/${encodeURIComponent(jobId)}`, {
		method: 'POST',
		body: { workspaceId, actorUserId, action: 'process' },
		timeoutMs: processingTimeout()
	});
}

export async function retryApexEngineJob(workspaceId: string, actorUserId: string, jobId: string) {
	return engineRequest(`/api/engine/apex/jobs/${encodeURIComponent(jobId)}`, {
		method: 'POST',
		body: { workspaceId, actorUserId, action: 'retry' }
	});
}

export async function cancelApexEngineJob(workspaceId: string, actorUserId: string, jobId: string) {
	return engineRequest(`/api/engine/apex/jobs/${encodeURIComponent(jobId)}`, {
		method: 'POST',
		body: { workspaceId, actorUserId, action: 'cancel' }
	});
}

export async function finalizeApexEngineJob(workspaceId: string, actorUserId: string, jobId: string, knowledgeItemId: string) {
	return engineRequest(`/api/engine/apex/jobs/${encodeURIComponent(jobId)}`, {
		method: 'POST',
		body: { workspaceId, actorUserId, action: 'finalized', knowledgeItemId }
	});
}
