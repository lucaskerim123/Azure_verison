import { json } from '@sveltejs/kit';
import { exchangeAuthorizationCode, exchangeRefreshToken, getOAuthClient, resolveMcpResource } from '$lib/server/mcp-oauth';

const oauthError = (error:string, description:string, status=400) => json({ error, error_description:description }, { status, headers:{'cache-control':'no-store','pragma':'no-cache'} });

export async function POST({ request }) {
	const form = await request.formData();
	const grantType = String(form.get('grant_type') || '');
	const clientId = String(form.get('client_id') || '');
	if (!clientId) return oauthError('invalid_client','client_id is required');
	try { await getOAuthClient(clientId); } catch { return oauthError('invalid_client','Unknown OAuth client',401); }
	try {
		const resource = String(form.get('resource') || await resolveMcpResource());
		let token;
		if (grantType === 'authorization_code') {
			token = await exchangeAuthorizationCode({ code:String(form.get('code')||''), clientId,
				redirectUri:String(form.get('redirect_uri')||''), codeVerifier:String(form.get('code_verifier')||''), resource });
		} else if (grantType === 'refresh_token') {
			token = await exchangeRefreshToken({ refreshToken:String(form.get('refresh_token')||''), clientId, resource });
		} else return oauthError('unsupported_grant_type','Supported grants are authorization_code and refresh_token');
		return json(token, { headers:{'cache-control':'no-store','pragma':'no-cache'} });
	} catch (err:any) {
		const status=Number(err?.status||400);
		return oauthError(status>=500?'temporarily_unavailable':'invalid_grant', err instanceof Error ? err.message : 'Token exchange failed', status);
	}
}
