import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { resolvedSharedEngineHostUrl } from '$lib/server/engine-host-state';

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

function errorText(payload: any, fallback: string) {
	const candidates = [
		payload?.error?.message,
		payload?.error?.error,
		payload?.error,
		payload?.message,
		payload?.detail?.message,
		payload?.detail
	];
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	try {
		if (payload && typeof payload === 'object' && Object.keys(payload).length) return JSON.stringify(payload);
	} catch {}
	return fallback;
}

function errorCode(payload: any) {
	const candidates = [payload?.code, payload?.error?.code, payload?.detail?.code];
	for (const value of candidates) if (typeof value === 'string' && value.trim()) return value.trim();
	return 'ENGINE_HOST_REQUEST_FAILED';
}

async function signedRequest(path: string, options: {
	method?: 'GET' | 'POST' | 'DELETE';
	body?: Record<string, unknown> | null;
	query?: Record<string, string | number | null | undefined>;
	timeoutMs?: number;
} = {}) {
	const method = options.method || 'GET';
	const rawBody = method === 'POST' || method === 'DELETE' ? JSON.stringify(options.body || {}) : '';
	const timestamp = String(Math.floor(Date.now() / 1000));
	const secret = engineSecret();
	const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	const hostUrl = await resolvedSharedEngineHostUrl();
	const url = new URL(path, `${hostUrl}/`);
	for (const [key, value] of Object.entries(options.query || {})) {
		if (value !== null && value !== undefined && String(value) !== '') url.searchParams.set(key, String(value));
	}
	const response = await fetch(url, {
		method,
		body: method === 'POST' || method === 'DELETE' ? rawBody : undefined,
		cache: 'no-store',
		headers: {
			...(method === 'POST' || method === 'DELETE' ? { 'content-type': 'application/json' } : {}),
			'x-orbitfs-engine-secret': secret,
			'x-orbitfs-timestamp': timestamp,
			'x-orbitfs-signature': signature
		},
		signal: AbortSignal.timeout(Math.max(5000, Number(options.timeoutMs || env.ORBITFS_ENGINE_TIMEOUT_MS || 12000)))
	});
	const payload: any = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw Object.assign(new Error(errorText(payload, `Engine Host returned ${response.status}`)), {
			status: response.status < 500 ? response.status : 503,
			code: errorCode(payload),
			engineStatus: response.status
		});
	}
	return payload;
}

export async function confirmSharedEngineHostLink(input: {
	installationId: string;
	panelUrl: string;
	actorUserId: string;
}) {
	return signedRequest('/api/host/link', {
		method: 'POST',
		body: { action: 'link', ...input }
	});
}

export async function readSharedEngineHostLink() {
	return signedRequest('/api/host/link');
}

export async function confirmSharedEngineHostUnlink(installationId: string, actorUserId: string) {
	return signedRequest('/api/host/link', {
		method: 'DELETE',
		body: { installationId, actorUserId }
	});
}

export async function confirmEngineHostPairing(input: {
	engineId: string;
	installationId: string;
	panelUrl: string;
	workspaceId: string;
	actorUserId: string;
}) {
	return signedRequest('/api/engine/link', {
		method: 'POST',
		body: {
			action: 'attach',
			engineId: input.engineId,
			installationId: input.installationId,
			panelUrl: input.panelUrl,
			workspaceId: input.workspaceId,
			actorUserId: input.actorUserId,
			attached: true
		}
	});
}

export async function confirmEngineHostDetach(engineId: string, actorUserId: string) {
	return signedRequest('/api/engine/link', {
		method: 'POST',
		body: { action: 'detach', engineId, actorUserId }
	});
}

export async function readRemoteEngineHostLink(engineId: string) {
	return signedRequest('/api/engine/link', { query: { engine: engineId } });
}
