import { getSupabaseAdmin } from '$lib/server/supabase';

export type McpEngineSettings = {
	accessTokenMinutes: number;
	refreshTokenDays: number;
	authorizationCodeMinutes: number;
	allowWriteScope: boolean;
	allowOfflineAccess: boolean;
	dynamicClientRegistration: boolean;
	maxRequestKb: number;
	requireJsonContentType: boolean;
	allowDeleteTransport: boolean;
	mirrorUiState: boolean;
	logRejectedRequests: boolean;
	allowWorkspaceWake: boolean;
};

const DEFAULTS: McpEngineSettings = {
	accessTokenMinutes: 60,
	refreshTokenDays: 30,
	authorizationCodeMinutes: 10,
	allowWriteScope: true,
	allowOfflineAccess: true,
	dynamicClientRegistration: true,
	maxRequestKb: 1024,
	requireJsonContentType: true,
	allowDeleteTransport: true,
	mirrorUiState: true,
	logRejectedRequests: true,
	allowWorkspaceWake: true
};

function objectValue(value: unknown): Record<string, any> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback;
}

function bool(value: unknown, fallback: boolean) {
	return typeof value === 'boolean' ? value : fallback;
}

export async function getMcpEngineSettings(): Promise<McpEngineSettings> {
	const db = getSupabaseAdmin();
	const result = await db.from('orbitfs_settings').select('value').eq('scope_type','global').eq('scope_id','').eq('key','mcp.engine.settings').maybeSingle();
	if (result.error) throw result.error;
	const raw = objectValue(result.data?.value);
	return {
		accessTokenMinutes: bounded(raw.accessTokenMinutes, DEFAULTS.accessTokenMinutes, 5, 1440),
		refreshTokenDays: bounded(raw.refreshTokenDays, DEFAULTS.refreshTokenDays, 1, 90),
		authorizationCodeMinutes: bounded(raw.authorizationCodeMinutes, DEFAULTS.authorizationCodeMinutes, 1, 30),
		allowWriteScope: bool(raw.allowWriteScope, DEFAULTS.allowWriteScope),
		allowOfflineAccess: bool(raw.allowOfflineAccess, DEFAULTS.allowOfflineAccess),
		dynamicClientRegistration: bool(raw.dynamicClientRegistration, DEFAULTS.dynamicClientRegistration),
		maxRequestKb: bounded(raw.maxRequestKb, DEFAULTS.maxRequestKb, 64, 16384),
		requireJsonContentType: bool(raw.requireJsonContentType, DEFAULTS.requireJsonContentType),
		allowDeleteTransport: bool(raw.allowDeleteTransport, DEFAULTS.allowDeleteTransport),
		mirrorUiState: bool(raw.mirrorUiState, DEFAULTS.mirrorUiState),
		logRejectedRequests: bool(raw.logRejectedRequests, DEFAULTS.logRejectedRequests),
		allowWorkspaceWake: bool(raw.allowWorkspaceWake, DEFAULTS.allowWorkspaceWake)
	};
}
