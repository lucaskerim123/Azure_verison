import { json } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { assertMcpOAuthReady, resolveMcpScope, sha256, OAUTH_ISSUER } from '$lib/server/mcp-oauth';
import { getMcpEngineSettings } from '$lib/server/mcp-engine-settings';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

function safeHttpsUrl(value: unknown) {
	if (!value) return null;
	try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; }
	catch { return null; }
}

function validRedirect(value: string, applicationType: string) {
	try {
		const url = new URL(value);
		if (url.hash) return false;
		if (applicationType === 'web') return url.protocol === 'https:';
		if (url.protocol === 'https:') return true;
		if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		return !['http:', 'https:', 'javascript:', 'data:', 'file:'].includes(url.protocol);
	} catch { return false; }
}

export async function POST({ request }) {
	try {
		await assertMcpOAuthReady();
	} catch (error:any) {
		return json({error:'temporarily_unavailable',error_description:String(error?.message||'OrbitFS MCP is unavailable')},{status:Number(error?.status||503),headers:{'cache-control':'no-store'}});
	}
	const settings = await getMcpEngineSettings();
	if (!settings.dynamicClientRegistration) {
		return json({ error:'registration_not_supported', error_description:'Dynamic MCP client registration is disabled by Engine configuration.' }, { status:403, headers:{'cache-control':'no-store'} });
	}
	const body = await request.json().catch(() => ({}));
	const applicationType = body.application_type === 'native' ? 'native' : 'web';
	const redirects: string[] = Array.isArray(body.redirect_uris) ? [...new Set<string>(body.redirect_uris.map((v:unknown)=>String(v)))] : [];
	if (!redirects.length || redirects.some((uri) => !validRedirect(uri, applicationType))) {
		return json({ error: 'invalid_redirect_uri', error_description: 'A valid redirect_uris list is required.' }, { status: 400 });
	}
	if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
		return json({ error: 'invalid_client_metadata', error_description: 'OrbitFS MCP DCR supports public clients with PKCE only.' }, { status: 400 });
	}
	const defaultGrants = settings.allowOfflineAccess ? ['authorization_code','refresh_token'] : ['authorization_code'];
	const grantTypes: string[] = Array.isArray(body.grant_types) ? body.grant_types.map((v:unknown)=>String(v)) : defaultGrants;
	const supportedGrants = settings.allowOfflineAccess ? ['authorization_code','refresh_token'] : ['authorization_code'];
	if (grantTypes.some((v:string) => !supportedGrants.includes(v)) || !grantTypes.includes('authorization_code')) {
		return json({ error: 'invalid_client_metadata', error_description: settings.allowOfflineAccess ? 'Only authorization_code and refresh_token grants are supported.' : 'Refresh-token/offline access is disabled by MCP Engine configuration.' }, { status: 400 });
	}
	const responseTypes: string[] = Array.isArray(body.response_types) ? body.response_types.map((v:unknown)=>String(v)) : ['code'];
	if (responseTypes.some((v:string) => v !== 'code')) return json({ error: 'invalid_client_metadata', error_description: 'Only response_type code is supported.' }, { status: 400 });

	const clientId = `orbitfs_${randomBytes(18).toString('base64url')}`;
	const registrationAccessToken = randomToken(32);
	const registrationClientUri = `${OAUTH_ISSUER}/oauth/register/${encodeURIComponent(clientId)}`;
	const scope = await resolveMcpScope(String(body.scope || 'orbitfs:read orbitfs:write offline_access'));
	const contacts = Array.isArray(body.contacts) ? body.contacts.map(String).slice(0, 20) : [];
	const record = {
		client_id: clientId,
		client_name: String(body.client_name || 'MCP Client').slice(0, 120),
		application_type: applicationType,
		redirect_uris: redirects,
		token_endpoint_auth_method: 'none',
		grant_types: grantTypes,
		response_types: responseTypes,
		client_uri: safeHttpsUrl(body.client_uri), logo_uri: safeHttpsUrl(body.logo_uri),
		tos_uri: safeHttpsUrl(body.tos_uri), policy_uri: safeHttpsUrl(body.policy_uri), jwks_uri: safeHttpsUrl(body.jwks_uri),
		contacts, scope,
		registration_access_token_hash: sha256(registrationAccessToken),
		registration_client_uri: registrationClientUri,
		client_id_issued_at: nowSeconds(),
		metadata: { dcr: true, software_id: body.software_id || null, software_version: body.software_version || null }
	};
	const db = getSupabaseAdmin();
	const { error } = await db.from('mcp_oauth_clients').insert(record);
	if (error) throw error;
	await db.from('mcp_clients').upsert({
		id: clientId, client_name: record.client_name, status: 'active',
		metadata: { oauth: true, dynamicRegistration: true, applicationType, source: 'rfc7591-dcr' },
		redirect_uris: redirects
	}, { onConflict: 'id' });
	return json({
		client_id: clientId, client_id_issued_at: record.client_id_issued_at,
		client_name: record.client_name, application_type: applicationType, redirect_uris: redirects,
		token_endpoint_auth_method: 'none', grant_types: grantTypes, response_types: responseTypes, scope,
		client_uri: record.client_uri, logo_uri: record.logo_uri, tos_uri: record.tos_uri,
		policy_uri: record.policy_uri, contacts, jwks_uri: record.jwks_uri,
		registration_access_token: registrationAccessToken, registration_client_uri: registrationClientUri
	}, { status: 201, headers: { 'cache-control': 'no-store' } });
}
