export const mcpAddonManifest = {
	id: 'mcp',
	name: 'OrbitFS MCP',
	description: 'OAuth-authenticated startup, context, ChatGPT UI and MCP tools for OrbitFS.',
	version: '1.5.0',
	kind: 'private-engine-addon',
	transportPath: '/mcp',
	capabilities: ['mcp', 'oauth-2.1', 'pkce', 'startup', 'context', 'chatgpt-ui', 'mcp-apps'],
	dependencies: ['base.workspaces', 'base.profiles', 'base.auth', 'base.permissions']
} as const;
