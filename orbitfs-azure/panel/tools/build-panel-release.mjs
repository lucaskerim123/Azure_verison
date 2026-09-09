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
const asBool = (value, fallback = false) => {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	throw new Error(`Invalid boolean value: ${value}`);
};

const version = arg('version', process.env.ORBITFS_PANEL_RELEASE_VERSION || '0.0.0-dev').trim();
const schemaVersion = arg('schema-version', process.env.ORBITFS_SCHEMA_VERSION || '1').trim();
const releaseChannel = arg('channel', process.env.ORBITFS_RELEASE_CHANNEL || 'base').trim().toLowerCase();
const components = [...new Set(arg('components', releaseChannel === 'base' ? 'core' : 'core').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean))];
const minimumVersion = arg('minimum-version', '').trim() || null;
const rollbackVersion = arg('rollback-version', '').trim() || null;
const checkpointRequired = asBool(arg('checkpoint-required', releaseChannel === 'update' ? 'true' : 'false'));
const engineRequired = asBool(arg('engine-required', components.some((component) => component !== 'core') ? 'true' : 'false'));
const engineDeployerProtocol = Number(arg('engine-deployer-protocol', process.env.ORBITFS_ENGINE_DEPLOYER_PROTOCOL || '1'));
const output = resolve(ROOT, arg('output', 'panel-release.json.gz'));
const sourceCommit = arg('commit', process.env.GITHUB_SHA || '').trim() || null;
const validVersion = (value) => /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(value);
const allowedComponents = new Set(['core', 'apex', 'mcp', 'studio']);

if (!validVersion(version)) throw new Error('Invalid Panel release version');
if (!validVersion(schemaVersion)) throw new Error('Invalid schema version');
if (!['base', 'update'].includes(releaseChannel)) throw new Error('Release channel must be base or update');
if (minimumVersion && !validVersion(minimumVersion)) throw new Error('Invalid minimum version');
if (rollbackVersion && !validVersion(rollbackVersion)) throw new Error('Invalid rollback version');
if (!Number.isInteger(engineDeployerProtocol) || engineDeployerProtocol < 1 || engineDeployerProtocol > 100) throw new Error('Engine Deployer protocol must be an integer from 1 to 100');
if (!components.length) throw new Error('At least one release component is required');
for (const component of components) {
	if (!allowedComponents.has(component)) throw new Error(`Unknown release component: ${component}`);
}
if (releaseChannel === 'base' && (components.length !== 1 || components[0] !== 'core')) {
	throw new Error('BASE_RELEASE may only publish the core Panel/Base system');
}
if (releaseChannel === 'base' && checkpointRequired) throw new Error('BASE_RELEASE does not use update checkpoints');
if (releaseChannel === 'base' && engineRequired) throw new Error('BASE_RELEASE must not require the Engine Host');
if (releaseChannel === 'update' && !checkpointRequired) throw new Error('UPDATE_RELEASE must require a pre-update checkpoint');
if (engineRequired !== components.some((component) => component !== 'core')) {
	throw new Error('Engine requirement does not match selected add-on components');
}

const topFiles = ['.npmrc', '.env.example', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'];
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
	format: 'orbitfs-panel-release-v1',
	version,
	schemaVersion,
	releaseChannel,
	components,
	minimumVersion,
	rollbackVersion,
	engineRequired,
	engineDeployerProtocol,
	checkpoint: {
		required: checkpointRequired,
		format: checkpointRequired ? 'orbitfs-update-checkpoint-v1' : null,
		capture: checkpointRequired
			? ['panel-deployment', 'engine-host', 'addon-state', 'safe-global-settings', 'active-release']
			: [],
		purpose: checkpointRequired ? 'rollback-anchor' : null
	},
	releaseId: `panel-${version}`,
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
	schemaVersion,
	releaseChannel,
	components,
	minimumVersion,
	rollbackVersion,
	engineRequired,
	engineDeployerProtocol,
	checkpointRequired,
	output: basename(output),
	sha256,
	fileCount: files.length,
	sourceBytes: totalBytes,
	archiveBytes: archive.byteLength
}, null, 2));
