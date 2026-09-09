import { componentLicensed, getPanelLicenseSummary } from '$lib/server/license';

const LABELS: Record<string,string> = {
	orbitfs_base: 'OrbitFS Base System',
	orbitfs_mcp: 'OrbitFS MCP',
	orbitfs_apex: 'OrbitFS APEX',
	orbitfs_studio: 'OrbitFS Studio'
};

export async function assertComponentLicensed(componentId: string) {
	const summary = await getPanelLicenseSummary();
	if (!summary.licensed) {
		throw Object.assign(new Error('OrbitFS Base System licence is required'), {
			status: 403,
			code: 'LICENSE_REQUIRED',
			componentId: 'orbitfs_base',
			license: summary
		});
	}
	const component = summary.components?.[componentId] ?? null;
	if (!componentLicensed(component || {})) {
		throw Object.assign(new Error(`${LABELS[componentId] || componentId} licence is required`), {
			status: 403,
			code: 'COMPONENT_LICENSE_REQUIRED',
			componentId,
			component
		});
	}
	return { summary, component };
}
