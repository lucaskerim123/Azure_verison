import { apexAddonManifest } from '../../../addons/apex/manifest';
import { mcpAddonManifest } from '../../../addons/mcp/manifest';

export type PanelAddonManifest = {
	id: string;
	name: string;
	description: string;
	version: string;
	kind: string;
};

const manifests = new Map<string, PanelAddonManifest>([
	[mcpAddonManifest.id, mcpAddonManifest],
	[apexAddonManifest.id, apexAddonManifest]
]);

export function getPanelAddonManifest(id: string) {
	return manifests.get(id) ?? null;
}

export async function dispatchPanelAddonHttp(id: string, _request: Request): Promise<Response> {
	if (id === 'mcp') {
		return new Response(JSON.stringify({
			error: 'MCP resource server is hosted by OrbitFS Engine Host',
			resource: 'https://orbitfsengine.vercel.app/mcp'
		}), {
			status: 410,
			headers: { 'content-type': 'application/json' }
		});
	}
	if (id === 'apex') {
		return new Response(JSON.stringify({
			error: 'APEX processing runtime is hosted by OrbitFS Engine Host',
			manage: 'https://orbitfsengine.vercel.app/engines/apex'
		}), {
			status: 410,
			headers: { 'content-type': 'application/json' }
		});
	}
	return new Response(JSON.stringify({ error: 'Addon route not found' }), {
		status: 404,
		headers: { 'content-type': 'application/json' }
	});
}
