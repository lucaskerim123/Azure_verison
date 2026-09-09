import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? String(args[i + 1] || fallback) : fallback;
};
const version = arg('version', process.env.ORBITFS_ENGINE_RELEASE_VERSION || '0.0.0-dev').trim();
const components = [...new Set(arg('components', '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))];
const output = resolve(ROOT, arg('output', 'engine-release.json.gz'));
const sourceCommit = arg('commit', process.env.GITHUB_SHA || '').trim() || null;
const allowedComponents = new Set(['apex', 'mcp', 'studio']);

if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(version)) throw new Error('Invalid Engine release version');
if (!components.length) throw new Error('Select at least one Engine-backed update component');
for (const component of components) {
	if (!allowedComponents.has(component)) throw new Error(`Unknown Engine release component: ${component}`);
}

const topFiles = ['.npmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'];
const topDirectories = ['src', 'static'];
const excludedNames = new Set(['.DS_Store', 'Thumbs.db']);

function collectDirectory(path, files) {
	for (const name of readdirSync(path)) {
		if (excludedNames.has(name)) continue;
		const full = join(path, name);
		const stats = statSync(full);
		if (stats.isDirectory()) collectDirectory(full, files);
		else if (stats.isFile()) files.push(full);
	}
}

const selected = [];
for (const name of topFiles) {
	const full = join(ROOT, name);
	if (existsSync(full) && statSync(full).isFile()) selected.push(full);
}
for (const name of topDirectories) {
	const full = join(ROOT, name);
	if (existsSync(full) && statSync(full).isDirectory()) collectDirectory(full, selected);
}
selected.sort((a, b) => a.localeCompare(b));
if (!selected.some((file) => relative(ROOT, file).replaceAll('\\', '/') === 'package.json')) throw new Error('package.json is required');
if (!selected.some((file) => relative(ROOT, file).replaceAll('\\', '/').startsWith('src/'))) throw new Error('src files are required');

const files = selected.map((full) => {
	const path = relative(ROOT, full).replaceAll('\\', '/');
	if (!path || path.startsWith('../') || path.includes('/../')) throw new Error(`Unsafe release path: ${path}`);
	const bytes = readFileSync(full);
	return { file: path, data: bytes.toString('base64'), encoding: 'base64', size: bytes.byteLength };
});

const payload = {
	format: 'orbitfs-engine-release-v1',
	version,
	components,
	checkpointRequired: true,
	releaseId: `engine-${version}`,
	sourceCommit,
	createdAt: new Date().toISOString(),
	projectSettings: {
		framework: 'sveltekit',
		buildCommand: 'npm run build',
		installCommand: 'npm ci'
	},
	files
};
const json = Buffer.from(JSON.stringify(payload));
const archive = gzipSync(json, { level: 9 });
writeFileSync(output, archive);
const sha256 = createHash('sha256').update(archive).digest('hex');
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
console.log(JSON.stringify({
	ok: true,
	version,
	components,
	checkpointRequired: true,
	output: basename(output),
	sha256,
	fileCount: files.length,
	sourceBytes: totalBytes,
	archiveBytes: archive.byteLength
}, null, 2));
